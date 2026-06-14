import type { CatalogProduct, IndexedProduct } from "../domain/types.js";
import type { Repository } from "../index/repository.js";
import { parseUnityPackageFile } from "../unpack/unitypackage.js";
import { storeSearchUrl, storeUrl } from "../store/constants.js";
import { scanCache, type ScannedPackage } from "./scanCache.js";
import { buildCatalogMatcher, normalizeKey } from "./matchCatalog.js";

/**
 * Local indexer (spec §5.3): scan the cache, parse each `.unitypackage` to its
 * file list (recursing nested wrappers), match it to a catalog product, and
 * write a deep-coverage local product to the index. Re-scans are incremental —
 * packages whose mtime/size are unchanged are skipped (spec §3.3).
 */

/** Stable synthetic product for a cached package with no catalog match. */
function syntheticProduct(pkg: ScannedPackage): CatalogProduct {
  return {
    id: `local:${normalizeKey(pkg.publisher)}/${normalizeKey(pkg.name)}`,
    name: pkg.name,
    publisher: pkg.publisher,
    isHidden: false,
  };
}

/** Build the IndexedProduct for a parsed local package. Exported for testing. */
export function buildLocalIndexedProduct(
  pkg: ScannedPackage,
  parsed: { files: IndexedProduct["files"]; isWrapper: boolean },
  matched: CatalogProduct | undefined,
): IndexedProduct {
  const product = matched ?? syntheticProduct(pkg);
  const url = matched ? storeUrl(product.id) : storeSearchUrl(pkg.name);
  return {
    product,
    ...(pkg.category ? { category: pkg.category } : {}),
    tags: [],
    isWrapper: parsed.isWrapper,
    coverage: "deep",
    source: "local",
    storeUrl: url,
    localPath: pkg.filePath,
    files: parsed.files,
  };
}

export interface LocalIndexOptions {
  readonly recurse?: boolean;
  /** Re-parse even if mtime/size are unchanged. */
  readonly force?: boolean;
  readonly now?: number;
  readonly onProgress?: (message: string) => void;
}

export interface LocalIndexResult {
  readonly scanned: number;
  readonly indexed: number;
  readonly skipped: number;
  readonly matched: number;
  /** `local:` placeholder products removed as superseded duplicates. */
  readonly pruned: number;
  readonly errors: ReadonlyArray<{ filePath: string; error: string }>;
}

/** Index a single already-scanned package into the repository. */
export async function indexPackage(
  repo: Repository,
  pkg: ScannedPackage,
  matched: CatalogProduct | undefined,
  now: number,
  recurse: boolean,
): Promise<IndexedProduct> {
  const parsed = await parseUnityPackageFile(pkg.filePath, { recurse });
  const indexed = buildLocalIndexedProduct(pkg, parsed, matched);
  repo.writeIndexedProduct(indexed, now);
  repo.recordScannedPackage(
    pkg.filePath,
    pkg.mtimeMs,
    pkg.size,
    indexed.product.id,
    now,
  );
  return indexed;
}

/** Scan the cache root and index every (changed) package. */
export async function indexLocalCache(
  repo: Repository,
  root: string,
  catalog: readonly CatalogProduct[],
  opts: LocalIndexOptions = {},
): Promise<LocalIndexResult> {
  const recurse = opts.recurse ?? true;
  const now = opts.now ?? Date.now();
  const log = opts.onProgress ?? (() => {});
  const matcher = buildCatalogMatcher(catalog);

  const packages = await scanCache(root);
  let indexed = 0;
  let skipped = 0;
  let matched = 0;
  const errors: Array<{ filePath: string; error: string }> = [];

  for (const pkg of packages) {
    if (!opts.force) {
      const prev = repo.getScannedPackage(pkg.filePath);
      if (prev && prev.mtime_ms === pkg.mtimeMs && prev.size === pkg.size) {
        skipped += 1;
        continue;
      }
    }
    const product = matcher.match(pkg);
    try {
      log(`Indexing ${pkg.publisher}/${pkg.name}…`);
      await indexPackage(repo, pkg, product, now, recurse);
      indexed += 1;
      if (product) matched += 1;
    } catch (err) {
      errors.push({ filePath: pkg.filePath, error: (err as Error).message });
    }
  }

  // After (re-)indexing, drop any `local:` placeholder rows whose files have
  // been re-homed onto a real store-id product for the same asset (e.g. the
  // catalog was imported after the first scan). Safe in every mode — see
  // Repository.pruneSupersededLocalProducts.
  const pruned = repo.pruneSupersededLocalProducts();

  return { scanned: packages.length, indexed, skipped, matched, pruned, errors };
}
