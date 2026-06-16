import { describe, it, expect, afterEach } from "vitest";
import {
  scanFolder,
  buildFolderIndexedProduct,
  indexFolder,
  folderProductId,
  isFolderProductId,
} from "../../src/local/folderIndexer.js";
import { searchFiles } from "../../src/index/search.js";
import { memoryRepo } from "../helpers/db.js";
import { makeTempDir, writeFileAt } from "../helpers/tmp.js";
import { buildUnityPackage } from "../helpers/buildPackage.js";

describe("scanFolder", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("walks recursively, sums size, and classifies files by extension", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "audio/click.wav", Buffer.alloc(10));
    await writeFileAt(dir, "models/sub/tree.fbx", Buffer.alloc(20));
    await writeFileAt(dir, "readme", Buffer.alloc(5)); // no extension → other

    const { files, totalSize } = await scanFolder(dir);
    expect(files).toHaveLength(3);
    expect(totalSize).toBe(35);

    const byName = Object.fromEntries(files.map((f) => [f.fileName, f]));
    expect(byName["click.wav"]!.typeBucket).toBe("audio");
    expect(byName["tree.fbx"]!.typeBucket).toBe("model");
    expect(byName["readme"]!.typeBucket).toBe("other");
    // fullPath is the absolute on-disk path; every file is local.
    expect(byName["click.wav"]!.fullPath).toContain(dir);
    expect(files.every((f) => f.source === "local")).toBe(true);
  });

  it("reports progress per file", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "a.txt", "a");
    await writeFileAt(dir, "b.txt", "b");

    const events: number[] = [];
    await scanFolder(dir, {
      onProgress: (e) => {
        expect(e.phase).toBe("folder");
        events.push(e.current);
      },
    });
    expect(events).toEqual([1, 2]);
  });

  it("returns nothing for a non-existent folder", async () => {
    const { files, totalSize } = await scanFolder("/no/such/folder/here");
    expect(files).toHaveLength(0);
    expect(totalSize).toBe(0);
  });
});

describe("scanFolder — .unitypackage expansion", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("expands a package's internal files alongside the package row", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    const pkg = await buildUnityPackage([
      { path: "Assets/SFX/boom.wav" },
      { path: "Assets/Scripts/Player.cs" },
    ]);
    const pkgPath = await writeFileAt(dir, "Audio.unitypackage", pkg);
    await writeFileAt(dir, "loose/readme.txt", Buffer.alloc(7));

    const { files, totalSize } = await scanFolder(dir);
    const byName = Object.fromEntries(files.map((f) => [f.fileName, f]));

    // The package's own on-disk row is kept (findable/revealable by name)...
    expect(byName["Audio.unitypackage"]!.fullPath).toBe(pkgPath);
    expect(byName["Audio.unitypackage"]!.nestedPkg).toBeUndefined();
    // ...plus every internal file, each tagged with the absolute archive path,
    // while its fullPath stays the internal project path.
    expect(byName["boom.wav"]!.fullPath).toBe("Assets/SFX/boom.wav");
    expect(byName["boom.wav"]!.nestedPkg).toBe(pkgPath);
    expect(byName["boom.wav"]!.typeBucket).toBe("audio");
    expect(byName["Player.cs"]!.nestedPkg).toBe(pkgPath);
    // The loose file is still indexed on its own.
    expect(byName["readme.txt"]!.nestedPkg).toBeUndefined();
    // Bytes are counted once (the package's on-disk size); internals add 0.
    expect(totalSize).toBe(pkg.length + 7);
  });

  it("recurses nested wrapper packages, tagging the on-disk outer archive", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    const inner = await buildUnityPackage([{ path: "Assets/Art/tree.fbx" }]);
    const outer = await buildUnityPackage([
      { path: "URP/Pipeline.unitypackage", asset: inner },
    ]);
    const pkgPath = await writeFileAt(dir, "ArtPack.unitypackage", outer);

    const { files } = await scanFolder(dir);
    const tree = files.find((f) => f.fileName === "tree.fbx");
    // The inner-most file is reached through the recursion, and points back at
    // the on-disk *outer* archive (not the inner blob's base name).
    expect(tree).toBeDefined();
    expect(tree!.fullPath).toBe("Assets/Art/tree.fbx");
    expect(tree!.nestedPkg).toBe(pkgPath);
  });

  it("keeps a corrupt package as a lone row instead of aborting the scan", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "good/keep.fbx", Buffer.alloc(4));
    await writeFileAt(
      dir,
      "Broken.unitypackage",
      Buffer.from("definitely not a gzip tarball"),
    );

    const { files } = await scanFolder(dir);
    const byName = Object.fromEntries(files.map((f) => [f.fileName, f]));
    // The scan completes: the loose file and the package's own row survive...
    expect(byName["keep.fbx"]).toBeDefined();
    expect(byName["Broken.unitypackage"]).toBeDefined();
    // ...but the unreadable archive yields no internal files.
    expect(files.every((f) => f.nestedPkg === undefined)).toBe(true);
  });

  it("keeps the package opaque when parsePackages is false", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    const pkg = await buildUnityPackage([{ path: "Assets/SFX/boom.wav" }]);
    await writeFileAt(dir, "Audio.unitypackage", pkg);

    const { files } = await scanFolder(dir, { parsePackages: false });
    expect(files).toHaveLength(1);
    expect(files[0]!.fileName).toBe("Audio.unitypackage");
    expect(files.some((f) => f.fileName === "boom.wav")).toBe(false);
  });
});

