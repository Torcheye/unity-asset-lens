import type { Repository } from "../index/repository.js";
import type { HttpClient } from "../store/http.js";
import type { ProgressReporter } from "../domain/progress.js";
import { fetchProductMetadata } from "../store/productPage.js";

/**
 * Store-page keyword fetch (spec §3.4), run as part of catalog import: for
 * products lacking keywords, GET the public product page and index its
 * **category** + **related keywords** — the single best field for keyword
 * matching (powers the GUI keyword cloud). One plain GET per product, no auth.
 */

export interface EnrichOptions {
  readonly limit?: number;
  /**
   * Politeness pause (ms) a worker waits *after* a fetch before claiming the
   * next product. With {@link concurrency} workers the effective request rate
   * is roughly `concurrency / (delayMs + latency)`.
   */
  readonly delayMs?: number;
  /**
   * Max product pages fetched in parallel (default {@link DEFAULT_CONCURRENCY}).
   * Each page is an independent, auth-free GET, so the work is network-bound and
   * scales near-linearly with this up to the point of straining the store.
   */
  readonly concurrency?: number;
  readonly now?: number;
  /** Re-fetch every product, not just those missing keywords (refresh). */
  readonly force?: boolean;
  readonly onProgress?: ProgressReporter;
}

export interface EnrichResult {
  readonly attempted: number;
  readonly enriched: number;
  readonly errors: ReadonlyArray<{ productId: string; error: string }>;
}

/** Parallel product-page fetches. Polite to the store, ~6× a serial run. */
const DEFAULT_CONCURRENCY = 6;

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

export async function enrichProducts(
  repo: Repository,
  http: HttpClient,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const now = opts.now ?? Date.now();
  const report = opts.onProgress ?? (() => {});
  const delayMs = opts.delayMs ?? 0;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const ids = repo.listProductsToEnrich(opts.limit, opts.force ?? false);
  const total = ids.length;

  let enriched = 0;
  let completed = 0;
  const errors: Array<{ productId: string; error: string }> = [];

  // Show the counter at 0 before the first page returns (workers run in
  // parallel, so progress lands as each *finishes*, not as it starts).
  if (total > 0) {
    report({ phase: "enrich", current: 0, total, message: `Enriching ${total} products…` });
  }

  // Shared cursor over `ids`. JS is single-threaded, so `next++`, the counters,
  // and each synchronous `repo.enrichProduct` write never interleave between
  // awaits — no locking needed despite the concurrent fetches.
  let next = 0;
  async function worker(): Promise<void> {
    while (next < ids.length) {
      const productId = ids[next++]!;
      try {
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
      completed += 1;
      report({
        phase: "enrich",
        current: completed,
        total,
        message: `Enriching ${productId}…`,
        detail: productId,
      });
      if (next < ids.length) await sleep(delayMs);
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, ids.length) }, () =>
    worker(),
  );
  await Promise.all(pool);

  return { attempted: ids.length, enriched, errors };
}
