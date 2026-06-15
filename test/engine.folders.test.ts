import { rm } from "node:fs/promises";
import { describe, it, expect, afterEach } from "vitest";
import { AssetLensEngine } from "../src/engine.js";
import type { PathEnv } from "../src/config/paths.js";
import type { OsCommand } from "../src/actions/actions.js";
import { folderProductId } from "../src/local/folderIndexer.js";
import { makeTempDir, writeFileAt } from "./helpers/tmp.js";

const env: PathEnv = { platform: "win32", home: "C:/Users/x", env: {} };

function openEngine() {
  return AssetLensEngine.open({ dbPath: ":memory:", cacheRoot: "C:/none", env });
}

describe("AssetLensEngine — registered local folders", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("adds a folder, searches it, reveals the exact file, then removes it", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "sfx/UI_Click_01.wav", Buffer.alloc(10));
    await writeFileAt(dir, "sfx/UI_Hover.wav", Buffer.alloc(10));

    const engine = openEngine();
    try {
      const info = await engine.addLocalFolder(dir, { now: 1 });
      expect(info.fileCount).toBe(2);
      expect(info.status).toBe("ok");

      const groups = engine.search("click");
      expect(groups[0]!.productId).toBe(folderProductId(dir));
      expect(groups[0]!.source).toBe("local");
      const fileId = groups[0]!.hits[0]!.fileId;

      // Reveal opens the file's OWN path (not the folder root).
      const captured: OsCommand[] = [];
      const cmd = await engine.revealFile(fileId, async (c) => {
        captured.push(c);
      });
      expect(cmd.cmd).toBe("explorer.exe"); // win32 env
      expect(cmd.args[0]).toContain("UI_Click_01.wav");
      expect(captured).toHaveLength(1);

      const list = await engine.listLocalFolders();
      expect(list).toHaveLength(1);
      expect(list[0]!.status).toBe("ok");

      engine.removeLocalFolder(dir);
      expect(engine.search("click")).toHaveLength(0);
      expect(await engine.listLocalFolders()).toHaveLength(0);
    } finally {
      engine.close();
    }
  });

  it("flags a folder missing when its path is gone but keeps files searchable", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "a/thing.fbx", Buffer.alloc(10));

    const engine = openEngine();
    try {
      await engine.addLocalFolder(dir, { now: 1 });
      await cleanup(); // delete the folder from disk

      const list = await engine.listLocalFolders();
      expect(list[0]!.status).toBe("missing");
      // Keep & warn: the files remain searchable.
      expect(engine.search("thing")).toHaveLength(1);
    } finally {
      engine.close();
    }
  });

  it("rejects adding a path that is not a directory", async () => {
    const engine = openEngine();
    try {
      await expect(engine.addLocalFolder("C:/definitely/not/here")).rejects.toThrow();
    } finally {
      engine.close();
    }
  });

  it("opens the native picker through an injected runner", async () => {
    const engine = openEngine();
    try {
      expect(await engine.pickFolder(async () => "C:/Chosen")).toBe("C:/Chosen");
      expect(await engine.pickFolder(async () => "")).toBeNull();
    } finally {
      engine.close();
    }
  });

  it("refuses to download or open a folder product (no store page)", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "x.fbx", Buffer.alloc(4));

    const engine = openEngine();
    try {
      const info = await engine.addLocalFolder(dir, { now: 1 });
      const noop = async () => {};
      await expect(engine.download(info.productId, noop)).rejects.toThrow(/folder/i);
      await expect(engine.openStoreForProduct(info.productId, noop)).rejects.toThrow(
        /folder/i,
      );
    } finally {
      engine.close();
    }
  });

  it("revealing a folder file that has been deleted reports a clear error, not success", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    const filePath = await writeFileAt(dir, "gone.wav", Buffer.alloc(4));

    const engine = openEngine();
    try {
      await engine.addLocalFolder(dir, { now: 1 });
      const fileId = engine.search("gone")[0]!.hits[0]!.fileId;
      await rm(filePath); // the on-disk file disappears, index row remains

      let ran = false;
      await expect(
        engine.revealFile(fileId, async () => {
          ran = true;
        }),
      ).rejects.toThrow(/no longer on disk/i);
      expect(ran).toBe(false); // never spawned a reveal for a missing file
    } finally {
      engine.close();
    }
  });

  it("rescan keeps & warns instead of wiping the index when the folder vanished", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "keep.fbx", Buffer.alloc(6));

    const engine = openEngine();
    try {
      await engine.addLocalFolder(dir, { now: 1 });
      await cleanup(); // folder gone before the rescan

      const info = await engine.rescanLocalFolder(dir, { now: 2 });
      expect(info.status).toBe("missing");
      // The previously-indexed file is preserved, not wiped to zero.
      expect(engine.search("keep")).toHaveLength(1);
    } finally {
      engine.close();
    }
  });
});
