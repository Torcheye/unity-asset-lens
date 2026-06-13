import { describe, it, expect } from "vitest";
import {
  defaultCacheRoot,
  resolveCacheRoot,
  dataDir,
  defaultDbPath,
  type PathEnv,
} from "../../src/config/paths.js";

function env(
  platform: NodeJS.Platform,
  overrides: Partial<NodeJS.ProcessEnv> = {},
): PathEnv {
  const home =
    platform === "win32" ? "C:\\Users\\king" : "/home/king";
  return { platform, home, env: overrides as NodeJS.ProcessEnv };
}

describe("defaultCacheRoot", () => {
  it("uses %APPDATA% on Windows (spec §3.1)", () => {
    const root = defaultCacheRoot(
      env("win32", { APPDATA: "C:\\Users\\king\\AppData\\Roaming" }),
    );
    expect(root).toContain("Unity");
    expect(root).toContain("Asset Store-5.x");
    expect(root).toContain("Roaming");
  });

  it("falls back to a default APPDATA when unset on Windows", () => {
    const root = defaultCacheRoot(env("win32"));
    expect(root).toContain("AppData");
    expect(root).toContain("Asset Store-5.x");
  });

  it("uses Library path on macOS", () => {
    expect(defaultCacheRoot(env("darwin"))).toBe(
      "/home/king/Library/Unity/Asset Store-5.x",
    );
  });

  it("uses XDG-style path on Linux", () => {
    expect(defaultCacheRoot(env("linux"))).toBe(
      "/home/king/.local/share/unity3d/Asset Store-5.x",
    );
  });
});

describe("resolveCacheRoot precedence", () => {
  it("explicit override wins over env and default", () => {
    expect(
      resolveCacheRoot(env("linux", { ASSETLENS_CACHE_ROOT: "/from/env" }), "/explicit"),
    ).toBe("/explicit");
  });

  it("env var wins over default when no override", () => {
    expect(
      resolveCacheRoot(env("linux", { ASSETLENS_CACHE_ROOT: "/from/env" })),
    ).toBe("/from/env");
  });

  it("falls back to the OS default", () => {
    expect(resolveCacheRoot(env("darwin"))).toBe(
      "/home/king/Library/Unity/Asset Store-5.x",
    );
  });

  it("ignores blank overrides", () => {
    expect(resolveCacheRoot(env("darwin"), "   ")).toBe(
      "/home/king/Library/Unity/Asset Store-5.x",
    );
  });
});

describe("dataDir / defaultDbPath", () => {
  it("honours XDG_DATA_HOME on Linux", () => {
    expect(dataDir(env("linux", { XDG_DATA_HOME: "/xdg" }))).toBe(
      "/xdg/assetlens",
    );
  });

  it("derives a sqlite path under the data dir", () => {
    const db = defaultDbPath(env("linux"));
    expect(db).toBe("/home/king/.local/share/assetlens/index.sqlite");
  });
});
