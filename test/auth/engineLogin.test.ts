import { describe, it, expect } from "vitest";
import { AssetLensEngine } from "../../src/engine.js";
import type { PathEnv } from "../../src/config/paths.js";
import type {
  BrowserLauncher,
  LoginBrowser,
  MyAssetsPage,
} from "../../src/auth/browserLogin.js";
import type { SessionStore } from "../../src/auth/sessionStore.js";

const env: PathEnv = { platform: "linux", home: "/home/x", env: {} };

/** Mock launcher whose browser replays a fixed `searchMyAssets` transcript. */
function scriptedLauncher(script: MyAssetsPage[]): BrowserLauncher {
  let idx = 0;
  const browser: LoginBrowser = {
    async goto() {},
    async fetchMyAssetsPage() {
      const page = script[idx++];
      if (!page) throw new Error("script exhausted");
      return page;
    },
    async storageState() {
      return { kind: "state" };
    },
    async close() {},
  };
  return { async launch() { return browser; } };
}

function memStore() {
  const saved: unknown[] = [];
  let cleared = 0;
  const store: SessionStore = {
    path: "/mem/session.json",
    async load() {
      return null;
    },
    async save(s) {
      saved.push(s);
    },
    async clear() {
      cleared += 1;
    },
  };
  return { store, saved, clearedCount: () => cleared };
}

describe("AssetLensEngine.loginAndImport", () => {
  it("imports the owned catalog fetched via the browser and makes it searchable", async () => {
    // Auth probe, then one short visible page and one duplicate hidden page.
    const launcher = scriptedLauncher([
      { authenticated: true, results: [], total: 3 },
      {
        authenticated: true,
        total: 3,
        results: [
          { id: "1", productId: "kh1", name: "Pack A", publisher: { name: "Acme" } },
          { id: "2", name: "Pack B", publisher: { name: "Beta" } },
        ],
      },
      {
        authenticated: true,
        total: 1,
        // Duplicate id "2" (also #BIN) — must be de-duplicated on import.
        results: [{ id: "2", name: "Pack B", publisher: { name: "Beta" } }],
      },
    ]);
    const { store, saved } = memStore();
    const engine = AssetLensEngine.open({ dbPath: ":memory:", cacheRoot: "/tmp/none", env });

    try {
      const result = await engine.loginAndImport({
        launcher,
        sessionStore: store,
        sleep: async () => {},
        now: () => 0,
      });

      expect(result.fetched).toBe(3); // raw nodes (incl. the dup)
      expect(result.imported).toBe(2); // de-duplicated
      expect(result.hidden).toBe(1);
      expect(result.remembered).toBe(true);
      expect(saved).toEqual([{ kind: "state" }]);

      expect(engine.stats().products).toBe(2);
      const groups = engine.search("Pack");
      expect(groups.map((g) => g.productId).sort()).toEqual(["1", "2"]);
    } finally {
      engine.close();
    }
  });

  it("logout clears the saved session via the injected store", async () => {
    const { store, clearedCount } = memStore();
    const engine = AssetLensEngine.open({ dbPath: ":memory:", cacheRoot: "/tmp/none", env });
    try {
      await engine.logout(store);
      expect(clearedCount()).toBe(1);
      // The default path is reported for user messaging.
      expect(engine.sessionStatePath).toContain("session.json");
    } finally {
      engine.close();
    }
  });
});
