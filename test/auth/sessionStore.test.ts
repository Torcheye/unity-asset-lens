import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSessionStore } from "../../src/auth/sessionStore.js";

describe("fileSessionStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "assetlens-session-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a session, creating parent directories", async () => {
    // Path includes a not-yet-created subdirectory.
    const store = fileSessionStore(join(dir, "nested", "session.json"));
    const state = { cookies: [{ name: "_csrf", value: "abc" }], origins: [] };

    await store.save(state);
    expect(await store.load()).toEqual(state);

    // It is real JSON on disk.
    const onDisk = JSON.parse(await readFile(store.path, "utf8")) as unknown;
    expect(onDisk).toEqual(state);
  });

  it("returns null when no session has been saved", async () => {
    const store = fileSessionStore(join(dir, "missing.json"));
    expect(await store.load()).toBeNull();
  });

  it("treats a corrupt session file as logged-out (null, no throw)", async () => {
    const path = join(dir, "corrupt.json");
    await writeFile(path, "{ not valid json", "utf8");
    const store = fileSessionStore(path);
    expect(await store.load()).toBeNull();
  });

  it("clears the session and is idempotent", async () => {
    const store = fileSessionStore(join(dir, "session.json"));
    await store.save({ ok: true });
    await store.clear();
    expect(await store.load()).toBeNull();
    // Clearing again must not throw.
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
