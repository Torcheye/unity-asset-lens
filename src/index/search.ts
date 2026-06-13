import type { DB } from "./db.js";
import type {
  Coverage,
  FileTypeBucket,
  GroupedSearchResult,
  SearchHit,
  Source,
} from "../domain/types.js";

/**
 * FTS5 query + ranking (spec §7).
 *
 * Ranking intent: exact filename > path segment > metadata, with a boost for
 * files whose product is already local (actionable now). bm25() returns lower
 * (more negative) for better matches, so we order ascending and *subtract* the
 * local boost to push local hits earlier.
 */

/** Positional bm25 weights matching `files_fts` column order (schema.ts). */
export interface ColumnWeights {
  readonly fullPath: number;
  readonly fileName: number;
  readonly productName: number;
  readonly publisher: number;
  readonly category: number;
  readonly tags: number;
}

export const DEFAULT_WEIGHTS: ColumnWeights = {
  fullPath: 5,
  fileName: 10,
  productName: 3,
  publisher: 2,
  category: 2,
  tags: 4,
};

export const DEFAULT_LOCAL_BOOST = 2.0;

export interface SearchOptions {
  /** Max file hits to fetch before grouping (default 200). */
  readonly limit?: number;
  /** Restrict to one file-type bucket (spec §7 filters). */
  readonly typeBucket?: FileTypeBucket;
  /** Only products already downloaded locally. */
  readonly localOnly?: boolean;
  /** Restrict to one publisher. */
  readonly publisher?: string;
  readonly weights?: ColumnWeights;
  readonly localBoost?: number;
}

/**
 * Build a safe FTS5 MATCH expression from free-text input.
 *
 * Each whitespace term is wrapped as a quoted string (so FTS control chars are
 * treated literally) and given a `*` prefix for recall — `ui click` becomes
 * `"ui"* "click"*` (implicit AND across all indexed columns). Terms with no
 * word characters are dropped. Returns null when nothing searchable remains.
 */
export function buildMatchQuery(input: string): string | null {
  const hasWordChar = /[\p{L}\p{N}_]/u;
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of input.trim().split(/\s+/)) {
    if (!raw || !hasWordChar.test(raw)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(`"${raw.replace(/"/g, '""')}"*`);
  }
  return terms.length > 0 ? terms.join(" ") : null;
}

interface RawHitRow {
  id: number;
  product_id: string;
  product_name: string;
  publisher: string;
  full_path: string;
  file_name: string;
  type_bucket: string;
  source: Source;
  coverage: Coverage;
  local_path: string | null;
  store_url: string;
  score: number;
}

