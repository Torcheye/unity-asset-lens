import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { kharmaLink } from "../store/constants.js";

/**
 * Result actions (spec §7): reveal a local file, open the store page, or open
 * the `kharma` download deep link. Command construction is pure and per-OS so
 * it can be unit-tested; execution is a thin injectable wrapper.
 */

export interface OsCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  /**
   * Pass args to the Windows process verbatim (no automatic quoting). Required
   * for `explorer.exe /select,…` whose non-standard arg parser breaks if Node
   * wraps the token in quotes — see {@link revealCommand}.
   */
  readonly windowsVerbatimArguments?: boolean;
}

/** Reveal/select a file in the OS file manager (spec §7 local hit). */
export function revealCommand(
  platform: NodeJS.Platform,
  filePath: string,
): OsCommand {
  switch (platform) {
    case "win32": {
      // explorer.exe wants `/select,<path>` as one token, the path quoted (so
      // names with spaces survive) and back-slashed (it rejects forward
      // slashes). Node must NOT re-quote the token (windowsVerbatimArguments),
      // or explorer can't parse it and silently opens the default folder
      // (Documents) instead of selecting the file.
      const winPath = filePath.replace(/\//g, "\\");
      return {
        cmd: "explorer.exe",
        args: [`/select,"${winPath}"`],
        windowsVerbatimArguments: true,
      };
    }
    case "darwin":
      return { cmd: "open", args: ["-R", filePath] };
    default:
      // No universal "select" on Linux; open the containing folder.
      return { cmd: "xdg-open", args: [dirname(filePath)] };
  }
}

/** Open a URL (or custom-scheme deep link) in the default handler. */
export function openCommand(
  platform: NodeJS.Platform,
  url: string,
): OsCommand {
  switch (platform) {
    case "win32":
      // `start` is a cmd builtin; the empty "" is the window title arg.
      return { cmd: "cmd", args: ["/c", "start", "", url] };
    case "darwin":
      return { cmd: "open", args: [url] };
    default:
      return { cmd: "xdg-open", args: [url] };
  }
}

/** Open the Package Manager on a product to download it (spec §5.7). */
export function downloadCommand(
  platform: NodeJS.Platform,
  kharmaId: string,
): OsCommand {
  return openCommand(platform, kharmaLink(kharmaId));
}

export type CommandRunner = (command: OsCommand) => Promise<void>;

/** Default runner: spawn detached so the launched app outlives the CLI. */
export const spawnRunner: CommandRunner = (command) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command.cmd, [...command.args], {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: command.windowsVerbatimArguments ?? false,
    });
    child.on("error", reject);
    child.unref();
    resolve();
  });
