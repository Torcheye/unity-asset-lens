import type { AssetLensEngine } from "../engine.js";
import type { IndexStats } from "../index/repository.js";

/**
 * The GUI "library snapshot": index stats plus the two infographics
 * (asset-type breakdown + keyword cloud) and the publisher filter options.
 * Assembled from the repository so the browser never touches SQLite directly.
 */
export interface OverviewPayload {
  readonly stats: IndexStats;
  readonly buckets: ReadonlyArray<{ bucket: string; count: number }>;
  readonly keywords: ReadonlyArray<{ keyword: string; count: number }>;
  readonly publishers: readonly string[];
  readonly cacheRoot: string;
  /** Convenience flag: a usable index (has at least one indexed file). */
  readonly ready: boolean;
}

export function buildOverview(engine: AssetLensEngine): OverviewPayload {
  const stats = engine.stats();
  return {
    stats,
    buckets: engine.repo.typeBucketCounts(),
    keywords: engine.repo.topKeywords(26),
    publishers: engine.listPublishers(),
    cacheRoot: engine.cacheRoot,
    ready: stats.files > 0,
  };
}
