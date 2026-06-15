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
    await scanFolder(dir, (e) => {
      expect(e.phase).toBe("folder");
      events.push(e.current);
    });
    expect(events).toEqual([1, 2]);
  });

  it("returns nothing for a non-existent folder", async () => {
    const { files, totalSize } = await scanFolder("/no/such/folder/here");
    expect(files).toHaveLength(0);
    expect(totalSize).toBe(0);
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
});
