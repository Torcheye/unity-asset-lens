import { execFile } from "node:child_process";
import {
  GRAPHQL_BATCH_URL,
  SEARCH_MY_ASSETS_QUERY,
  STORE_ORIGIN,
} from "../store/constants.js";
import type {
  BrowserLauncher,
  FetchPageInput,
  LoginBrowser,
  MyAssetsPage,
} from "./browserLogin.js";
import {
  detectDefaultChannel,
  orderChannels,
  type RunCommand,
} from "./defaultBrowser.js";

/**
 * The real {@link BrowserLauncher}, backed by Playwright driving the user's
 * already-installed browser (their default of Chrome/Edge), so there is no
 * separate browser download. `playwright-core` is an *optional* dependency,
 * loaded lazily here — the core engine and search path never require it.
 *
 * Crucially, the `searchMyAssets` request is made via `context.request` (a
 * Node-side HTTP client sharing the browser's cookie jar) rather than
 * `page.evaluate`. Unity's login flow navigates the page across origins
 * (assetstore → id.unity.com → back); an in-page evaluate would be destroyed by
 * those navigations and could not reach the storefront origin anyway. The
 * request API is immune to both.
 *
 * This module talks to a live browser and is therefore exercised manually
 * rather than in unit tests (it is excluded from coverage); the testable
 * decision logic lives in `browserLogin.ts` and `defaultBrowser.ts`.
 */

// Minimal structural types for the slice of playwright-core we use, declared
// locally so this module type-checks whether or not the optional dep is present.
interface PwCookie {
  name: string;
  value: string;
}
interface PwApiResponse {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
}
interface PwApiRequest {
  post(
    url: string,
    opts: { headers?: Record<string, string>; data?: unknown },
  ): Promise<PwApiResponse>;
}
interface PwPage {
  goto(url: string, opts?: unknown): Promise<unknown>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  storageState(): Promise<unknown>;
  cookies(urls?: string | string[]): Promise<PwCookie[]>;
  readonly request: PwApiRequest;
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

export interface PlaywrightLauncherOptions {
  /** Platform used to detect the default browser (defaults to `process.platform`). */
  readonly platform?: NodeJS.Platform;
}

function nodeRunCommand(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args], { windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

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

async function launchBrowser(
  pw: PlaywrightModule,
  channels: readonly (string | undefined)[],
): Promise<PwBrowser> {
  let lastErr: unknown;
  for (const channel of channels) {
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

/** Read and decode the `_csrf` cookie for the storefront, if present. */
async function readCsrf(context: PwContext): Promise<string | undefined> {
  const cookies = await context.cookies(STORE_ORIGIN);
  const raw = cookies.find((c) => c.name === "_csrf")?.value;
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // malformed escape — use as-is
  }
}

function interpret(json: unknown): MyAssetsPage {
  const batch = Array.isArray(json) ? json[0] : json;
  const node = (
    batch as
      | { data?: { searchMyAssets?: { results?: unknown[]; total?: number } } }
      | undefined
  )?.data?.searchMyAssets;
  if (!node) {
    return { authenticated: false, results: [], total: null, reason: "no-data" };
  }
  return {
    authenticated: true,
    results: node.results ?? [],
    total: typeof node.total === "number" ? node.total : null,
  };
}

export function playwrightLauncher(
  opts: PlaywrightLauncherOptions = {},
): BrowserLauncher {
  const platform = opts.platform ?? process.platform;
  const run: RunCommand = nodeRunCommand;

  return {
    async launch(launchOpts) {
      const pw = await loadPlaywright();
      const preferred = await detectDefaultChannel(platform, run);
      const browser = await launchBrowser(pw, orderChannels(preferred));
      const context = await browser.newContext(
        launchOpts.storageState !== undefined
          ? { storageState: launchOpts.storageState }
          : {},
      );
      // A visible tab the user actually logs in to.
      const page = await context.newPage();

      const api: LoginBrowser = {
        async goto(url: string) {
          await page.goto(url, { waitUntil: "domcontentloaded" });
        },

        async fetchMyAssetsPage(input: FetchPageInput) {
          try {
            const csrf = await readCsrf(context);
            if (!csrf) {
              return { authenticated: false, results: [], total: null, reason: "no-csrf" };
            }
            const res = await context.request.post(GRAPHQL_BATCH_URL, {
              headers: {
                "Content-Type": "application/json",
                "x-requested-with": "XMLHttpRequest",
                "x-source": "storefront",
                operations: "searchMyAssets",
                "x-csrf-token": csrf,
              },
              data: [
                {
                  query: SEARCH_MY_ASSETS_QUERY,
                  operationName: "searchMyAssets",
                  variables: {
                    page: input.page,
                    pageSize: input.pageSize,
                    sortBy: 7,
                    tagging: input.tagging,
                  },
                },
              ],
            });
            if (!res.ok()) {
              return {
                authenticated: false,
                results: [],
                total: null,
                reason: `http ${res.status()}`,
              };
            }
            return interpret(await res.json());
          } catch (err) {
            // Transient (navigation, network) — let the poll loop retry.
            return {
              authenticated: false,
              results: [],
              total: null,
              reason: (err as Error).message,
            };
          }
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
