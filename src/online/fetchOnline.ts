import type { IndexedProduct } from "../domain/types.js";
import type { Repository } from "../index/repository.js";
import type { StoreClient } from "../store/graphql.js";
import {
  fetchOnlineProductTree,
  type FetchTreeOptions,
} from "../store/previewAssets.js";

/**
 * Online content fetch (spec §5.4): for owned-but-not-downloaded products, pull
 * the file tree via `PreviewAssets` and deep-index it. Wrapper packages are
 * opaque online, so they are recorded as `coverage = shallow` and left for lazy
 * deep-indexing on download (spec §3.3).
 */

export interface OnlineFetchOptions extends FetchTreeOptions {
  /** Max products to fetch this run. */
  readonly limit?: number;
  /** Politeness delay between products in ms (spec §10 throttling). */
  readonly delayMs?: number;
  readonly now?: number;
  readonly onProgress?: (message: string) => void;
}

export interface OnlineFetchResult {
  readonly attempted: number;
  readonly deepIndexed: number;
  readonly wrappers: number;
  readonly errors: ReadonlyArray<{ productId: string; error: string }>;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

export async function fetchOnlineProducts(
  repo: Repository,
  client: StoreClient,
  opts: OnlineFetchOptions = {},
): Promise<OnlineFetchResult> {
  const now = opts.now ?? Date.now();
  const log = opts.onProgress ?? (() => {});
  const delayMs = opts.delayMs ?? 0;
  const ids = repo.listProductsToFetchOnline(opts.limit);

  let deepIndexed = 0;
  let wrappers = 0;
  const errors: Array<{ productId: string; error: string }> = [];

  for (let i = 0; i < ids.length; i++) {
    const productId = ids[i]!;
    const catalog = repo.catalogProductFor(productId);
    const row = repo.getProduct(productId);
    if (!catalog || !row) continue;

    try {
      log(`Fetching online tree for ${catalog.name}…`);
      const tree = await fetchOnlineProductTree(client, productId, opts);
      const indexed: IndexedProduct = {
        product: catalog,
        tags: [],
        isWrapper: tree.isWrapper,
        coverage: tree.isWrapper ? "shallow" : "deep",
        source: "online",
        storeUrl: row.store_url,
        files: tree.isWrapper ? [] : tree.files,
      };
      repo.writeIndexedProduct(indexed, now);
      if (tree.isWrapper) wrappers += 1;
      else deepIndexed += 1;
    } catch (err) {
      errors.push({ productId, error: (err as Error).message });
    }
    if (i < ids.length - 1) await sleep(delayMs);
  }

  return { attempted: ids.length, deepIndexed, wrappers, errors };
}
