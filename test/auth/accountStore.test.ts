import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileAccountStore } from "../../src/auth/accountStore.js";

describe("fileAccountStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "assetlens-account-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips account metadata, creating parent directories", async () => {
    const store = fileAccountStore(join(dir, "nested", "account.json"));
    const info = { email: "dev@studio.io", ownedCount: 42, importedAt: 1700 };

    await store.save(info);
    expect(await store.load()).toEqual(info);

    const onDisk = JSON.parse(await readFile(store.path, "utf8")) as unknown;
    expect(onDisk).toEqual(info);
  });

  it("returns null when nothing has been saved", async () => {
    const store = fileAccountStore(join(dir, "missing.json"));
    expect(await store.load()).toBeNull();
  });

  it("treats a corrupt file as no-account (null, no throw)", async () => {
    const path = join(dir, "corrupt.json");
    await writeFile(path, "{ not valid json", "utf8");
    expect(await fileAccountStore(path).load()).toBeNull();
  });

  it("normalises missing/wrong-typed fields to null", async () => {
    const path = join(dir, "partial.json");
    await writeFile(path, JSON.stringify({ email: 123, ownedCount: "x" }), "utf8");
    expect(await fileAccountStore(path).load()).toEqual({
      email: null,
      ownedCount: null,
      importedAt: null,
    });
  });

  it("clears the metadata and is idempotent", async () => {
    const store = fileAccountStore(join(dir, "account.json"));
    await store.save({ email: "a@b.c", ownedCount: 1, importedAt: 1 });
    await store.clear();
    expect(await store.load()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
