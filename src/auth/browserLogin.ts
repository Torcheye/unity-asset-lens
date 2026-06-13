import { MY_ASSETS_URL, SEARCH_MY_ASSETS_PAGE_SIZE } from "../store/constants.js";
import type { SessionStore } from "./sessionStore.js";

/**
 * Browser-driven catalog login (spec §5.1, §9 evolution of the console export).
 *
 * Rather than handle the user's credentials, AssetLens drives a real browser
 * window to Unity's own sign-in page. Once the user is logged in, the same
 * `searchMyAssets` query the console snippet used is run *inside* that
 * authenticated page, so no password ever touches AssetLens.
 *
 * This module is the pure orchestration — polling for sign-in, paginating the
 * owned library, and persisting the session — over an injectable
 * {@link BrowserLauncher}. The real Playwright driver lives in
 * `playwrightLauncher.ts`; tests use a mock launcher.
 */

/** One page of `searchMyAssets`, as observed from inside the browser page. */
export interface MyAssetsPage {
  /** False when the page context is not logged in (null `data`, 401, …). */
  readonly authenticated: boolean;
  /** Raw product nodes for this page (empty when unauthenticated). */
  readonly results: readonly unknown[];
  /** Reported total, when present. */
  readonly total: number | null;
  /** Diagnostic reason when `authenticated` is false. */
  readonly reason?: string;
}

export interface FetchPageInput {
  readonly page: number;
  readonly pageSize: number;
  readonly tagging: readonly string[] | null;
}

/** A live browser the orchestration drives. Implemented by the Playwright driver. */
export interface LoginBrowser {
  /** Navigate the visible window to a URL. */
  goto(url: string): Promise<void>;
  /** Run a single `searchMyAssets` fetch in the page's authenticated context. */
  fetchMyAssetsPage(input: FetchPageInput): Promise<MyAssetsPage>;
  /** Snapshot the session (cookies/storage) for persistence. */
  storageState(): Promise<unknown>;
  /** Close the browser window. */
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Previously saved session to restore (skips the sign-in screen if valid). */
  readonly storageState?: unknown;
}

export interface BrowserLauncher {
  launch(opts: LaunchOptions): Promise<LoginBrowser>;
}

export interface RunBrowserLoginOptions {
  /** Persist the session for next time (default true). */
  readonly remember?: boolean;
  /** `searchMyAssets` page size (default {@link SEARCH_MY_ASSETS_PAGE_SIZE}). */
  readonly pageSize?: number;
  /** How long to wait for the user to sign in, in ms (default 180000). */
  readonly loginTimeoutMs?: number;
  /** Poll interval while waiting for sign-in, in ms (default 1500). */
  readonly pollIntervalMs?: number;
  /** Page the browser opens to (default the "My Assets" page). */
  readonly entryUrl?: string;
  readonly onProgress?: (message: string) => void;
  /** Injectable sleep (tests pass an instant resolver). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable clock in ms (tests advance it deterministically). */
  readonly now?: () => number;
}

export interface BrowserLoginResult {
  /** Raw owned-product nodes (visible + hidden); the caller dedupes/parses. */
  readonly products: readonly unknown[];
  /** Count of hidden/archived (`#BIN`) products included. */
  readonly hidden: number;
  /** Whether the session was persisted. */
  readonly remembered: boolean;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drive a browser login end to end: restore any saved session, wait for the
 * user to be authenticated, export the owned library, and (optionally) persist
 * the session. The browser is always closed, even on error.
 */
export async function runBrowserLogin(
  launcher: BrowserLauncher,
  store: SessionStore,
  opts: RunBrowserLoginOptions = {},
): Promise<BrowserLoginResult> {
  const pageSize = opts.pageSize ?? SEARCH_MY_ASSETS_PAGE_SIZE;
  const remember = opts.remember ?? true;
  const onProgress = opts.onProgress ?? (() => {});
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? (() => Date.now());
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const loginTimeoutMs = opts.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const entryUrl = opts.entryUrl ?? MY_ASSETS_URL;

  const saved = await store.load();
  const browser = await launcher.launch(
    saved !== null ? { storageState: saved } : {},
  );

  try {
    onProgress(`Opening a browser window at ${entryUrl} …`);
    await browser.goto(entryUrl);

    await waitForAuth(browser, {
      pageSize,
      pollIntervalMs,
      loginTimeoutMs,
      onProgress,
      sleep,
      now,
    });

    onProgress("Signed in. Exporting your owned library…");
    const visible = await collectAllPages(browser, null, pageSize);
    const hidden = await collectAllPages(browser, ["#BIN"], pageSize);
    const products = [...visible, ...hidden];

    let remembered = false;
    if (remember) {
      await store.save(await browser.storageState());
      remembered = true;
    }

    onProgress(
      `Fetched ${products.length} owned products (${hidden.length} hidden).`,
    );
    return { products, hidden: hidden.length, remembered };
  } finally {
    await browser.close();
  }
}

interface WaitOptions {
  readonly pageSize: number;
  readonly pollIntervalMs: number;
  readonly loginTimeoutMs: number;
  readonly onProgress: (message: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** Poll the page until `searchMyAssets` returns an authenticated response. */
async function waitForAuth(
  browser: LoginBrowser,
  opts: WaitOptions,
): Promise<void> {
  const deadline = opts.now() + opts.loginTimeoutMs;
  let prompted = false;
  for (;;) {
    const probe = await browser.fetchMyAssetsPage({
      page: 0,
      pageSize: opts.pageSize,
      tagging: null,
    });
    if (probe.authenticated) return;
    if (!prompted) {
      opts.onProgress(
        "Please sign in to Unity in the browser window — waiting…",
      );
      prompted = true;
    }
    if (opts.now() >= deadline) {
      throw new Error(
        "Timed out waiting for Unity sign-in. Re-run `assetlens login` and " +
          "complete sign-in in the browser window.",
      );
    }
    await opts.sleep(opts.pollIntervalMs);
  }
}

/** Page through `searchMyAssets` until a short/empty page signals the end. */
async function collectAllPages(
  browser: LoginBrowser,
  tagging: readonly string[] | null,
  pageSize: number,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 0; ; page += 1) {
    const res = await browser.fetchMyAssetsPage({ page, pageSize, tagging });
    if (!res.authenticated) {
      throw new Error(
        "Lost the authenticated session while exporting. Re-run `assetlens login`.",
      );
    }
    out.push(...res.results);
    if (res.results.length < pageSize) break;
  }
  return out;
}
