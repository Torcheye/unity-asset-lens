import { describe, it, expect } from "vitest";
import { AssetLensEngine } from "../../src/engine.js";
import type { PathEnv } from "../../src/config/paths.js";
import type {
  BrowserLauncher,
  LoginBrowser,
  OwnedIdsResult,
} from "../../src/auth/browserLogin.js";
import type { SessionStore } from "../../src/auth/sessionStore.js";
import type { AccountInfo, AccountStore } from "../../src/auth/accountStore.js";
import { mockHttp } from "../helpers/mockHttp.js";

const env: PathEnv = { platform: "linux", home: "/home/x", env: {} };

/** Mock launcher: replays owned IDs (+ optional email), resolves details. */
function scriptedLauncher(
  ownedIds: string[],
  detailFor: (id: string) => unknown,
  email?: string,
): BrowserLauncher {
  const browser: LoginBrowser = {
    async goto() {},
    async getOwnedProductIds(): Promise<OwnedIdsResult> {
      return { authenticated: true, ids: ownedIds };
    },
    async getAccount() {
      return email ? { email } : {};
    },
    async fetchProductDetails(ids) {
      return ids.map((id) => detailFor(id));
    },
    async storageState() {
      return { kind: "state" };
    },
    async close() {},
  };
  return { async launch() { return browser; } };
}

function memStore(initial: unknown = null) {
  const saved: unknown[] = [];
  let current = initial;
  let cleared = 0;
  const store: SessionStore = {
    path: "/mem/session.json",
    async load() {
      return current;
    },
    async save(s) {
      saved.push(s);
      current = s;
    },
    async clear() {
      cleared += 1;
      current = null;
    },
  };
  return { store, saved, clearedCount: () => cleared };
}

function memAccountStore(initial: AccountInfo | null = null) {
  const saved: AccountInfo[] = [];
  let current = initial;
  let cleared = 0;
  const store: AccountStore = {
    path: "/mem/account.json",
    async load() {
      return current;
    },
    async save(info) {
      saved.push(info);
      current = info;
    },
    async clear() {
      cleared += 1;
      current = null;
    },
  };
  return { store, saved, clearedCount: () => cleared };
}

describe("AssetLensEngine.loginAndImport", () => {
  it("imports the owned catalog discovered via the browser and makes it searchable", async () => {
    const details: Record<string, unknown> = {
      "1": { id: "1", productId: "kh1", name: "Pack A", publisher: { name: "Acme" } },
      "2": { id: "2", name: "Pack B", publisher: { name: "Beta" } },
      // "3" is delisted → driver returns a minimal { id } node.
      "3": { id: "3" },
    };
    const launcher = scriptedLauncher(["1", "2", "3"], (id) => details[id], "dev@studio.io");
    const { store, saved } = memStore();
    const { store: accountStore, saved: accountSaved } = memAccountStore();
    // Store-page keyword fetch (folded into import) hits the product page.
    const { http } = mockHttp((url) =>
      url.includes("/packages/slug/")
        ? {
            body:
              `<h2>Related keywords</h2><div>` +
              `<a href="/?q=space">space</a><a href="/?q=ship">ship</a>` +
              `</div><h2>Frequently bought together</h2>`,
          }
        : { status: 404 },
    );
    const engine = AssetLensEngine.open({ dbPath: ":memory:", cacheRoot: "/tmp/none", env, http });

    try {
      const result = await engine.loginAndImport({
        launcher,
        sessionStore: store,
        accountStore,
        batchSize: 2,
        sleep: async () => {},
        now: () => 1234,
      });

      expect(result.owned).toBe(3);
      expect(result.imported).toBe(3); // incl. the delisted id with a fallback name
      expect(result.remembered).toBe(true);
      expect(result.keywords).toBe(3); // every product got store-page keywords
      expect(result.email).toBe("dev@studio.io");
      expect(saved).toEqual([{ kind: "state" }]);
      // Account metadata is persisted in lock-step with the session.
      expect(accountSaved).toEqual([
        { email: "dev@studio.io", ownedCount: 3, importedAt: 1234 },
      ]);

      const status = await engine.sessionStatus(store, accountStore);
      expect(status).toEqual({
        loggedIn: true,
        email: "dev@studio.io",
        ownedCount: 3,
        importedAt: 1234,
      });

      expect(engine.stats().products).toBe(3);
      const groups = engine.search("Pack");
      expect(groups.map((g) => g.productId).sort()).toEqual(["1", "2"]);
      // The imported keywords are immediately searchable.
      expect(engine.search("ship").map((g) => g.productId).sort()).toEqual(["1", "2", "3"]);
    } finally {
      engine.close();
    }
  });

  it("surfaces signed-in status (and persists the account) before fetching details", async () => {
    const order: string[] = [];
    const launcher: BrowserLauncher = {
      async launch() {
        return {
          async goto() {},
          async getOwnedProductIds(): Promise<OwnedIdsResult> {
            return { authenticated: true, ids: ["1", "2"] };
          },
          async getAccount() {
            return { email: "early@dev.io" };
          },
          async fetchProductDetails(ids) {
            order.push("fetchDetails");
            return ids.map((id) => ({ id, name: `P${id}` }));
          },
          async storageState() {
            return { kind: "state" };
          },
          async close() {},
        };
      },
    };
    const { store } = memStore();
    const { store: accountStore, saved: accountSaved } = memAccountStore();
    const { http } = mockHttp(() => ({ body: "" }));
    const engine = AssetLensEngine.open({ dbPath: ":memory:", cacheRoot: "/tmp/none", env, http });

    try {
      const statuses: unknown[] = [];
      await engine.loginAndImport({
        launcher,
        sessionStore: store,
        accountStore,
        sleep: async () => {},
        now: () => 7,
        onSignedIn: (s) => {
          order.push("onSignedIn");
          statuses.push(s);
        },
      });

      // The signed-in status fires before any product detail is fetched.
      expect(order).toEqual(["onSignedIn", "fetchDetails"]);
      expect(statuses).toEqual([
        { loggedIn: true, email: "early@dev.io", ownedCount: 2, importedAt: 7 },
      ]);
      // And the account is persisted at that same (early) moment.
      expect(accountSaved).toEqual([
        { email: "early@dev.io", ownedCount: 2, importedAt: 7 },
      ]);
    } finally {
      engine.close();
    }
  });

  it("logout clears both the session and account stores", async () => {
    const { store, clearedCount } = memStore({ kind: "state" });
    const { store: accountStore, clearedCount: accountCleared } = memAccountStore({
      email: "dev@studio.io",
      ownedCount: 3,
      importedAt: 1,
    });
    const engine = AssetLensEngine.open({ dbPath: ":memory:", cacheRoot: "/tmp/none", env });
    try {
      await engine.logout(store, accountStore);
      expect(clearedCount()).toBe(1);
      expect(accountCleared()).toBe(1);
      expect(engine.sessionStatePath).toContain("session.json");
      expect(engine.accountPath).toContain("account.json");

      const status = await engine.sessionStatus(store, accountStore);
      expect(status).toEqual({ loggedIn: false, email: null, ownedCount: null, importedAt: null });
    } finally {
      engine.close();
    }
  });

  it("sessionStatus reports logged-out when no session is saved", async () => {
    const { store } = memStore(null);
    const { store: accountStore } = memAccountStore(null);
    const engine = AssetLensEngine.open({ dbPath: ":memory:", cacheRoot: "/tmp/none", env });
    try {
      const status = await engine.sessionStatus(store, accountStore);
      expect(status.loggedIn).toBe(false);
      expect(status.email).toBeNull();
    } finally {
      engine.close();
    }
  });
});