describe("buildFolderIndexedProduct", () => {
  it("builds a synthetic deep local product under the folder: prefix", () => {
    const ip = buildFolderIndexedProduct("/data/MyPack", []);
    expect(ip.product.id).toBe("folder:/data/MyPack");
    expect(isFolderProductId(ip.product.id)).toBe(true);
    expect(ip.product.name).toBe("MyPack");
    expect(ip.product.publisher).toBe("/data/MyPack");
    expect(ip.source).toBe("local");
    expect(ip.coverage).toBe("deep");
    expect(ip.storeUrl).toBe("");
    expect(ip.localPath).toBe("/data/MyPack");
  });
});

describe("indexFolder", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("writes the product + files + registry row and makes files searchable", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "sfx/UI_Click_01.wav", Buffer.alloc(12));
    await writeFileAt(dir, "sfx/UI_Hover.wav", Buffer.alloc(8));

    const repo = memoryRepo();
    const info = await indexFolder(repo, dir, 1);
    expect(info.fileCount).toBe(2);
    expect(info.totalSize).toBe(20);
    expect(info.status).toBe("ok");
    expect(info.productId).toBe(folderProductId(dir));

    const row = repo.getLocalFolder(dir)!;
    expect(row.file_count).toBe(2);
    expect(row.total_size).toBe(20);
    expect(row.added_at).toBe(1);

    const hits = searchFiles(repo.db, "click");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.productId).toBe(folderProductId(dir));
    expect(hits[0]!.source).toBe("local");
  });

  it("makes a file inside a folder's .unitypackage searchable under the folder product", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    const pkg = await buildUnityPackage([
      { path: "Assets/SFX/Explosion_Big.wav" },
    ]);
    await writeFileAt(dir, "Audio.unitypackage", pkg);

    const repo = memoryRepo();
    const info = await indexFolder(repo, dir, 1);
    // Two rows: the package itself plus its one internal file.
    expect(info.fileCount).toBe(2);

    const hits = searchFiles(repo.db, "Explosion");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fileName).toBe("Explosion_Big.wav");
    expect(hits[0]!.productId).toBe(folderProductId(dir));
    expect(hits[0]!.source).toBe("local");
  });

  it("re-indexing preserves the original added_at (last-write-wins)", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "a.txt", "a");

    const repo = memoryRepo();
    await indexFolder(repo, dir, 100);
    await writeFileAt(dir, "b.txt", "b");
    const info = await indexFolder(repo, dir, 200);

    expect(info.fileCount).toBe(2);
    const row = repo.getLocalFolder(dir)!;
    expect(row.added_at).toBe(100); // first add preserved
    expect(row.scanned_at).toBe(200); // refreshed
  });

  it("throws instead of wiping the index when a re-scanned folder has vanished", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "a.txt", "a");

    const repo = memoryRepo();
    await indexFolder(repo, dir, 100);
    expect(searchFiles(repo.db, "a")).toHaveLength(1);

    await cleanup(); // folder gone -> walk yields 0 files
    // indexFolder must refuse to commit an empty index over the existing one.
    await expect(indexFolder(repo, dir, 200)).rejects.toThrow(/no longer readable/i);
    expect(searchFiles(repo.db, "a")).toHaveLength(1); // index untouched
  });
});
