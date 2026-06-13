import {
  GRAPHQL_BATCH_URL,
  SEARCH_MY_ASSETS_QUERY,
} from "../store/constants.js";
import type {
  BrowserLauncher,
  FetchPageInput,
  LoginBrowser,
  MyAssetsPage,
} from "./browserLogin.js";

/**
 * The real {@link BrowserLauncher}, backed by Playwright driving the user's
 * already-installed browser (Chrome/Edge), so there is no separate browser
 * download. `playwright-core` is an *optional* dependency, loaded lazily here —
 * the core engine and search path never require it.
 *
 * This module talks to a live browser and is therefore exercised manually
 * rather than in unit tests (it is excluded from coverage); all decision logic
 * lives in `browserLogin.ts`, which is fully tested via a mock launcher.
 */

// Minimal structural types for the slice of playwright-core we use, declared
// locally so this module type-checks whether or not the optional dep is present.
interface PwPage {
  goto(url: string, opts?: unknown): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  storageState(): Promise<unknown>;
}
interface PwBrowser {
  newContext(opts?: unknown): Promise<PwContext>;
  close(): Promise<void>;
}
interface PwBrowserType {
  launch(opts?: unknown): Promise<PwBrowser>;
}
interface PlaywrightModule {
  chromium: PwBrowserType;
}

interface InPageArg {
  readonly endpoint: string;
  readonly query: string;
  readonly page: number;
  readonly pageSize: number;
  readonly tagging: readonly string[] | null;
}

/** Browser channels tried in order: installed Chrome, Edge, then any bundled Chromium. */
const CHANNELS: readonly (string | undefined)[] = ["chrome", "msedge", undefined];

async function loadPlaywright(): Promise<PlaywrightModule> {
  // Indirect specifier so `tsc` does not require the optional dep at build time.
  const moduleName = "playwright-core";
  try {
    return (await import(moduleName)) as unknown as PlaywrightModule;
  } catch {
    throw new Error(
      "Browser login needs the optional `playwright-core` package. Install it with:\n" +
        "  npm install playwright-core\n" +
        "and make sure Google Chrome or Microsoft Edge is installed " +
        "(AssetLens drives your existing browser).",
    );
  }
}

async function launchBrowser(pw: PlaywrightModule): Promise<PwBrowser> {
  let lastErr: unknown;
  for (const channel of CHANNELS) {
    try {
      return await pw.chromium.launch({
        headless: false,
        ...(channel ? { channel } : {}),
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    "Could not launch a browser (tried Chrome, Edge, and bundled Chromium). " +
      "Install Chrome or Edge, or run `npx playwright install chromium`. " +
      `Cause: ${(lastErr as Error | undefined)?.message ?? "unknown"}`,
  );
}

/**
 * Runs inside the browser page — must be fully self-contained (no closure over
 * module scope). Reads the `_csrf` cookie and POSTs one `searchMyAssets` page
 * with the logged-in session; a null `data.searchMyAssets` means "not signed in".
 */
function inPageFetch(arg: InPageArg): Promise<MyAssetsPage> {
  const dom = globalThis as unknown as {
    document: { cookie: string };
    fetch: (
      url: string,
      init: unknown,
    ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  };

  const cookie = dom.document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.indexOf("_csrf=") === 0);
  const csrf = cookie
    ? decodeURIComponent(cookie.slice("_csrf=".length))
    : "";
  if (!csrf) {
    return Promise.resolve({
      authenticated: false,
      results: [],
      total: null,
      reason: "no-csrf",
    });
  }

  return dom
    .fetch(arg.endpoint, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        "x-source": "storefront",
        operations: "searchMyAssets",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify([
        {
          query: arg.query,
          operationName: "searchMyAssets",
          variables: {
            page: arg.page,
            pageSize: arg.pageSize,
            sortBy: 7,
            tagging: arg.tagging,
          },
        },
      ]),
    })
    .then((res) => {
      if (!res.ok) {
        return {
          authenticated: false,
          results: [],
          total: null,
          reason: "http " + res.status,
        } as MyAssetsPage;
      }
      return res.json().then((json) => {
        const batch = Array.isArray(json) ? json[0] : json;
        const node = (
          batch as { data?: { searchMyAssets?: { results?: unknown[]; total?: number } } } | undefined
        )?.data?.searchMyAssets;
        if (!node) {
          return {
            authenticated: false,
            results: [],
            total: null,
            reason: "no-data",
          } as MyAssetsPage;
        }
        return {
          authenticated: true,
          results: node.results ?? [],
          total: typeof node.total === "number" ? node.total : null,
        } as MyAssetsPage;
      });
    });
}

export function playwrightLauncher(): BrowserLauncher {
  return {
    async launch(opts) {
      const pw = await loadPlaywright();
      const browser = await launchBrowser(pw);
      const context = await browser.newContext(
        opts.storageState !== undefined
          ? { storageState: opts.storageState }
          : {},
      );
      const page = await context.newPage();

      const api: LoginBrowser = {
        async goto(url: string) {
          await page.goto(url, { waitUntil: "domcontentloaded" });
        },
        fetchMyAssetsPage(input: FetchPageInput) {
          return page.evaluate<MyAssetsPage, InPageArg>(inPageFetch, {
            endpoint: GRAPHQL_BATCH_URL,
            query: SEARCH_MY_ASSETS_QUERY,
            page: input.page,
            pageSize: input.pageSize,
            tagging: input.tagging,
          });
        },
        storageState() {
          return context.storageState();
        },
        async close() {
          await browser.close();
        },
      };
      return api;
    },
  };
}
