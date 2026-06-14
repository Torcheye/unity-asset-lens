import { execFile } from "node:child_process";
import {
  GRAPHQL_BATCH_URL,
  PRODUCT_OPERATION,
  PRODUCT_QUERY,
  STORE_ORIGIN,
} from "../store/constants.js";
import type {
  AccountProbe,
  BrowserLauncher,
  LoginBrowser,
  OwnedIdsResult,
} from "./browserLogin.js";
import {
  detectDefaultChannel,
  orderChannels,
  type RunCommand,
} from "./defaultBrowser.js";

/**
 * The real {@link BrowserLauncher}, backed by Playwright driving the user's
 * already-installed default browser (Chrome/Edge), so there is no separate
 * browser download. `playwright-core` is an *optional* dependency, loaded
 * lazily here — the core engine and search path never require it.
 *
 * Two things make this robust against Unity's actual behaviour (learned by
 * capturing live traffic):
 *  - The owned library is discovered by *sniffing* the `CurrentUser` response
 *    the My Assets page fires (`user.myAssets` is a JSON array of product IDs),
 *    not by a guessed `searchMyAssets` query (which does not exist).
 *  - Detail and any replayed requests use `context.request` (a Node-side client
 *    sharing the browser's cookie jar), immune to the cross-origin navigation
 *    the login flow performs (assetstore → id.unity.com → back).
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
interface PwResponse {
  url(): string;
  json(): Promise<unknown>;
}
interface PwPage {
  goto(url: string, opts?: unknown): Promise<unknown>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  storageState(): Promise<unknown>;
  cookies(urls?: string | string[]): Promise<PwCookie[]>;
  readonly request: PwApiRequest;
  on(event: "response", handler: (res: PwResponse) => void): void;
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

/** What a single `CurrentUser` batch entry can yield: owned IDs and/or an email. */
interface CurrentUserProbe {
  readonly ids: string[] | null;
  readonly email: string | null;
}

type CurrentUserNode = {
  data?: { user?: { myAssets?: unknown; email?: unknown } };
};

/**
 * Inspect a storefront GraphQL response for the `CurrentUser` payload and pull
 * out the owned product IDs (`user.myAssets`, a JSON-encoded string array) and
 * the user's email (`user.email`, best-effort). Returns null for unrelated
 * responses; either field may be null when the payload omits it.
 */
async function extractCurrentUser(
  res: PwResponse,
): Promise<CurrentUserProbe | null> {
  if (!res.url().includes("/api/graphql/batch")) return null;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const entries = Array.isArray(json) ? json : [json];
  let ids: string[] | null = null;
  let email: string | null = null;
  for (const entry of entries) {
    const user = (entry as CurrentUserNode | undefined)?.data?.user;
    if (!user) continue;
    if (ids === null && typeof user.myAssets === "string") {
      try {
        const parsed: unknown = JSON.parse(user.myAssets);
        if (Array.isArray(parsed)) ids = parsed.map((x) => String(x));
      } catch {
        /* not the payload we expected */
      }
    }
    if (email === null && typeof user.email === "string" && user.email) {
      email = user.email;
    }
  }
  return ids === null && email === null ? null : { ids, email };
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

      // Sniff the owned-product IDs (and email) from the page's own
      // CurrentUser request.
      let ownedIds: string[] | null = null;
      let email: string | null = null;
      context.on("response", (res) => {
        void extractCurrentUser(res).then((probe) => {
          if (!probe) return;
          if (probe.ids) ownedIds = probe.ids;
          if (probe.email) email = probe.email;
        });
      });

      // A visible tab the user actually logs in to.
      const page = await context.newPage();

      const api: LoginBrowser = {
        async goto(url: string) {
          await page.goto(url, { waitUntil: "domcontentloaded" });
        },

        async getOwnedProductIds(): Promise<OwnedIdsResult> {
          return ownedIds !== null
            ? { authenticated: true, ids: ownedIds }
            : { authenticated: false, ids: [], reason: "awaiting CurrentUser" };
        },

        async getAccount(): Promise<AccountProbe> {
          return email !== null ? { email } : {};
        },

        async fetchProductDetails(ids: readonly string[]) {
          const csrf = await readCsrf(context);
          if (!csrf) throw new Error("missing _csrf cookie");
          const res = await context.request.post(GRAPHQL_BATCH_URL, {
            headers: {
              "Content-Type": "application/json",
              "x-requested-with": "XMLHttpRequest",
              "x-source": "storefront",
              operations: ids.map(() => PRODUCT_OPERATION).join(","),
              "x-csrf-token": csrf,
            },
            data: ids.map((id) => ({
              query: PRODUCT_QUERY,
              operationName: PRODUCT_OPERATION,
              variables: { id },
            })),
          });
          if (!res.ok()) throw new Error(`Product batch HTTP ${res.status()}`);
          const json = await res.json();
          const arr = Array.isArray(json) ? json : [];
          // Keep ownership even for delisted products (null product node).
          return ids.map((id, i) => {
            const node = (
              arr[i] as { data?: { product?: unknown } } | undefined
            )?.data?.product;
            return node ?? { id };
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
