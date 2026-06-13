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

/**
 * `searchMyAssets` query — the owned-library listing (spec §3.4, §5.1). Needs a
 * logged-in session, so it is run from inside the user's authenticated browser
 * during `assetlens login` (see `auth/`). The browser console exporter mirrors
 * this string; keep them in sync.
 */
export const SEARCH_MY_ASSETS_QUERY = `query searchMyAssets($page: Int, $pageSize: Int, $sortBy: Int, $tagging: [String]) {
  searchMyAssets(page: $page, pageSize: $pageSize, sortBy: $sortBy, tagging: $tagging) {
    total
    results {
      id
      productId
      itemId
      name
      publisher { name }
      downloadSize
      currentVersion { name publishedDate }
    }
  }
}`;

/** Page size for `searchMyAssets` pagination during browser login. */
export const SEARCH_MY_ASSETS_PAGE_SIZE = 100;

/**
 * The signed-in "My Assets" page. Navigating here forces Unity's login flow if
 * the user is not authenticated, giving the login browser a same-origin page
 * from which to run `searchMyAssets`.
 */
export const MY_ASSETS_URL = `${STORE_ORIGIN}/account/assets`;

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
