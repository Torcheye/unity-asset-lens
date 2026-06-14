import { MY_ASSETS_URL, OWNED_DETAIL_BATCH_SIZE } from "../store/constants.js";
import type { ProgressReporter } from "../domain/progress.js";
import type { SessionStore } from "./sessionStore.js";

/**
 * Browser-driven catalog login (spec §5.1, §9).
 *
 * Rather than handle the user's credentials, AssetLens drives a real browser
 * window to Unity's own sign-in page. Once signed in, the "My Assets" page fires
 * a `CurrentUser` query whose `user.myAssets` field lists the owned product IDs;
 * AssetLens reads that (the sign-in signal *and* the ownership list), then
 * resolves each ID to catalog metadata via batched `Product` queries — all from
 * within the authenticated session, so no password ever touches AssetLens.
 *
 * This module is the pure orchestration over an injectable
 * {@link BrowserLauncher}. The real Playwright driver lives in
 * `playwrightLauncher.ts`; tests use a mock launcher.
 */

/** Result of probing for the signed-in user's owned product IDs. */
export interface OwnedIdsResult {
  /** False until the authenticated `CurrentUser` response has been observed. */
  readonly authenticated: boolean;
  /** Owned product IDs (empty until authenticated). */
  readonly ids: readonly string[];
  /** Diagnostic reason when not yet authenticated. */
  readonly reason?: string;
}

/** Identifying details for the signed-in user, sniffed from `CurrentUser`. */
export interface AccountProbe {
  /** The user's email, if the authenticated response surfaced one. */
  readonly email?: string;
}

