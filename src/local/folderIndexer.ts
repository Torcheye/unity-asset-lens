import { readdir, stat } from "node:fs/promises";
import { walkFiles } from "./walk.js";
import { isUnityPackage } from "./scanCache.js";
import { parseUnityPackageFile } from "../unpack/unitypackage.js";
import { baseNameOf, bucketForPath, extOf } from "../domain/fileType.js";
import type {
  CatalogProduct,
  IndexedProduct,
  ProductFile,
} from "../domain/types.js";
import type { ProgressReporter } from "../domain/progress.js";
import type { LocalFolderRow, Repository } from "../index/repository.js";

/**
 * User-folder indexer: scan an arbitrary local folder of loose files and index
 * them as a single synthetic deep-coverage `local` product so they show up in
 * search alongside the Asset Store library. Files are matched by **path and
 * name only** — no product/keyword metadata. Any `.unitypackage` found in the
 * folder is unpacked by default (recursing nested wrappers) and its internal
 * file tree is folded into the same product, so packages are searchable down to
 * individual assets. Mirrors the cache local-indexer (`localIndexer.ts`), but
 * has no catalog match and is not incremental (every rescan re-parses packages).
 */

/**
 * Synthetic product-id prefix for registered folders. Deliberately distinct
 * from the cache's `local:` prefix: `pruneSupersededLocalProducts` deletes any
 * `local:%` row lacking a `scanned_packages` reference, which a folder product
 * never has — so a separate prefix keeps folders out of that pruning path.
 */
export const FOLDER_PRODUCT_PREFIX = "folder:";

export function folderProductId(path: string): string {
  return `${FOLDER_PRODUCT_PREFIX}${path}`;
}

/** Whether a product id belongs to a registered local folder. */
export function isFolderProductId(productId: string): boolean {
  return productId.startsWith(FOLDER_PRODUCT_PREFIX);
}

export type LocalFolderStatus = "ok" | "missing";

/** A registered folder as surfaced to the engine/CLI/GUI. */
export interface LocalFolderInfo {
  readonly path: string;
  /** Display name (the folder's final path segment). */
  readonly name: string;
  readonly productId: string;
  readonly fileCount: number;
  readonly totalSize: number;
  readonly status: LocalFolderStatus;
  readonly addedAt: number;
  readonly scannedAt: number;
}

export interface FolderScanResult {
  readonly files: readonly ProductFile[];
  readonly totalSize: number;
}

export interface FolderScanOptions {
  readonly onProgress?: ProgressReporter;
  /**
   * Parse any `.unitypackage` found and index its internal file tree alongside
   * the package's own row (default `true`). Set `false` to keep each package as
   * a single opaque file row, matched by name only.
   */
  readonly parsePackages?: boolean;
}

/**
 * Walk a folder, classifying every file and summing total bytes. `fullPath` is
 * the absolute on-disk path (so per-file reveal can open the real file); the
 * other fields come from the shared file-type helpers. When `parsePackages` is
 * on (the default), each `.unitypackage` is also unpacked and its internal
 * files appended (see below).
 */
export async function scanFolder(
  path: string,
  opts: FolderScanOptions = {},
): Promise<FolderScanResult> {
  const { onProgress, parsePackages = true } = opts;
  const files: ProductFile[] = [];
  let totalSize = 0;
  let count = 0;
  for await (const filePath of walkFiles(path)) {
    let st;
    try {
      st = await stat(filePath);
    } catch {
      continue; // vanished between walk and stat — skip
    }
    totalSize += st.size;
    const fileName = baseNameOf(filePath);
    files.push({
      fullPath: filePath,
      fileName,
      ext: extOf(filePath),
      typeBucket: bucketForPath(filePath),
      source: "local",
    });
    count += 1;
    onProgress?.({
      phase: "folder",
      current: count,
      total: 0,
      message: `Scanning ${fileName}…`,
      detail: fileName,
    });

    // Deep-index a `.unitypackage`: keep its own row above (so it stays
    // findable/revealable by name and its bytes are counted once), then append
    // every internal file. We override `nestedPkg` to the package's *absolute
    // on-disk path* so reveal can open the containing archive — each internal
    // `fullPath` stays the internal project path (e.g. `Assets/SFX/click.wav`),
    // matching how cache-indexed packages are stored.
    if (parsePackages && isUnityPackage(filePath)) {
      onProgress?.({
        phase: "folder",
        current: count,
        total: 0,
        message: `Unpacking ${fileName}…`,
        detail: fileName,
      });
      try {
        const parsed = await parseUnityPackageFile(filePath, { recurse: true });
        for (const f of parsed.files) {
          files.push({ ...f, source: "local", nestedPkg: filePath });
        }
      } catch {
        // Corrupt/unreadable archive: keep only the package's own row above and
        // continue — one bad package must never abort the whole folder scan.
      }
    }
  }
  return { files, totalSize };
}

/** Build the synthetic IndexedProduct for a scanned folder. */
export function buildFolderIndexedProduct(
  path: string,
  files: readonly ProductFile[],
): IndexedProduct {
  const product: CatalogProduct = {
    id: folderProductId(path),
    name: baseNameOf(path) || path,
    // The full path doubles as the card subtitle; publisher weight is low and
    // these rows are excluded from the publisher filter (see repository).
    publisher: path,
    isHidden: false,
  };
  return {
    product,
    tags: [],
    isWrapper: false,
    coverage: "deep",
    source: "local",
    storeUrl: "", // a local folder has no store page
    localPath: path,
    files,
  };
}

/** Map a stored registry row to the engine/UI-facing {@link LocalFolderInfo}. */
export function folderInfoFromRow(row: LocalFolderRow): LocalFolderInfo {
  return {
    path: row.path,
    name: baseNameOf(row.path) || row.path,
    productId: row.product_id,
    fileCount: row.file_count,
    totalSize: row.total_size,
    status: row.status,
    addedAt: row.added_at,
    scannedAt: row.scanned_at,
  };
}

/**
 * Scan a folder, (re)write its synthetic product + files atomically, and record
 * the registry row. Re-running is last-write-wins (the original `added_at` is
 * preserved by the repository). Returns the resulting registry info.
 */
export async function indexFolder(
  repo: Repository,
  path: string,
  now: number,
  opts: FolderScanOptions = {},
): Promise<LocalFolderInfo> {
  const { files, totalSize } = await scanFolder(path, opts);
  // A zero-file result is ambiguous: either a genuinely empty folder, or one
  // that vanished/became unreadable mid-scan (walkFiles swallows that). Before
  // replacing a possibly-valid index with nothing, confirm the root is still
  // readable; if not, throw so the caller keeps the old index and flags the
  // folder "missing" (keep & warn) rather than wiping it.
  if (files.length === 0) {
    try {
      await readdir(path);
    } catch {
      throw new Error(`Folder is no longer readable: ${path}`);
    }
  }
  const indexed = buildFolderIndexedProduct(path, files);
  // Write the product/files and the registry row in ONE transaction, so a
  // failure can never orphan a searchable product with no registry row.
  repo.writeFolderIndex(
    indexed,
    {
      path,
      productId: indexed.product.id,
      fileCount: files.length,
      totalSize,
      status: "ok",
      addedAt: now,
      scannedAt: now,
    },
    now,
  );
  return folderInfoFromRow(repo.getLocalFolder(path)!);
}
