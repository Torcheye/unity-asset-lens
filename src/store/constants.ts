/**
 * Centralised Asset Store endpoint + operation strings.
 *
 * Spec §10 (risks): "Undocumented endpoints can change. Keep operation strings
 * in one module." This is that module — re-capture via the DevTools/XHR-patch
 * recipe in the README if Unity changes them.
 */

export const STORE_ORIGIN = "https://assetstore.unity.com";

export const GRAPHQL_BATCH_URL = `${STORE_ORIGIN}/api/graphql/batch`;

/** GraphQL operation names sent in the `operations` header (spec §3.4). */
export const OPERATIONS = {
  searchMyAssets: "searchMyAssets",
  previewAssets: "PreviewAssets",
} as const;

/** `PreviewAssets` query — flat `assets[]` with a `level` depth field (spec §3.4). */
export const PREVIEW_ASSETS_QUERY = `query PreviewAssets($id: ID!, $page: Int) {
  product(id: $id) {
    id
    name
    assets(page: $page) {
      guid
      assetId: asset_id
      label
      level
      type
    }
  }
}`;

/**
 * Page-size heuristic for `PreviewAssets` pagination (spec §10: "page shorter
 * than N ⇒ last"). Tunable; the loop also stops on an empty page.
 */
export const PREVIEW_ASSETS_PAGE_SIZE = 50;

/** Build the public store product URL from a store id (spec §7 open action). */
export function storeUrl(id: string): string {
  return `${STORE_ORIGIN}/packages/slug/${encodeURIComponent(id)}`;
}

/** Build a store search URL — used as the "open" target for local-only
 * packages that could not be matched to a known store product id. */
export function storeSearchUrl(query: string): string {
  return `${STORE_ORIGIN}/search?q=${encodeURIComponent(query)}`;
}

/**
 * Build the `kharma` deep link that opens Unity's Package Manager on a product
 * (spec §5.7 download action). Prefer `productId`, falling back to the store id.
 */
export function kharmaLink(productId: string): string {
  return `com.unity3d.kharma:content/${encodeURIComponent(productId)}`;
}
