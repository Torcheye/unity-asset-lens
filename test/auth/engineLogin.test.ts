import { describe, it, expect } from "vitest";
import { AssetLensEngine } from "../../src/engine.js";
import type { PathEnv } from "../../src/config/paths.js";
import type {
  BrowserLauncher,
  LoginBrowser,
  OwnedIdsResult,
} from "../../src/auth/browserLogin.js";
import type { SessionStore } from "../../src/auth/sessionStore.js";

const env: PathEnv = { platform: "linux", home: "/home/x", env: {} };

/** Mock launcher: replays owned IDs, then resolves details from a fixture map. */
function scriptedLauncher(
  ownedIds: string[],
  detailFor: (id: string) => unknown,
): BrowserLauncher {
  const browser: LoginBrowser = {
    async goto() {},
    async getOwnedProductIds(): Promise<OwnedIdsResult> {
      return { authenticated: true, ids: ownedIds };
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
  it("imports the owned catalog discovered via the browser and makes it searchable", async () => {
    const details: Record<string, unknown> = {
      "1": { id: "1", productId: "kh1", name: "Pack A", publisher: { name: "Acme" } },
      "2": { id: "2", name: "Pack B", publisher: { name: "Beta" } },
      // "3" is delisted → driver returns a minimal { id } node.
      "3": { id: "3" },
    };
    const launcher = scriptedLauncher(["1", "2", "3"], (id) => details[id]);
    const { store, saved } = memStore();
    const engine = AssetLensEngine.open({ dbPath: ":memory:", cacheRoot: "/tmp/none", env });

    try {
      const result = await engine.loginAndImport({
        launcher,
        sessionStore: store,
        batchSize: 2,
        sleep: async () => {},
        now: () => 0,
      });

      expect(result.owned).toBe(3);
      expect(result.imported).toBe(3); // incl. the delisted id with a fallback name
      expect(result.remembered).toBe(true);
      expect(saved).toEqual([{ kind: "state" }]);

      expect(engine.stats().products).toBe(3);
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
      expect(engine.sessionStatePath).toContain("session.json");
    } finally {
      engine.close();
    }
  });
});
