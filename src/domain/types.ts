/**
 * Core domain types shared across the engine.
 *
 * These mirror the index schema sketched in spec §6 but are kept independent
 * of the storage layer so parsing/fetching code never depends on SQLite.
 */

/** Whether we have a product's real per-file paths, or only product-level metadata. */
export type Coverage = "deep" | "shallow";

/** Where a product's indexed data came from. */
export type Source = "local" | "online";

/** Coarse file-type bucket inferred from the extension (spec §6 `files.ext`). */
export type FileTypeBucket =
  | "audio"
  | "model"
  | "prefab"
  | "texture"
  | "script"
  | "animation"
  | "material"
  | "scene"
  | "shader"
  | "font"
  | "video"
  | "data"
  | "package"
  | "other";

/**
 * One owned product (asset) from the catalog (`CurrentUser.myAssets` + `Product`).
 * `id` is the store id used for `PreviewAssets` and the public store URL;
 * `productId` is preferred for the `kharma` download deep link when present.
 */
export interface CatalogProduct {
  readonly id: string;
  readonly productId?: string;
  readonly itemId?: string;
  readonly name: string;
  readonly publisher: string;
  readonly downloadSize?: number;
  readonly version?: string;
  readonly publishedDate?: string;
  readonly isHidden: boolean;
}

/** Product metadata from the public product-page GET (spec §3.4). */
export interface ProductPageMetadata {
  readonly category?: string;
  /** Curated "related keywords" — the single best metadata field for matching. */
  readonly keywords: readonly string[];
}

/** A single file inside a product (spec §6 `files`). */
export interface ProductFile {
  /** Reconstructed project-relative path, e.g. `Assets/SFX/UI/click_01.wav`. */
  readonly fullPath: string;
  readonly fileName: string;
  readonly ext: string;
  readonly typeBucket: FileTypeBucket;
  /** Which inner `.unitypackage` this came from, if it was a nested wrapper. */
  readonly nestedPkg?: string;
  readonly source: Source;
}

/** A fully-resolved product ready to be written to the index. */
export interface IndexedProduct {
  readonly product: CatalogProduct;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly description?: string;
  readonly isWrapper: boolean;
  readonly coverage: Coverage;
  readonly source: Source;
  readonly storeUrl: string;
  readonly localPath?: string;
  readonly files: readonly ProductFile[];
}

/** A search hit returned to the UI/CLI. */
export interface SearchHit {
  readonly fileId: number;
  readonly productId: string;
  readonly productName: string;
  readonly publisher: string;
  readonly fullPath: string;
  readonly fileName: string;
  readonly typeBucket: FileTypeBucket;
  readonly source: Source;
  readonly coverage: Coverage;
  readonly localPath?: string;
  readonly storeUrl: string;
  /** Lower is a better match (derived from bm25 + local boost). */
  readonly score: number;
}

/** Search hits grouped by their owning product (spec §7: "group by product"). */
export interface GroupedSearchResult {
  readonly productId: string;
  readonly productName: string;
  readonly publisher: string;
  readonly source: Source;
  readonly coverage: Coverage;
  readonly storeUrl: string;
  readonly localPath?: string;
  readonly bestScore: number;
  readonly totalHits: number;
  readonly hits: readonly SearchHit[];
}
