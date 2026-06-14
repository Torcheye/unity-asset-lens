import { describe, it, expect } from "vitest";
import { AssetLensEngine } from "../src/engine.js";
import type { PathEnv } from "../src/config/paths.js";
import type { OsCommand } from "../src/actions/actions.js";
import { mockHttp } from "./helpers/mockHttp.js";

const env: PathEnv = { platform: "linux", home: "/home/x", env: {} };

function assetsFor(id: string, page: number) {
  if (id === "1") {
    return page === 0
      ? [
          { label: "PackA", level: 0, type: "folder" },
          { label: "ui_click.wav", level: 1, type: "file" },
        ]
      : [];
  }
  return [];
}

/** Route the engine's network calls: CSRF GET, GraphQL POST, product-page GET. */
function engineHttp() {
  return mockHttp((url, init) => {
    if (url.includes("/api/graphql/batch")) {
      // CSRF priming is a bodyless GET of this same endpoint; the live store
      // answers 404 but still sets the anonymous `_csrf` cookie (spec §10).
      if (!init?.body) {
        return { status: 404, setCookies: ["_csrf=tok; Path=/; HttpOnly"] };
      }
      const sent = JSON.parse(init.body) as Array<{
        variables: { id: string; page: number };
      }>;
      const { id, page } = sent[0]!.variables;
      return { body: [{ data: { product: { assets: assetsFor(id, page) } } }] };
    }
    if (url.includes("/packages/slug/")) {
      return { body: `<meta name="keywords" content="hover, sci-fi">` };
    }
    return { status: 404 };
  });
}

describe("AssetLensEngine integration (spec Phase 1 pipeline)", () => {
  it("imports → fetches online → enriches → searches → actions", async () => {
    const { http } = engineHttp();
    const engine = AssetLensEngine.open({
      dbPath: ":memory:",
      cacheRoot: "/tmp/assetlens-nonexistent",
      env,
      http,
    });

    try {
      // 1. Import catalog (bare array of product nodes).
      const { imported } = engine.importCatalogJson(
        JSON.stringify([
          { id: "1", productId: "kh1", name: "Pack A", publisher: { name: "Acme" } },
        ]),
      );
      expect(imported).toBe(1);
      expect(engine.stats().products).toBe(1);

      // 2. Fetch online tree via PreviewAssets (anonymous CSRF session).
      const session = await engine.anonymousSession();
      const fetched = await engine.fetchOnline(session, {});
      expect(fetched.deepIndexed).toBe(1);

      // 3. The online file is searchable.
      let groups = engine.search("click");
      expect(groups[0]!.productId).toBe("1");
      expect(groups[0]!.source).toBe("online");

      // 4. Enrich adds keywords; the generic file is now found via "hover".
      const enriched = await engine.enrich({});
      expect(enriched.enriched).toBe(1);
      groups = engine.search("hover");
      expect(groups[0]!.productId).toBe("1");

      // 5. Actions (with a capturing runner instead of spawning).
      const captured: OsCommand[] = [];
      const runner = async (c: OsCommand) => {
        captured.push(c);
      };

      const open = await engine.openStoreForProduct("1", runner);
      expect(open.cmd).toBe("xdg-open"); // linux env
      expect(open.args[0]).toContain("/packages/slug/1");

      const dl = await engine.download("1", runner);
      expect(dl.args[0]).toBe("com.unity3d.kharma:content/kh1");

      // Revealing an online (not-downloaded) file errors helpfully.
      const fileId = groups[0]!.hits[0]!.fileId;
      await expect(engine.revealFile(fileId, runner)).rejects.toThrow(
        /not downloaded/,
      );

      expect(captured).toHaveLength(2);
    } finally {
      engine.close();
    }
  });

  it("reports stats and publishers", () => {
    const { http } = engineHttp();
    const engine = AssetLensEngine.open({
      dbPath: ":memory:",
      cacheRoot: "/tmp/none",
      env,
      http,
    });
    try {
      engine.importCatalogJson(
        JSON.stringify([
          { id: "1", name: "A", publisher: { name: "Zeta" } },
          { id: "2", name: "B", publisher: { name: "Alpha" } },
        ]),
      );
      expect(engine.stats().onlineProducts).toBe(2);
      expect(engine.listPublishers()).toEqual(["Alpha", "Zeta"]);
    } finally {
      engine.close();
    }
  });
});
