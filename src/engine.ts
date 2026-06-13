import { readFile } from "node:fs/promises";
import type {
  GroupedSearchResult,
  ProductPageMetadata,
} from "./domain/types.js";
import {
  liveEnv,
  resolveCacheRoot,
  defaultDbPath,
  type PathEnv,
} from "./config/paths.js";
import { openDatabase, type DB } from "./index/db.js";
import { Repository, type IndexStats } from "./index/repository.js";
import { search, type SearchOptions } from "./index/search.js";
import { parseMyAssetsText } from "./catalog/parseMyAssets.js";
import {
  indexLocalCache,
  indexPackage,
  type LocalIndexOptions,
  type LocalIndexResult,
} from "./local/localIndexer.js";
import { statPackage } from "./local/scanCache.js";
import { buildCatalogMatcher } from "./local/matchCatalog.js";
import { fetchAnonymousSession, type StoreSession } from "./store/csrf.js";
import { createStoreClient } from "./store/graphql.js";
import { nodeHttp, type HttpClient } from "./store/http.js";
import {
  fetchOnlineProducts,
  type OnlineFetchOptions,
  type OnlineFetchResult,
} from "./online/fetchOnline.js";
import {
  enrichProducts,
  type EnrichOptions,
  type EnrichResult,
} from "./online/enrich.js";
import {
  downloadCommand,
  openCommand,
  revealCommand,
  spawnRunner,
  type CommandRunner,
  type OsCommand,
} from "./actions/actions.js";
import { watchCache, type CacheWatcher } from "./watcher/cacheWatcher.js";

/**
 * AssetLens engine — the standalone core (spec §8 decision). Composes catalog
 * import, local cache indexing, online content fetch, metadata enrichment,
 * search, and result actions over a single global SQLite index (spec §4).
 */

export interface EngineOptions {
  readonly dbPath?: string;
  readonly cacheRoot?: string;
  readonly env?: PathEnv;
  readonly http?: HttpClient;
  readonly readonly?: boolean;
}

export class AssetLensEngine {
  readonly repo: Repository;
  readonly cacheRoot: string;
  readonly #db: DB;
  readonly #env: PathEnv;
  readonly #http: HttpClient;

  private constructor(db: DB, env: PathEnv, cacheRoot: string, http: HttpClient) {
    this.#db = db;
    this.#env = env;
    this.cacheRoot = cacheRoot;
    this.#http = http;
    this.repo = new Repository(db);
  }

  static open(opts: EngineOptions = {}): AssetLensEngine {
    const env = opts.env ?? liveEnv();
    const dbPath = opts.dbPath ?? defaultDbPath(env);
    const cacheRoot = resolveCacheRoot(env, opts.cacheRoot);
    const db = openDatabase({ path: dbPath, ...(opts.readonly ? { readonly: true } : {}) });
    return new AssetLensEngine(db, env, cacheRoot, opts.http ?? nodeHttp);
  }

  close(): void {
    this.#db.close();
  }

  // ---- catalog (spec §5.1) -------------------------------------------------

  /** Import the owned-product catalog from a console-export JSON file. */
  async importCatalogFile(
    path: string,
  ): Promise<{ imported: number; skipped: number }> {
    return this.importCatalogJson(await readFile(path, "utf8"));
  }

  importCatalogJson(text: string): { imported: number; skipped: number } {
    const { products, skipped } = parseMyAssetsText(text);
    const imported = this.repo.importCatalog(products, Date.now());
    return { imported, skipped };
  }

  // ---- local indexing (spec §5.2, §5.3) ------------------------------------

  scanLocal(opts: LocalIndexOptions = {}): Promise<LocalIndexResult> {
    return indexLocalCache(
      this.repo,
      this.cacheRoot,
      this.repo.listCatalogProducts(),
      opts,
    );
  }

  // ---- online content + enrichment (spec §5.4, §5.5) -----------------------

  /** Build an anonymous CSRF session for PreviewAssets (no login). */
  async anonymousSession(): Promise<StoreSession> {
    return fetchAnonymousSession(this.#http);
  }

  async fetchOnline(
    session: StoreSession,
    opts: OnlineFetchOptions = {},
  ): Promise<OnlineFetchResult> {
    const client = createStoreClient(this.#http, session);
    return fetchOnlineProducts(this.repo, client, opts);
  }

  enrich(opts: EnrichOptions = {}): Promise<EnrichResult> {
    return enrichProducts(this.repo, this.#http, opts);
  }

  fetchProductMetadataPreview(productId: string): Promise<ProductPageMetadata> {
    // exposed mainly for diagnostics/tests
    return import("./store/productPage.js").then((m) =>
      m.fetchProductMetadata(this.#http, productId),
    );
  }

  // ---- search (spec §7) ----------------------------------------------------

  search(query: string, opts?: SearchOptions): GroupedSearchResult[] {
    return search(this.#db, query, opts);
  }

  stats(): IndexStats {
    return this.repo.stats();
  }

  listPublishers(): string[] {
    return this.repo.listPublishers();
  }

  // ---- result actions (spec §7) --------------------------------------------

  async revealFile(
    fileId: number,
    runner: CommandRunner = spawnRunner,
  ): Promise<OsCommand> {
    const file = this.repo.getFile(fileId);
    if (!file) throw new Error(`No file with id ${fileId}`);
    if (!file.local_path) {
      throw new Error(
        "This file's product is not downloaded yet — use `download` first.",
      );
    }
    const command = revealCommand(this.#env.platform, file.local_path);
    await runner(command);
    return command;
  }

  async openStoreForFile(
    fileId: number,
    runner: CommandRunner = spawnRunner,
  ): Promise<OsCommand> {
    const file = this.repo.getFile(fileId);
    if (!file) throw new Error(`No file with id ${fileId}`);
    const command = openCommand(this.#env.platform, file.store_url);
    await runner(command);
    return command;
  }

  async openStoreForProduct(
    productId: string,
    runner: CommandRunner = spawnRunner,
  ): Promise<OsCommand> {
    const product = this.repo.getProduct(productId);
    if (!product) throw new Error(`No product with id ${productId}`);
    const command = openCommand(this.#env.platform, product.store_url);
    await runner(command);
    return command;
  }

  async download(
    productId: string,
    runner: CommandRunner = spawnRunner,
  ): Promise<OsCommand> {
    const product = this.repo.getProduct(productId);
    if (!product) throw new Error(`No product with id ${productId}`);
    const command = downloadCommand(
      this.#env.platform,
      product.kharma_id ?? product.product_id,
    );
    await runner(command);
    return command;
  }

  // ---- watcher (spec §5.7) -------------------------------------------------

  /**
   * Watch the cache and deep-index newly-downloaded packages (download → local
   * → searchable). Calls `onIndexed` with the product id after each package.
   */
  watch(
    onIndexed?: (productId: string, filePath: string) => void,
    onError?: (err: Error) => void,
  ): CacheWatcher {
    return watchCache(
      this.cacheRoot,
      (filePath) => {
        void this.#indexSingle(filePath)
          .then((productId) => {
            if (productId && onIndexed) onIndexed(productId, filePath);
          })
          .catch((err) => onError?.(err as Error));
      },
      onError ? { onError } : {},
    );
  }

  async #indexSingle(filePath: string): Promise<string | undefined> {
    const pkg = await statPackage(this.cacheRoot, filePath);
    if (!pkg) return undefined;
    const matcher = buildCatalogMatcher(this.repo.listCatalogProducts());
    const matched = matcher.match(pkg);
    const indexed = await indexPackage(this.repo, pkg, matched, Date.now(), true);
    return indexed.product.id;
  }
}
