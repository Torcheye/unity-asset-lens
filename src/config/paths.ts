import { homedir, platform as osPlatform } from "node:os";
import { posix, win32 } from "node:path";

/**
 * Resolution of the Unity Asset Store download cache (spec §3.1).
 *
 * Downloaded `.unitypackage` files live in a per-user cache organised as
 * `<root>/<Publisher>/<Category>/<Name>.unitypackage`. The root is per-OS and
 * user-overridable, so every resolver here takes injectable `env`/`platform`
 * to keep the logic pure and testable.
 */

export type SupportedPlatform = "win32" | "darwin" | "linux";

export interface PathEnv {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Capture the live environment. Call once at the edge; pass the result down. */
export function liveEnv(): PathEnv {
  return { platform: osPlatform(), home: homedir(), env: process.env };
}

/**
 * Join path segments using the *target* platform's separator rather than the
 * host's, so resolution is correct (and unit-testable) for any OS regardless of
 * where the code runs.
 */
function joinFor(platform: NodeJS.Platform, ...segments: string[]): string {
  return platform === "win32"
    ? win32.join(...segments)
    : posix.join(...segments);
}

/**
 * Default Asset Store cache root for a given platform (spec §3.1 table).
 * Windows honours `%APPDATA%` when set, falling back to the documented default.
 */
export function defaultCacheRoot(env: PathEnv): string {
  switch (env.platform) {
    case "win32": {
      const appData =
        env.env.APPDATA ?? joinFor("win32", env.home, "AppData", "Roaming");
      return joinFor("win32", appData, "Unity", "Asset Store-5.x");
    }
    case "darwin":
      return joinFor("darwin", env.home, "Library", "Unity", "Asset Store-5.x");
    default:
      // Linux and anything else uses the XDG-style data dir.
      return joinFor(
        env.platform,
        env.home,
        ".local",
        "share",
        "unity3d",
        "Asset Store-5.x",
      );
  }
}

/**
 * Resolve the effective cache root, honouring an explicit override
 * (spec §3.1: "the location is overridable by the user").
 *
 * Precedence: explicit argument > `ASSETLENS_CACHE_ROOT` env var > OS default.
 */
export function resolveCacheRoot(env: PathEnv, override?: string): string {
  const fromEnv = env.env.ASSETLENS_CACHE_ROOT?.trim();
  if (override && override.trim().length > 0) return override.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return defaultCacheRoot(env);
}

/**
 * Resolve the per-user data directory where the global index DB lives
 * (spec §6: "single global index across projects").
 */
export function dataDir(env: PathEnv, override?: string): string {
  const fromEnv = env.env.ASSETLENS_DATA_DIR?.trim();
  if (override && override.trim().length > 0) return override.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  switch (env.platform) {
    case "win32": {
      const appData =
        env.env.APPDATA ?? joinFor("win32", env.home, "AppData", "Roaming");
      return joinFor("win32", appData, "AssetLens");
    }
    case "darwin":
      return joinFor(
        "darwin",
        env.home,
        "Library",
        "Application Support",
        "AssetLens",
      );
    default: {
      const xdg = env.env.XDG_DATA_HOME?.trim();
      const base =
        xdg && xdg.length > 0
          ? xdg
          : joinFor(env.platform, env.home, ".local", "share");
      return joinFor(env.platform, base, "assetlens");
    }
  }
}

/** Default path to the SQLite index database file. */
export function defaultDbPath(env: PathEnv, override?: string): string {
  return joinFor(env.platform, dataDir(env, override), "index.sqlite");
}

/**
 * Default path for the persisted browser login session (Playwright
 * `storageState`). It holds Unity session cookies — sensitive, machine-local —
 * so it lives next to the index in the per-user data dir and is cleared by
 * `assetlens logout`.
 */
export function defaultSessionStatePath(env: PathEnv, override?: string): string {
  return joinFor(env.platform, dataDir(env, override), "session.json");
}

/**
 * Default path for the persisted account metadata (the signed-in email, owned
 * count and last-import time). Unlike the session blob this is non-sensitive
 * display data, but it shares the session's lifecycle: it is written on login
 * and removed by `assetlens logout`, so it lives beside the session file.
 */
export function defaultAccountPath(env: PathEnv, override?: string): string {
  return joinFor(env.platform, dataDir(env, override), "account.json");
}