/** A live browser the orchestration drives. Implemented by the Playwright driver. */
export interface LoginBrowser {
  /** Navigate the visible window to a URL. */
  goto(url: string): Promise<void>;
  /** Current owned-ID state, derived from the sniffed `CurrentUser` response. */
  getOwnedProductIds(): Promise<OwnedIdsResult>;
  /** Identifying details for the signed-in user (best-effort; optional). */
  getAccount?(): Promise<AccountProbe>;
  /** Resolve a batch of owned IDs to raw `Product` nodes (one per ID, in order). */
  fetchProductDetails(ids: readonly string[]): Promise<unknown[]>;
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

/** Snapshot handed to {@link RunBrowserLoginOptions.onSignedIn} at sign-in. */
export interface SignedInInfo {
  /** Email observed for the signed-in user, or null if none surfaced. */
  readonly email: string | null;
  /** Number of owned product IDs discovered. */
  readonly ownedCount: number;
  /** Whether the session was persisted (mirrors `remember`). */
  readonly remembered: boolean;
}

export interface RunBrowserLoginOptions {
  /** Persist the session for next time (default true). */
  readonly remember?: boolean;
  /**
   * Fired the instant sign-in is detected — after the session is persisted but
   * *before* the (potentially slow) detail fetch + catalog import — so callers
   * can reflect the signed-in state immediately. Awaited, so a persisting
   * handler completes before import proceeds.
   */
  readonly onSignedIn?: (info: SignedInInfo) => void | Promise<void>;
  /**
   * Stop right after sign-in is detected and the session is persisted, without
   * fetching any product details. Used by the GUI's standalone "Sign in" step,
   * which is separate from the later "Import" step; the returned `products` is
   * then empty.
   */
  readonly signInOnly?: boolean;
  /** `Product` operations per batched request (default {@link OWNED_DETAIL_BATCH_SIZE}). */
  readonly batchSize?: number;
  /** Delay between detail batches, in ms (default 0). */
  readonly delayMs?: number;
  /** How long to wait for the user to sign in, in ms (default 180000). */
  readonly loginTimeoutMs?: number;
  /** Poll interval while waiting for sign-in, in ms (default 1500). */
  readonly pollIntervalMs?: number;
  /** Page the browser opens to (default the "My Assets" page). */
  readonly entryUrl?: string;
  readonly onProgress?: ProgressReporter;
  /** Injectable sleep (tests pass an instant resolver). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable clock in ms (tests advance it deterministically). */
  readonly now?: () => number;
}

export interface BrowserLoginResult {
  /** Raw `Product` nodes for the owned library; the caller dedupes/parses. */
  readonly products: readonly unknown[];
  /** Number of owned product IDs discovered. */
  readonly ownedCount: number;
  /** Whether the session was persisted. */
  readonly remembered: boolean;
  /** Email observed for the signed-in user, or null if none surfaced. */
  readonly email: string | null;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drive a browser login end to end: restore any saved session, wait for the
 * owned-ID list to appear (the sign-in signal), resolve product details in
 * batches, and (optionally) persist the session. The browser is always closed,
 * even on error.
 */
export async function runBrowserLogin(
  launcher: BrowserLauncher,
  store: SessionStore,
  opts: RunBrowserLoginOptions = {},
): Promise<BrowserLoginResult> {
  const remember = opts.remember ?? true;
  const batchSize = Math.max(1, opts.batchSize ?? OWNED_DETAIL_BATCH_SIZE);
  const delayMs = opts.delayMs ?? 0;
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
    onProgress({
      phase: "signin",
      current: 0,
      total: 0,
      message: `Opening a browser window at ${entryUrl} …`,
    });
    await browser.goto(entryUrl);

    const ids = await waitForOwnedIds(browser, {
      pollIntervalMs,
      loginTimeoutMs,
      onProgress,
      sleep,
      now,
    });
    const account = browser.getAccount ? await browser.getAccount() : {};
    const email = account.email ?? null;

    // Persist the session the instant sign-in is detected — before the slow
    // detail fetch + import — so the saved-login status reflects it right away.
    let remembered = false;
    if (remember) {
      await store.save(await browser.storageState());
      remembered = true;
    }
    await opts.onSignedIn?.({ email, ownedCount: ids.length, remembered });

    // Sign-in-only callers (the GUI's standalone "Sign in" step) stop here: the
    // session is saved, and the later "Import" step fetches details separately.
    if (opts.signInOnly) {
      onProgress({
        phase: "signin",
        current: 0,
        total: 0,
        message:
          `Signed in${email ? ` as ${email}` : ""}` +
          `${remembered ? " · session saved" : ""}.`,
      });
      return { products: [], ownedCount: ids.length, remembered, email };
    }

    onProgress({
      phase: "signin",
      current: 0,
      total: 0,
      message:
        `Signed in${email ? ` as ${email}` : ""}. ` +
        `Found ${ids.length} owned products; fetching details…`,
    });

    const products: unknown[] = [];
    for (let start = 0; start < ids.length; start += batchSize) {
      const chunk = ids.slice(start, start + batchSize);
      try {
        const details = await browser.fetchProductDetails(chunk);
        products.push(...details);
      } catch (err) {
        // Indeterminate status (total 0) so the renderer prints it as a
        // persistent line rather than overwriting it with the next counter.
        onProgress({
          phase: "signin",
          current: 0,
          total: 0,
          message: `  ! batch ${Math.floor(start / batchSize) + 1} failed: ${(err as Error).message}`,
        });
      }
      const done = Math.min(start + batchSize, ids.length);
      onProgress({
        phase: "signin",
        current: done,
        total: ids.length,
        message: "Fetching product details…",
        detail: `batch ${Math.floor(start / batchSize) + 1}`,
      });
      if (delayMs > 0 && start + batchSize < ids.length) await sleep(delayMs);
    }

    return { products, ownedCount: ids.length, remembered, email };
  } finally {
    await browser.close();
  }
}

interface WaitOptions {
  readonly pollIntervalMs: number;
  readonly loginTimeoutMs: number;
  readonly onProgress: ProgressReporter;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** Poll until the authenticated `CurrentUser` response surfaces the owned IDs. */
async function waitForOwnedIds(
  browser: LoginBrowser,
  opts: WaitOptions,
): Promise<readonly string[]> {
  const deadline = opts.now() + opts.loginTimeoutMs;
  let prompted = false;
  for (;;) {
    const probe = await browser.getOwnedProductIds();
    if (probe.authenticated) return probe.ids;
    if (!prompted) {
      opts.onProgress({
        phase: "signin",
        current: 0,
        total: 0,
        message: "Please sign in to Unity in the browser window — waiting…",
      });
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
