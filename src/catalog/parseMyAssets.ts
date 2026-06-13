import type { CatalogProduct } from "../domain/types.js";

/**
 * Parse an owned-product catalog into normalised {@link CatalogProduct}s
 * (spec §5.1). The primary producer is the browser login (`auth/`), which passes
 * a bare array of `Product` nodes; `assetlens import <file>` can also load a
 * previously captured JSON.
 *
 * The shape varies depending on how it was captured, so this is deliberately
 * tolerant. It accepts, in order of preference:
 *  - a bare array of product objects
 *  - a `{ results: [...] }` / `{ products: [...] }` wrapper
 *  - a raw `graphql/batch` response array: `[{ data: { <op>: { results: [...] } } }]`
 *
 * Each product node is normalised; rows without a usable id are dropped (and
 * reported) rather than throwing, so one malformed entry never loses the rest.
 */

export interface ParseResult {
  readonly products: readonly CatalogProduct[];
  /** Count of nodes skipped because they had no resolvable id. */
  readonly skipped: number;
}

type Json = unknown;

function asRecord(value: Json): Record<string, Json> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : undefined;
}

function asString(value: Json): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: Json): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Pull the publisher name out of the various shapes it appears in. */
function publisherName(node: Record<string, Json>): string {
  const pub = node.publisher;
  const rec = asRecord(pub);
  return (
    (rec && asString(rec.name)) ??
    asString(pub) ??
    asString(node.publisherName) ??
    "Unknown"
  );
}

function version(node: Record<string, Json>): string | undefined {
  const cur = asRecord(node.currentVersion);
  return (cur && asString(cur.name)) ?? asString(node.version);
}

function publishedDate(node: Record<string, Json>): string | undefined {
  const cur = asRecord(node.currentVersion);
  return (cur && asString(cur.publishedDate)) ?? asString(node.publishedDate);
}

/** Heuristic: an asset tagged `#BIN` (or flagged hidden) is archived/hidden. */
function isHidden(node: Record<string, Json>): boolean {
  if (node.isHidden === true || node.hidden === true) return true;
  const tagging = node.tagging;
  if (Array.isArray(tagging)) {
    return tagging.some((t) => asString(t)?.toUpperCase() === "#BIN");
  }
  return false;
}

function normalizeProduct(node: Record<string, Json>): CatalogProduct | undefined {
  const id =
    asString(node.id) ?? asString(node.productId) ?? asString(node.itemId);
  if (!id) return undefined;
  return {
    id,
    productId: asString(node.productId) ?? asString(node.id),
    itemId: asString(node.itemId),
    name: asString(node.name) ?? asString(node.displayName) ?? `Product ${id}`,
    publisher: publisherName(node),
    downloadSize: asNumber(node.downloadSize),
    version: version(node),
    publishedDate: publishedDate(node),
    isHidden: isHidden(node),
  };
}

/** Dig through known wrapper shapes to find the array of product nodes. */
function extractProductNodes(root: Json): Json[] {
  if (Array.isArray(root)) {
    // Could be a bare product array, or a graphql/batch response array.
    const looksLikeBatch = root.some((el) => {
      const rec = asRecord(el);
      return rec !== undefined && "data" in rec;
    });
    if (!looksLikeBatch) return root;
    return root.flatMap((el) => extractFromOperation(el));
  }
  const rec = asRecord(root);
  if (!rec) return [];
  if (Array.isArray(rec.results)) return rec.results;
  if (Array.isArray(rec.products)) return rec.products;
  return extractFromOperation(rec);
}

/** From one `{ data: { <op>: { results } } }` graphql operation object. */
function extractFromOperation(node: Json): Json[] {
  const rec = asRecord(node);
  if (!rec) return [];
  const data = asRecord(rec.data);
  if (!data) {
    if (Array.isArray(rec.results)) return rec.results;
    if (Array.isArray(rec.products)) return rec.products;
    return [];
  }
  // Find the first object child carrying a `results` array.
  for (const value of Object.values(data)) {
    const op = asRecord(value);
    if (op && Array.isArray(op.results)) return op.results;
    if (op && Array.isArray(op.products)) return op.products;
  }
  return [];
}

/** Parse already-decoded JSON (any of the accepted shapes) into products. */
export function parseMyAssets(json: Json): ParseResult {
  const nodes = extractProductNodes(json);
  const products: CatalogProduct[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const node of nodes) {
    const rec = asRecord(node);
    const normalized = rec ? normalizeProduct(rec) : undefined;
    if (!normalized) {
      skipped += 1;
      continue;
    }
    if (seen.has(normalized.id)) continue; // de-dupe across pages
    seen.add(normalized.id);
    products.push(normalized);
  }
  return { products, skipped };
}

/** Convenience: parse a raw JSON string. Throws only on invalid JSON syntax. */
export function parseMyAssetsText(text: string): ParseResult {
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Catalog file is not valid JSON: ${(err as Error).message}. ` +
        `Expected a JSON array of owned-product nodes (spec §5.1).`,
    );
  }
  return parseMyAssets(json);
}
