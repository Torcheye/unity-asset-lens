/**
 * Pick which browser the login window should use.
 *
 * Playwright can drive any Chromium-family browser via a "channel" (`msedge`,
 * `chrome`) or its own bundled Chromium. To match the user's expectation we
 * detect the OS default browser and try that channel first, falling back to the
 * other Chromium browsers. (A non-Chromium default such as Firefox can't be
 * driven by a channel, so we fall back rather than failing.)
 *
 * The detection logic is pure over an injected command runner so it is fully
 * unit-testable without spawning anything.
 */

/** Runs a command and resolves its stdout. Injected so detection is testable. */
export type RunCommand = (
  cmd: string,
  args: readonly string[],
) => Promise<string>;

/** Map an OS browser identifier (Windows ProgId, Linux .desktop, …) to a channel. */
export function progIdToChannel(identifier: string): string | undefined {
  const id = identifier.toLowerCase();
  // Order matters: "microsoft-edge" contains neither "chrome"; check edge first.
  if (id.includes("edge")) return "msedge";
  if (id.includes("chrome") || id.includes("chromium")) return "chrome";
  // Firefox, Safari, Opera, Brave, etc.: no first-class Playwright channel.
  return undefined;
}

/**
 * Order the channels to try, putting the detected default first. When nothing
 * is detected we keep a deterministic Chromium-first fallback. `undefined`
 * means "Playwright's bundled Chromium" and is always the last resort.
 */
export function orderChannels(
  preferred: string | undefined,
): (string | undefined)[] {
  const fallback: (string | undefined)[] = ["chrome", "msedge", undefined];
  if (!preferred) return fallback;
  return [preferred, ...fallback.filter((c) => c !== preferred)];
}

/**
 * Detect the default browser's Playwright channel for the given platform,
 * returning `undefined` if it can't be determined (caller uses the fallback).
 */
export async function detectDefaultChannel(
  platform: NodeJS.Platform,
  run: RunCommand,
): Promise<string | undefined> {
  try {
    if (platform === "win32") {
      const out = await run("reg", [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
        "/v",
        "ProgId",
      ]);
      const match = /ProgId\s+REG_SZ\s+(\S+)/i.exec(out);
      return match?.[1] ? progIdToChannel(match[1]) : undefined;
    }
    if (platform === "linux") {
      const out = await run("xdg-settings", ["get", "default-web-browser"]);
      return progIdToChannel(out.trim());
    }
    // macOS has no simple, stable CLI for this — rely on the fallback order.
    return undefined;
  } catch {
    return undefined;
  }
}
