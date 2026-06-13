import type { CatalogProduct } from "../domain/types.js";

/**
 * Match a locally-cached package to a catalog product (spec §4: a product is
 * deep-indexed locally). The cache path gives Publisher + Name but not the
 * store id, so we match by a normalised name, preferring a same-publisher
 * match and falling back to a globally-unique name match.
 */

export interface MatchablePackage {
  readonly publisher: string;
  readonly name: string;
}

/** Normalise for fuzzy comparison: lowercase, strip all non-alphanumerics. */
export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export interface CatalogMatcher {
  match(pkg: MatchablePackage): CatalogProduct | undefined;
}

/**
 * Build a matcher over the catalog. Name keys that map to more than one product
 * are treated as ambiguous and only resolved when the publisher also matches.
 */
export function buildCatalogMatcher(
  products: readonly CatalogProduct[],
): CatalogMatcher {
  const byPublisherName = new Map<string, CatalogProduct>();
  const byName = new Map<string, CatalogProduct[]>();

  for (const p of products) {
    const nameKey = normalizeKey(p.name);
    const pubNameKey = `${normalizeKey(p.publisher)}::${nameKey}`;
    byPublisherName.set(pubNameKey, p);
    const list = byName.get(nameKey);
    if (list) list.push(p);
    else byName.set(nameKey, [p]);
  }

  return {
    match(pkg: MatchablePackage): CatalogProduct | undefined {
      const nameKey = normalizeKey(pkg.name);
      const pubNameKey = `${normalizeKey(pkg.publisher)}::${nameKey}`;
      const exact = byPublisherName.get(pubNameKey);
      if (exact) return exact;
      // Fall back to name-only, but only when unambiguous.
      const candidates = byName.get(nameKey);
      return candidates && candidates.length === 1 ? candidates[0] : undefined;
    },
  };
}
