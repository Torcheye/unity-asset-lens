import type { ProductFile } from "../domain/types.js";
import { bucketForPath, baseNameOf, extOf } from "../domain/fileType.js";
import { isWrapperByLeaves } from "../domain/wrapper.js";
import type { StoreClient } from "./graphql.js";
import {
  OPERATIONS,
  PREVIEW_ASSETS_PAGE_SIZE,
  PREVIEW_ASSETS_QUERY,
} from "./constants.js";

/**
 * Fetch and flatten a product's content tree via `PreviewAssets` (spec §3.4).
 * Returns a *flat* list of nodes carrying a `level` depth field, from which we
 * reconstruct full paths client-side (the Appendix A algorithm).
 */

export interface AssetNode {
  readonly guid?: string;
  readonly label: string;
  readonly level: number;
  readonly type: string; // "folder" | "file"
}

interface PreviewAssetsData {
  product?: {
    id?: string;
    name?: string;
    assets?: AssetNode[];
  };
}

/**
 * Reconstruct full paths from the flat, level-tagged node list (Appendix A).
 * `stack[level]` tracks the current label at each depth; a file node's path is
 * the stack joined to its level.
 */
export function reconstructPaths(
  nodes: readonly AssetNode[],
): Array<{ path: string; isFile: boolean }> {
  const stack: string[] = [];
  const out: Array<{ path: string; isFile: boolean }> = [];
  for (const node of nodes) {
    const level = Math.max(0, node.level | 0);
    stack[level] = node.label;
    stack.length = level + 1; // drop any deeper, stale labels
    out.push({ path: stack.join("/"), isFile: node.type === "file" });
  }
  return out;
}

export interface FetchTreeOptions {
  readonly pageSize?: number;
  /** Hard cap on pages, to avoid runaway loops on a misbehaving endpoint. */
  readonly maxPages?: number;
}

/** Fetch every page of a product's asset tree, concatenating the flat nodes. */
export async function fetchAssetNodes(
  client: StoreClient,
  productId: string,
  opts: FetchTreeOptions = {},
): Promise<AssetNode[]> {
  const pageSize = opts.pageSize ?? PREVIEW_ASSETS_PAGE_SIZE;
  const maxPages = opts.maxPages ?? 1000;
  const all: AssetNode[] = [];
  for (let page = 0; page < maxPages; page++) {
    const result = await client.operation<PreviewAssetsData>(
      OPERATIONS.previewAssets,
      PREVIEW_ASSETS_QUERY,
      { id: productId, page },
    );
    const assets = result.data?.product?.assets ?? [];
    if (assets.length === 0) break;
    all.push(...assets);
    // "page shorter than N ⇒ last" heuristic (spec §10).
    if (assets.length < pageSize) break;
  }
  return all;
}

export interface OnlineProductTree {
  readonly files: readonly ProductFile[];
  readonly isWrapper: boolean;
}

function toOnlineFile(path: string): ProductFile {
  const fileName = baseNameOf(path);
  return {
    fullPath: path,
    fileName,
    ext: extOf(fileName),
    typeBucket: bucketForPath(fileName),
    source: "online",
  };
}

/**
 * Fetch a product's online file list. Wrapper packages are opaque online — the
 * nested `.unitypackage` shows as a single leaf — so they are flagged
 * `isWrapper` for lazy deep-indexing on download (spec §3.3, §5.4).
 */
export async function fetchOnlineProductTree(
  client: StoreClient,
  productId: string,
  opts: FetchTreeOptions = {},
): Promise<OnlineProductTree> {
  const nodes = await fetchAssetNodes(client, productId, opts);
  const reconstructed = reconstructPaths(nodes);
  const filePaths = reconstructed.filter((r) => r.isFile).map((r) => r.path);
  return {
    files: filePaths.map(toOnlineFile),
    isWrapper: isWrapperByLeaves(filePaths),
  };
}
