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

  it("merges a scan-before-import local: duplicate onto its store id and prunes it", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);

    const bytes = await buildUnityPackage([{ path: "Rocket/Models/atom.fbx" }]);
    await writeFileAt(dir, "Axinova/3D/Atom Rocket Model.unitypackage", bytes);

    const repo = memoryRepo();

    // 1. First scan with NO catalog yet -> synthetic local: product.
    const first = await indexLocalCache(repo, dir, [], { now: 1 });
    expect(first.indexed).toBe(1);
    expect(first.matched).toBe(0);
    expect(first.pruned).toBe(0);
    expect(repo.getProduct("local:axinova/atomrocketmodel")).toBeDefined();

    // 2. Catalog imported later, and the product gets keywords.
    const catalog = [
      catalogProduct({ id: "140021", name: "Atom Rocket Model", publisher: "Axinova" }),
    ];
    repo.importCatalog(catalog, 2);
    repo.enrichProduct("140021", { tags: ["rocket", "sci-fi"] }, 2);

    // 3. Forced re-scan re-homes the files onto 140021 and prunes the orphan.
    const second = await indexLocalCache(repo, dir, catalog, { now: 3, force: true });
    expect(second.matched).toBe(1);
    expect(second.pruned).toBe(1);

    expect(repo.getProduct("local:axinova/atomrocketmodel")).toBeUndefined();
    const merged = repo.getProduct("140021")!;
    expect(merged.source).toBe("local"); // now linked to the download
    expect(merged.tags).toContain("rocket"); // keywords preserved through the merge

    // The file is searchable under the real store id, only once.
    const hits = searchFiles(repo.db, "atom");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.productId).toBe("140021");
  });

  it("does not prune a local: product that is still the only copy", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);

    const bytes = await buildUnityPackage([{ path: "Free/thing.cs" }]);
    await writeFileAt(dir, "Indie/Tools/Freebie.unitypackage", bytes);

    const repo = memoryRepo();
    // No catalog match ever -> stays local:, must be kept (still referenced).
    const result = await indexLocalCache(repo, dir, [], { now: 1 });
    expect(result.pruned).toBe(0);
    expect(repo.getProduct("local:indie/freebie")).toBeDefined();
  });

  it("reports progress over every package, including unchanged skips", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);

    const a = await buildUnityPackage([{ path: "A/a.wav" }]);
    const b = await buildUnityPackage([{ path: "B/b.wav" }]);
    await writeFileAt(dir, "Pub/Cat/A.unitypackage", a);
    await writeFileAt(dir, "Pub/Cat/B.unitypackage", b);

    const repo = memoryRepo();
    const first: import("../../src/domain/progress.js").ProgressEvent[] = [];
    const r1 = await indexLocalCache(repo, dir, [], {
      now: 1,
      onProgress: (e) => first.push(e),
    });
    expect(r1.indexed).toBe(2);
    expect(first.every((e) => e.phase === "scan" && e.total === 2)).toBe(true);
    expect(first.at(-1)!.current).toBe(2); // reaches the total

    // Re-scan: both unchanged → skipped, but the bar still advances to 2/2.
    const second: import("../../src/domain/progress.js").ProgressEvent[] = [];
    const r2 = await indexLocalCache(repo, dir, [], {
      now: 2,
      onProgress: (e) => second.push(e),
    });
    expect(r2.skipped).toBe(2);
    expect(r2.indexed).toBe(0);
    expect(second.map((e) => e.current)).toEqual([1, 2]);
    expect(second.at(-1)!.total).toBe(2);
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
