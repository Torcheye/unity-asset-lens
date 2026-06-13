import { describe, it, expect, afterEach } from "vitest";
import { isUnityPackage, scanCache } from "../../src/local/scanCache.js";
import { makeTempDir, writeFileAt } from "../helpers/tmp.js";

describe("isUnityPackage", () => {
  it("matches .unitypackage case-insensitively", () => {
    expect(isUnityPackage("a/b/Pack.unitypackage")).toBe(true);
    expect(isUnityPackage("a/b/Pack.UNITYPACKAGE")).toBe(true);
    expect(isUnityPackage("a/b/readme.txt")).toBe(false);
  });
});

describe("scanCache", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("returns an empty list for a missing root", async () => {
    expect(await scanCache("/no/such/dir/at/all")).toEqual([]);
  });

  it("derives publisher/category/name from the cache layout (spec §3.1)", async () => {
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeFileAt(dir, "Sound Co/Audio/Cool SFX.unitypackage", "x");
    await writeFileAt(dir, "Art Co/3D/Props/Crate.unitypackage", "yy");
    await writeFileAt(dir, "Sound Co/Audio/notes.txt", "ignore me");

    const found = await scanCache(dir);
    expect(found).toHaveLength(2);

    const sfx = found.find((p) => p.name === "Cool SFX")!;
    expect(sfx.publisher).toBe("Sound Co");
    expect(sfx.category).toBe("Audio");
    expect(sfx.size).toBe(1);

    const crate = found.find((p) => p.name === "Crate")!;
    expect(crate.publisher).toBe("Art Co");
    expect(crate.category).toBe("3D/Props"); // nested category preserved
  });
});
