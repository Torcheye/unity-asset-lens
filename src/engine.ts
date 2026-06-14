import { readFile } from "node:fs/promises";
import type { GroupedSearchResult } from "./domain/types.js";
import {
  liveEnv,
  resolveCacheRoot,
  defaultDbPath,
  defaultSessionStatePath,
  type PathEnv,
} from "./config/paths.js";
import { openDatabase, type DB } from "./index/db.js";
import { Repository, type IndexStats } from "./index/repository.js";
import { search, type SearchOptions } from "./index/search.js";
import { parseMyAssets, parseMyAssetsText } from "./catalog/parseMyAssets.js";
import {
  runBrowserLogin,
  type BrowserLauncher,
} from "./auth/browserLogin.js";
import { fileSessionStore, type SessionStore } from "./auth/sessionStore.js";
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
import { enrichProducts, type EnrichResult } from "./online/enrich.js";
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
 * import (which also fetches store-page keywords), local cache indexing, online
 * content fetch, search, and result actions over a single global SQLite index
 * (spec §4).
 */

export interface EngineOptions {
  readonly dbPath?: string;
  readonly cacheRoot?: string;
  readonly env?: PathEnv;
  readonly http?: HttpClient;
  readonly readonly?: boolean;
}

export interface LoginImportOptions {
  /** Persist the browser session for next time (default true). */
  readonly remember?: boolean;
  readonly onProgress?: (message: string) => void;
  /** How long to wait for the user to sign in, in ms. */
  readonly loginTimeoutMs?: number;
  /** Poll interval while waiting for sign-in, in ms. */
  readonly pollIntervalMs?: number;
  /** `Product` operations per batched detail request. */
  readonly batchSize?: number;
  /** Delay between detail batches, in ms. */
  readonly delayMs?: number;
  /** Injectable browser launcher (defaults to the lazy Playwright driver). */
  readonly launcher?: BrowserLauncher;
  /** Injectable session store (defaults to the on-disk session file). */
  readonly sessionStore?: SessionStore;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export interface LoginImportResult {
  /** Owned products imported into the index (after de-duplication). */
  readonly imported: number;
  /** Number of owned product IDs discovered for the signed-in user. */
  readonly owned: number;
  /** Whether the session was persisted for next time. */
  readonly remembered: boolean;
  /** Products whose store-page keywords were fetched and indexed. */
  readonly keywords: number;
}

/** Options for the keyword fetch folded into catalog import. */
export interface ImportOptions {
  readonly onProgress?: (message: string) => void;
  /** Politeness delay between product-page GETs, in ms. */
  readonly delayMs?: number;
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

  /**
   * Import the owned-product catalog from a captured JSON file, then fetch each
   * product's store-page keywords so they are immediately searchable (spec §3.4).
   */
  async importCatalogFile(
    path: string,
    opts: ImportOptions = {},
  ): Promise<{ imported: number; skipped: number; keywords: number }> {
    const { imported, skipped } = this.importCatalogJson(
      await readFile(path, "utf8"),
    );
    const { enriched } = await this.#importKeywords(opts);
    return { imported, skipped, keywords: enriched };
  }

  /** Import the owned catalog into the index (DB-only; no network). */
  importCatalogJson(text: string): { imported: number; skipped: number } {
    const { products, skipped } = parseMyAssetsText(text);
    const imported = this.repo.importCatalog(products, Date.now());
    return { imported, skipped };
  }

  /** Fetch store-page keywords for products that lack them (part of import). */
  #importKeywords(opts: ImportOptions = {}): Promise<EnrichResult> {
    return enrichProducts(this.repo, this.#http, {
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : {}),
    });
  }

  /**
   * Re-fetch each product's store-page **Related keywords** (spec §3.4),
   * powering the keyword cloud. Without `force`, only products missing keywords
   * are fetched (the same queue catalog import uses); with `force`, all stored
   * keywords are cleared and every product is re-fetched — use this to refresh
   * an existing index after the extractor changes.
   */
  async enrichKeywords(
    opts: {
      readonly force?: boolean;
      readonly limit?: number;
      readonly delayMs?: number;
      readonly onProgress?: (message: string) => void;
    } = {},
  ): Promise<EnrichResult> {
    if (opts.force) this.repo.clearKeywordTags();
    return enrichProducts(this.repo, this.#http, {
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.force ? { force: true } : {}),
    });
  }

  // ---- browser login (spec §5.1, §9) ---------------------------------------

  /** Path where the persisted browser session lives (for user messaging). */
  get sessionStatePath(): string {
    return defaultSessionStatePath(this.#env);
  }

  /**
   * Drive a browser to Unity's sign-in page, then export the owned catalog from
   * inside the authenticated page and import it — fetching each product's
   * store-page keywords as part of the import. AssetLens never sees the
   * password — it only reuses the resulting session. The Playwright driver is
   * loaded lazily so the core never requires it; `launcher`/`sessionStore` are
   * injectable for testing.
   */
  async loginAndImport(opts: LoginImportOptions = {}): Promise<LoginImportResult> {
    const launcher =
      opts.launcher ??
      (await import("./auth/playwrightLauncher.js")).playwrightLauncher({
        platform: this.#env.platform,
      });
    const store = opts.sessionStore ?? fileSessionStore(this.sessionStatePath);

    const { products, ownedCount, remembered } = await runBrowserLogin(
      launcher,
      store,
      {
        remember: opts.remember ?? true,
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        ...(opts.loginTimeoutMs !== undefined
          ? { loginTimeoutMs: opts.loginTimeoutMs }
          : {}),
        ...(opts.pollIntervalMs !== undefined
          ? { pollIntervalMs: opts.pollIntervalMs }
          : {}),
        ...(opts.batchSize !== undefined ? { batchSize: opts.batchSize } : {}),
        ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : {}),
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      },
    );

    const { products: parsed } = parseMyAssets(products);
    const imported = this.repo.importCatalog(parsed, Date.now());
    const { enriched } = await this.#importKeywords({
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : {}),
    });
    return { imported, owned: ownedCount, remembered, keywords: enriched };
  }

  /** Forget the persisted browser session (`assetlens logout`). */
  async logout(store: SessionStore = fileSessionStore(this.sessionStatePath)): Promise<void> {
    await store.clear();
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

  // ---- online content fetch (spec §5.4) ------------------------------------

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

  /** Reveal a product's downloaded `.unitypackage` in the OS file manager. */
  async revealProduct(
    productId: string,
    runner: CommandRunner = spawnRunner,
  ): Promise<OsCommand> {
    const product = this.repo.getProduct(productId);
    if (!product) throw new Error(`No product with id ${productId}`);
    if (!product.local_path) {
      throw new Error(
        "This product is not downloaded yet — use `download` first.",
      );
    }
    const command = revealCommand(this.#env.platform, product.local_path);
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
