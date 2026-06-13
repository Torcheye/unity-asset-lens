import { describe, it, expect, afterEach } from "vitest";
import { utimes } from "node:fs/promises";
import {
  buildLocalIndexedProduct,
  indexLocalCache,
} from "../../src/local/localIndexer.js";
import { searchFiles } from "../../src/index/search.js";
import { buildUnityPackage } from "../helpers/buildPackage.js";
import { catalogProduct, memoryRepo } from "../helpers/db.js";
import { makeTempDir, writeFileAt } from "../helpers/tmp.js";
import type { ScannedPackage } from "../../src/local/scanCache.js";

describe("buildLocalIndexedProduct", () => {
  const pkg: ScannedPackage = {
    filePath: "/cache/Pub/Cat/Name.unitypackage",
    publisher: "Pub",
    category: "Audio/Music",
    name: "Name",
    mtimeMs: 1,
    size: 10,
  };
  const parsed = {
    files: [
      { fullPath: "X/a.wav", fileName: "a.wav", ext: "wav", typeBucket: "audio" as const, source: "local" as const },
    ],
    isWrapper: false,
  };

  it("uses the matched product id and store URL", () => {
    const ip = buildLocalIndexedProduct(
      pkg,
      parsed,
      catalogProduct({ id: "999", name: "Name", publisher: "Pub" }),
    );
    expect(ip.product.id).toBe("999");
    expect(ip.source).toBe("local");
    expect(ip.coverage).toBe("deep");
    expect(ip.localPath).toBe(pkg.filePath);
    expect(ip.category).toBe("Audio/Music");
    expect(ip.storeUrl).toContain("/packages/slug/999");
  });

  it("creates a stable synthetic product + search URL when unmatched", () => {
    const ip = buildLocalIndexedProduct(pkg, parsed, undefined);
    expect(ip.product.id).toBe("local:pub/name");
    expect(ip.storeUrl).toContain("/search?q=");
  });
});

describe("indexLocalCache (end-to-end with real .unitypackage files)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("scans, parses, matches catalog, and makes files searchable", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);

    const pkgBytes = await buildUnityPackage([
      { path: "CoolSFX/UI/UI_Click_01.wav" },
      { path: "CoolSFX/UI/UI_Hover.wav" },
    ]);
    await writeFileAt(dir, "Sound Co/Audio/Cool SFX.unitypackage", pkgBytes);

    const repo = memoryRepo();
    const catalog = [
      catalogProduct({ id: "500", name: "Cool SFX", publisher: "Sound Co" }),
    ];

    const result = await indexLocalCache(repo, dir, catalog, { now: 1 });
    expect(result.scanned).toBe(1);
    expect(result.indexed).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.errors).toEqual([]);

    const hits = searchFiles(repo.db, "click");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.productId).toBe("500");
    expect(hits[0]!.source).toBe("local");
    expect(hits[0]!.localPath).toContain("Cool SFX.unitypackage");
  });

  it("recursively unpacks a local wrapper package", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);

    const urp = await buildUnityPackage([{ path: "Temple/URP/Temple.fbx" }]);
    const wrapper = await buildUnityPackage([
      { path: "URP_Temple.unitypackage", asset: urp },
      { path: "_ReadFirst.txt" },
    ]);
    await writeFileAt(dir, "Art Co/3D/Toon Temple.unitypackage", wrapper);

    const repo = memoryRepo();
    const result = await indexLocalCache(repo, dir, [], { now: 1 });
    expect(result.indexed).toBe(1);

    // The nested .fbx is searchable even though it was inside a wrapper.
    const hits = searchFiles(repo.db, "Temple");
    expect(hits.some((h) => h.fullPath === "Temple/URP/Temple.fbx")).toBe(true);
    expect(repo.getProduct("local:artco/toontemple")!.is_wrapper).toBe(1);
  });

  it("skips unchanged packages on re-scan, re-indexes changed ones (incremental)", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);

    const bytes = await buildUnityPackage([{ path: "P/click.wav" }]);
    const filePath = await writeFileAt(dir, "Pub/Cat/Pack.unitypackage", bytes);

    const repo = memoryRepo();
    const first = await indexLocalCache(repo, dir, [], { now: 1 });
    expect(first.indexed).toBe(1);
    expect(first.skipped).toBe(0);

    // Second scan, nothing changed -> skipped via mtime/size cache.
    const second = await indexLocalCache(repo, dir, [], { now: 2 });
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(1);

    // Bump mtime -> re-indexed.
    const future = new Date(Date.now() + 60_000);
    await utimes(filePath, future, future);
    const third = await indexLocalCache(repo, dir, [], { now: 3 });
    expect(third.indexed).toBe(1);
    expect(third.skipped).toBe(0);
  });

  it("records a parse error without aborting the whole scan", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);

    await writeFileAt(dir, "Pub/Cat/Broken.unitypackage", "not a gzip file");
    const good = await buildUnityPackage([{ path: "G/ok.wav" }]);
    await writeFileAt(dir, "Pub/Cat/Good.unitypackage", good);

    const repo = memoryRepo();
    const result = await indexLocalCache(repo, dir, [], { now: 1 });
    expect(result.scanned).toBe(2);
    expect(result.indexed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.filePath).toContain("Broken.unitypackage");
  });
});