/** Run a keyword search, returning flat file hits ordered best-first. */
export function searchFiles(
  db: DB,
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const match = buildMatchQuery(query);
  if (!match) return [];

  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const boost = opts.localBoost ?? DEFAULT_LOCAL_BOOST;
  const limit = Math.max(1, opts.limit ?? 200);

  // bm25 weights are positional; product_id (UNINDEXED, last column) is omitted
  // and defaults to 1.0 — harmless since it never contributes to a match.
  const bm25 = `bm25(files_fts, ${w.fullPath}, ${w.fileName}, ${w.productName}, ${w.publisher}, ${w.category}, ${w.tags})`;
  const scoreExpr = `(${bm25} - CASE WHEN p.source = 'local' THEN ${boost} ELSE 0 END)`;

  const filters: string[] = ["files_fts MATCH ?"];
  const params: unknown[] = [match];
  if (opts.typeBucket) {
    filters.push("f.type_bucket = ?");
    params.push(opts.typeBucket);
  }
  if (opts.localOnly) {
    filters.push("p.source = 'local'");
  }
  if (opts.publisher) {
    filters.push("p.publisher = ?");
    params.push(opts.publisher);
  }
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT f.id, f.product_id, p.name AS product_name, p.publisher,
              f.full_path, f.file_name, f.type_bucket, f.source,
              p.coverage, p.local_path, p.store_url,
              ${scoreExpr} AS score
       FROM files_fts
       JOIN files f ON f.id = files_fts.rowid
       JOIN products p ON p.product_id = f.product_id
       WHERE ${filters.join(" AND ")}
       ORDER BY score ASC
       LIMIT ?`,
    )
    .all(...params) as RawHitRow[];

  return rows.map((r) => ({
    fileId: r.id,
    productId: r.product_id,
    productName: r.product_name,
    publisher: r.publisher,
    fullPath: r.full_path,
    fileName: r.file_name,
    typeBucket: r.type_bucket as FileTypeBucket,
    source: r.source,
    coverage: r.coverage,
    ...(r.local_path ? { localPath: r.local_path } : {}),
    storeUrl: r.store_url,
    score: r.score,
  }));
}

/** Group flat hits by product, preserving best-first order (spec §7). */
export function groupByProduct(hits: readonly SearchHit[]): GroupedSearchResult[] {
  const groups = new Map<string, SearchHit[]>();
  const order: string[] = [];
  for (const hit of hits) {
    let g = groups.get(hit.productId);
    if (!g) {
      g = [];
      groups.set(hit.productId, g);
      order.push(hit.productId);
    }
    g.push(hit);
  }

  return order.map((productId) => {
    const groupHits = groups.get(productId)!;
    const first = groupHits[0]!;
    const bestScore = groupHits.reduce((m, h) => Math.min(m, h.score), Infinity);
    return {
      productId,
      productName: first.productName,
      publisher: first.publisher,
      source: first.source,
      coverage: first.coverage,
      storeUrl: first.storeUrl,
      ...(first.localPath ? { localPath: first.localPath } : {}),
      bestScore,
      totalHits: groupHits.length,
      hits: groupHits,
    };
  });
}

/** Positional bm25 weights for `products_fts` (product-level metadata search). */
export const DEFAULT_PRODUCT_WEIGHTS = {
  productName: 6,
  publisher: 2,
  category: 3,
  tags: 5,
  description: 1,
} as const;

interface RawProductRow {
  product_id: string;
  product_name: string;
  publisher: string;
  source: Source;
  coverage: Coverage;
  store_url: string;
  local_path: string | null;
  score: number;
}

/**
 * Product-level metadata search (spec §4, §7): finds owned products by
 * name/keywords/category even when they have no indexed files yet. The
 * type-bucket filter is inapplicable here (no files), so it is ignored.
 */
export function searchProducts(
  db: DB,
  query: string,
  opts: SearchOptions = {},
): GroupedSearchResult[] {
  const match = buildMatchQuery(query);
  if (!match) return [];

  const w = DEFAULT_PRODUCT_WEIGHTS;
  const boost = opts.localBoost ?? DEFAULT_LOCAL_BOOST;
  const limit = Math.max(1, opts.limit ?? 200);
  const bm25 = `bm25(products_fts, ${w.productName}, ${w.publisher}, ${w.category}, ${w.tags}, ${w.description})`;
  const scoreExpr = `(${bm25} - CASE WHEN p.source = 'local' THEN ${boost} ELSE 0 END)`;

  const filters: string[] = ["products_fts MATCH ?"];
  const params: unknown[] = [match];
  if (opts.localOnly) filters.push("p.source = 'local'");
  if (opts.publisher) {
    filters.push("p.publisher = ?");
    params.push(opts.publisher);
  }
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT p.product_id, p.name AS product_name, p.publisher, p.source,
              p.coverage, p.store_url, p.local_path, ${scoreExpr} AS score
       FROM products_fts
       JOIN products p ON p.product_id = products_fts.product_id
       WHERE ${filters.join(" AND ")}
       ORDER BY score ASC
       LIMIT ?`,
    )
    .all(...params) as RawProductRow[];

  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    publisher: r.publisher,
    source: r.source,
    coverage: r.coverage,
    storeUrl: r.store_url,
    ...(r.local_path ? { localPath: r.local_path } : {}),
    bestScore: r.score,
    totalHits: 0,
    hits: [],
  }));
}

/**
 * Full search + group (spec §7): file-level hits grouped by product, plus
 * product-level metadata hits for owned products that have no file match yet
 * (e.g. not-downloaded wrappers). A type-bucket filter suppresses the
 * product-level pass since it concerns files only.
 */
export function search(
  db: DB,
  query: string,
  opts?: SearchOptions,
): GroupedSearchResult[] {
  const fileGroups = groupByProduct(searchFiles(db, query, opts));
  if (opts?.typeBucket) return fileGroups;

  const seen = new Set(fileGroups.map((g) => g.productId));
  const productOnly = searchProducts(db, query, opts).filter(
    (g) => !seen.has(g.productId),
  );

  // Merge and order best-first across both kinds of hit.
  return [...fileGroups, ...productOnly].sort((a, b) => a.bestScore - b.bestScore);
}
