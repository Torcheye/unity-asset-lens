import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { GroupedSearchResult } from "./domain/types.js";
import type { ProgressReporter } from "./domain/progress.js";
import {
  liveEnv,
  resolveCacheRoot,
  defaultDbPath,
  defaultSessionStatePath,
  defaultAccountPath,
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
import { fileAccountStore, type AccountStore } from "./auth/accountStore.js";
import {
  indexLocalCache,
  indexPackage,
  type LocalIndexOptions,
  type LocalIndexResult,
} from "./local/localIndexer.js";
import { statPackage } from "./local/scanCache.js";
import { buildCatalogMatcher } from "./local/matchCatalog.js";
import {
  indexFolder,
  folderInfoFromRow,
  isFolderProductId,
  type LocalFolderInfo,
} from "./local/folderIndexer.js";
import {
  pickFolder as pickFolderDialog,
  type CaptureRunner,
} from "./actions/folderPicker.js";
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
  readonly onProgress?: ProgressReporter;
  /**
   * Fired the instant sign-in is detected — before catalog import and keyword
   * enrichment finish — so the GUI can reflect the signed-in status right away.
   */
  readonly onSignedIn?: (status: SessionStatus) => void;
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
  /** Injectable account store (defaults to the on-disk account file). */
  readonly accountStore?: AccountStore;
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
  /** Email observed for the signed-in user, or null if none surfaced. */
  readonly email: string | null;
}

/** Saved-login status for the GUI's session indicator. */
export interface SessionStatus {
  /** Whether a saved browser session exists on this machine. */
  readonly loggedIn: boolean;
  /** Email captured at last sign-in, if any. */
  readonly email: string | null;
  /** Owned product count captured at last sign-in, if known. */
  readonly ownedCount: number | null;
  /** When the catalog was last imported, in epoch ms, if known. */
  readonly importedAt: number | null;
}

/** Options for the keyword fetch folded into catalog import. */
export interface ImportOptions {
  readonly onProgress?: ProgressReporter;
  /** Politeness delay between product-page GETs, in ms. */
  readonly delayMs?: number;
  /** Max product pages fetched in parallel. */
  readonly concurrency?: number;
}

