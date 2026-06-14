import type { Repository } from "../index/repository.js";
import type { HttpClient } from "../store/http.js";
import { fetchProductMetadata } from "../store/productPage.js";

/**
 * Store-page keyword fetch (spec §3.4), run as part of catalog import: for
 * products lacking keywords, GET the public product page and index its
 * **category** + **related keywords** — the single best field for keyword
 * matching (powers the GUI keyword cloud). One plain GET per product, no auth.
 */

export interface EnrichOptions {
  readonly limit?: number;
  readonly delayMs?: number;
  readonly now?: number;
  /** Re-fetch every product, not just those missing keywords (refresh). */
  readonly force?: boolean;
  readonly onProgress?: (message: string) => void;
}

export interface EnrichResult {
  readonly attempted: number;
  readonly enriched: number;
  readonly errors: ReadonlyArray<{ productId: string; error: string }>;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

export async function enrichProducts(
  repo: Repository,
  http: HttpClient,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const now = opts.now ?? Date.now();
  const log = opts.onProgress ?? (() => {});
  const delayMs = opts.delayMs ?? 0;
  const ids = repo.listProductsToEnrich(opts.limit, opts.force ?? false);

  let enriched = 0;
  const errors: Array<{ productId: string; error: string }> = [];

  for (let i = 0; i < ids.length; i++) {
    const productId = ids[i]!;
    try {
      log(`Enriching ${productId}…`);
      const meta = await fetchProductMetadata(http, productId);
      if (meta.keywords.length > 0 || meta.category) {
        repo.enrichProduct(
          productId,
          {
            ...(meta.category ? { category: meta.category } : {}),
            tags: meta.keywords,
          },
          now,
        );
        enriched += 1;
      }
    } catch (err) {
      errors.push({ productId, error: (err as Error).message });
    }
    if (i < ids.length - 1) await sleep(delayMs);
  }

  return { attempted: ids.length, enriched, errors };
}
