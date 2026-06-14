/**
 * Centralised Asset Store endpoint + operation strings.
 *
 * Spec §10 (risks): "Undocumented endpoints can change. Keep operation strings
 * in one module." This is that module — re-capture via the DevTools/XHR-patch
 * recipe in the README if Unity changes them.
 */

export const STORE_ORIGIN = "https://assetstore.unity.com";

export const GRAPHQL_BATCH_PATH = "/api/graphql/batch";

export const GRAPHQL_BATCH_URL = `${STORE_ORIGIN}${GRAPHQL_BATCH_PATH}`;

/** GraphQL operation names sent in the `operations` header (spec §3.4). */
export const OPERATIONS = {
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
 * Owned-library discovery (spec §5.1), as observed from the live storefront.
 *
 * There is no `searchMyAssets` operation. The signed-in "My Assets" page fires
 * a `CurrentUser` query whose `user.myAssets` field is a JSON-encoded string
 * array of the owned product IDs. AssetLens reads that list (which doubles as
 * the sign-in signal), then resolves each ID to catalog metadata via batched
 * `Product` queries — exactly how the storefront itself does it.
 */
export const CURRENT_USER_OPERATION = "CurrentUser";

export const PRODUCT_OPERATION = "Product";

/**
 * Minimal `Product` query to resolve an owned ID to catalog metadata. The
 * storefront's own query selects far more; we request only what the catalog and
 * enrichment need. Sent batched (one operation per ID) in a single request.
 */
export const PRODUCT_QUERY = `query Product($id: ID!) {
  product(id: $id) {
    id
    productId
    itemId
    name
    downloadSize
    publisher { name }
    currentVersion { name publishedDate }
  }
}`;

/** How many `Product` operations to batch into one GraphQL request. */
export const OWNED_DETAIL_BATCH_SIZE = 25;

/**
 * The signed-in "My Assets" page. Navigating here forces Unity's login flow if
 * the user is not authenticated, and once signed in the page fires the
 * `CurrentUser` query AssetLens listens for.
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