/** Options for the standalone browser sign-in step (no catalog import). */
export interface SignInOptions {
  /** Persist the browser session for next time (default true). */
  readonly remember?: boolean;
  readonly onProgress?: ProgressReporter;
  /** Fired the instant sign-in is detected, so the GUI can update at once. */
  readonly onSignedIn?: (status: SessionStatus) => void;
  readonly loginTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly launcher?: BrowserLauncher;
  readonly sessionStore?: SessionStore;
  readonly accountStore?: AccountStore;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/** Result of the standalone sign-in step. */
export interface SignInResult {
  /** Number of owned product IDs discovered for the signed-in user. */
  readonly ownedCount: number;
  /** Whether the session was persisted for next time. */
  readonly remembered: boolean;
  /** Email observed for the signed-in user, or null if none surfaced. */
  readonly email: string | null;
}

/** Options for the catalog import step (reuses an existing sign-in session). */
export interface ImportLibraryOptions {
  readonly onProgress?: ProgressReporter;
  readonly remember?: boolean;
  readonly batchSize?: number;
  readonly delayMs?: number;
  readonly loginTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly launcher?: BrowserLauncher;
  readonly sessionStore?: SessionStore;
  readonly accountStore?: AccountStore;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
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
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
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
      readonly concurrency?: number;
      readonly onProgress?: ProgressReporter;
    } = {},
  ): Promise<EnrichResult> {
    if (opts.force) this.repo.clearKeywordTags();
    return enrichProducts(this.repo, this.#http, {
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : {}),
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.force ? { force: true } : {}),
    });
  }

  // ---- browser login (spec §5.1, §9) ---------------------------------------

  /** Path where the persisted browser session lives (for user messaging). */
  get sessionStatePath(): string {
    return defaultSessionStatePath(this.#env);
  }

  /** Path where the saved account metadata lives. */
  get accountPath(): string {
    return defaultAccountPath(this.#env);
  }

  /**
   * Report whether a saved login session exists, plus the display metadata
   * (email/owned count/import time) captured at last sign-in. "Logged in" means
   * a persisted session is present — the same notion `logout` clears — not that
   * the session is still valid against Unity (which would require a network
   * round-trip). Stores are injectable for testing.
   */
  async sessionStatus(
    sessionStore: SessionStore = fileSessionStore(this.sessionStatePath),
    accountStore: AccountStore = fileAccountStore(this.accountPath),
  ): Promise<SessionStatus> {
    const [session, account] = await Promise.all([
      sessionStore.load(),
      accountStore.load(),
    ]);
    return {
      loggedIn: session !== null,
      email: account?.email ?? null,
      ownedCount: account?.ownedCount ?? null,
      importedAt: account?.importedAt ?? null,
    };
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
    const launcher = await this.#resolveLauncher(opts.launcher);
    const store = opts.sessionStore ?? fileSessionStore(this.sessionStatePath);
    const accountStore =
      opts.accountStore ?? fileAccountStore(this.accountPath);
    const now = opts.now ?? (() => Date.now());

    const { products, ownedCount, remembered, email } = await runBrowserLogin(
      launcher,
      store,
      {
        remember: opts.remember ?? true,
        // Persist account metadata and surface the status the moment sign-in is
        // detected, so the indicator updates before import/enrich complete.
        onSignedIn: async ({ email, ownedCount, remembered }) => {
          const importedAt = now();
          if (remembered) {
            await accountStore.save({ email, ownedCount, importedAt });
          }
          opts.onSignedIn?.({ loggedIn: true, email, ownedCount, importedAt });
        },
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
    const imported = this.repo.importCatalog(parsed, now());
    const { enriched } = await this.#importKeywords({
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : {}),
    });
    // Account metadata is persisted at sign-in (see onSignedIn above), in
    // lock-step with the saved session that `logout` clears.
    return { imported, owned: ownedCount, remembered, keywords: enriched, email };
  }

  /** Resolve the browser launcher, loading the optional Playwright driver lazily. */
  async #resolveLauncher(launcher?: BrowserLauncher): Promise<BrowserLauncher> {
    return (
      launcher ??
      (await import("./auth/playwrightLauncher.js")).playwrightLauncher({
        platform: this.#env.platform,
      })
    );
  }

  /**
   * Sign in via the browser and persist the session — *without* importing the
   * catalog. This is setup step 1 in the GUI (step 2, {@link importLibrary},
   * reuses the saved session to pull the owned catalog + keywords). AssetLens
   * never sees the password; it only reuses the resulting session. `onSignedIn`
   * fires the instant sign-in is detected, so the GUI's status updates at once.
   */
  async signIn(opts: SignInOptions = {}): Promise<SignInResult> {
    const launcher = await this.#resolveLauncher(opts.launcher);
    const store = opts.sessionStore ?? fileSessionStore(this.sessionStatePath);
    const accountStore =
      opts.accountStore ?? fileAccountStore(this.accountPath);
    const now = opts.now ?? (() => Date.now());

    const { ownedCount, remembered, email } = await runBrowserLogin(
      launcher,
      store,
      {
        remember: opts.remember ?? true,
        signInOnly: true,
        // Persist account metadata and surface the status the moment sign-in is
        // detected, in lock-step with the saved session that `logout` clears.
        onSignedIn: async ({ email, ownedCount, remembered }) => {
          const importedAt = now();
          if (remembered) {
            await accountStore.save({ email, ownedCount, importedAt });
          }
          opts.onSignedIn?.({ loggedIn: true, email, ownedCount, importedAt });
        },
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        ...(opts.loginTimeoutMs !== undefined
          ? { loginTimeoutMs: opts.loginTimeoutMs }
          : {}),
        ...(opts.pollIntervalMs !== undefined
          ? { pollIntervalMs: opts.pollIntervalMs }
          : {}),
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      },
    );

    return { ownedCount, remembered, email };
  }

  /**
   * Import the owned catalog and its store-page keywords, reusing the session
   * captured by {@link signIn}. This is setup step 2 in the GUI. A saved session
   * is required (the browser re-authenticates from it without a fresh sign-in);
   * without one this throws so the GUI can route the user back to step 1.
   */
  async importLibrary(opts: ImportLibraryOptions = {}): Promise<LoginImportResult> {
    const store = opts.sessionStore ?? fileSessionStore(this.sessionStatePath);
    if ((await store.load()) === null) {
      throw new Error(
        "Not signed in yet — complete the Sign in step first, then import.",
      );
    }
    // With a saved session the browser re-authenticates without manual sign-in,
    // so import is just `loginAndImport` over that existing session. Keep the
    // wait short: a valid session authenticates near-instantly, and an expired
    // one should surface quickly rather than block on a fresh login.
    return this.loginAndImport({
      ...opts,
      sessionStore: store,
      loginTimeoutMs: opts.loginTimeoutMs ?? 60_000,
    });
  }

  /**
   * Forget the persisted browser session and account metadata
   * (`assetlens logout`). Both stores are cleared so the session indicator and
   * the saved session never disagree.
   */
  async logout(
    store: SessionStore = fileSessionStore(this.sessionStatePath),
    accountStore: AccountStore = fileAccountStore(this.accountPath),
  ): Promise<void> {
    await Promise.all([store.clear(), accountStore.clear()]);
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

  // ---- registered local folders (spec §8 local-web UI) ---------------------

  /**
   * Open the native OS folder picker and return the chosen absolute path, or
   * null if the user cancelled. GUI-only; the CLI takes an explicit path.
   * The runner is injectable for testing.
   */
  pickFolder(runner?: CaptureRunner): Promise<string | null> {
    return pickFolderDialog(this.#env.platform, runner);
  }

  /**
   * Register and scan a local folder (outside the Asset Store cache), indexing
   * its loose files as a synthetic deep `local` product — searchable by path
   * and name only. Re-adding the same path re-scans it (last-write-wins).
   * Throws if the path is not an existing directory.
   */
  async addLocalFolder(
    path: string,
    opts: { now?: number; onProgress?: ProgressReporter } = {},
  ): Promise<LocalFolderInfo> {
    // Canonicalise to an absolute path so a relative CLI argument doesn't record
    // a cwd-dependent key (the GUI picker already passes an absolute path). This
    // is the id the folder is registered/removed/re-scanned under.
    const abs = resolve(path);
    let st;
    try {
      st = await stat(abs);
    } catch {
      throw new Error(`No such folder: ${path}`);
    }
    if (!st.isDirectory()) throw new Error(`Not a folder: ${path}`);
    return indexFolder(this.repo, abs, opts.now ?? Date.now(), opts.onProgress);
  }

  /**
   * Re-scan an already-registered folder. If its path is no longer a directory
   * it is flagged `missing` (its existing files stay searchable) instead of
   * failing — the "keep & warn" behaviour.
   */
  async rescanLocalFolder(
    path: string,
    opts: { now?: number; onProgress?: ProgressReporter } = {},
  ): Promise<LocalFolderInfo> {
    const abs = resolve(path);
    const row = this.repo.getLocalFolder(abs);
    if (!row) throw new Error(`Folder not registered: ${path}`);
    if (!(await this.#isDirectory(abs))) {
      this.repo.setLocalFolderStatus(abs, "missing");
      return folderInfoFromRow(this.repo.getLocalFolder(abs)!);
    }
    try {
      return await indexFolder(
        this.repo,
        abs,
        opts.now ?? Date.now(),
        opts.onProgress,
      );
    } catch (err) {
      // If the folder vanished mid-scan, indexFolder threw before wiping the
      // existing index — keep & warn rather than failing or destroying it.
      if (!(await this.#isDirectory(abs))) {
        this.repo.setLocalFolderStatus(abs, "missing");
        return folderInfoFromRow(this.repo.getLocalFolder(abs)!);
      }
      throw err;
    }
  }

  /**
   * List registered folders, re-validating each path and flipping its status to
   * `ok`/`missing` as needed. Files of a now-missing folder are kept searchable
   * (the user removes the folder explicitly). Paths are stat'd in parallel so a
   * single slow/offline folder doesn't serially stall the whole list.
   */
  async listLocalFolders(): Promise<LocalFolderInfo[]> {
    const rows = this.repo.listLocalFolders();
    const checked = await Promise.all(
      rows.map(async (row) => ({
        row,
        status: ((await this.#isDirectory(row.path))
          ? "ok"
          : "missing") as "ok" | "missing",
      })),
    );
    return checked.map(({ row, status }) => {
      if (status !== row.status) this.repo.setLocalFolderStatus(row.path, status);
      return folderInfoFromRow({ ...row, status });
    });
  }

  /** Unregister a folder: drop its synthetic product + files and registry row. */
  removeLocalFolder(path: string): void {
    const abs = resolve(path);
    const row = this.repo.getLocalFolder(abs);
    if (!row) return;
    this.repo.deleteLocalFolderCascade(abs, row.product_id);
  }

  async #isDirectory(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
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
    // A registered-folder file exists on disk at its own `full_path`, so reveal
    // that exact file. Cache/online products instead reveal the downloaded
    // `.unitypackage` (the individual asset lives inside the archive, not on disk).
    const isFolderFile = isFolderProductId(file.product_id);
    const target = isFolderFile ? file.full_path : file.local_path;
    if (!target) {
      throw new Error(
        "This file's product is not downloaded yet — use `download` first.",
      );
    }
    // A registered-folder file is kept searchable even after the folder is
    // flagged `missing`, so the on-disk file may be gone. Reveal nothing and
    // report a clear error rather than a misleading "success" toast.
    await this.#assertOnDisk(target, isFolderFile);
    const command = revealCommand(this.#env.platform, target);
    await runner(command);
    return command;
  }

  /** Throw a friendly error if a reveal target no longer exists on disk. */
  async #assertOnDisk(target: string, isFolderFile: boolean): Promise<void> {
    try {
      await stat(target);
    } catch {
      throw new Error(
        isFolderFile
          ? "This file is no longer on disk — the folder may have moved or been deleted. Re-scan or remove the folder."
          : "This product's downloaded package is no longer on disk — re-download it.",
      );
    }
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
    await this.#assertOnDisk(product.local_path, isFolderProductId(productId));
    const command = revealCommand(this.#env.platform, product.local_path);
    await runner(command);
    return command;
  }

  async openStoreForProduct(
    productId: string,
    runner: CommandRunner = spawnRunner,
  ): Promise<OsCommand> {
    // A registered folder is not a store product — its store_url is empty, so
    // opening it would launch the OS handler on a blank URL.
    if (isFolderProductId(productId)) {
      throw new Error("Local folders have no store page.");
    }
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
    // A registered folder has no kharma id — a download deep-link built from its
    // synthetic `folder:<path>` id is meaningless to Unity.
    if (isFolderProductId(productId)) {
      throw new Error("Local folders aren't store products — nothing to download.");
    }
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
