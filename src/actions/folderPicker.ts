import { spawn } from "node:child_process";
import type { OsCommand } from "./actions.js";

/**
 * Native folder picker (spec §8 local-web UI). The browser cannot read a
 * server-side absolute path, but `assetlens serve` runs on the user's own
 * machine, so the engine spawns a native OS dialog whose window appears on
 * their desktop and returns the chosen path. Command construction is pure and
 * per-OS (testable); execution captures stdout via an injectable runner.
 */

const PROMPT = "Select a folder to add to AssetLens";

/** Build the per-OS command whose stdout is the selected folder path. */
export function folderPickerCommand(platform: NodeJS.Platform): OsCommand {
  switch (platform) {
    case "win32": {
      // Classic WinForms FolderBrowserDialog. -STA is required for the dialog;
      // it writes the chosen path to stdout, or nothing if the user cancels.
      const script =
        "Add-Type -AssemblyName System.Windows.Forms; " +
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
        `$d.Description = '${PROMPT}'; ` +
        "if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }";
      return { cmd: "powershell.exe", args: ["-NoProfile", "-STA", "-Command", script] };
    }
    case "darwin":
      return {
        cmd: "osascript",
        args: ["-e", `POSIX path of (choose folder with prompt "${PROMPT}")`],
      };
    default:
      // GTK picker; falls back to a spawn error if zenity is absent (the
      // caller surfaces it — CLI `folder add <path>` needs no picker).
      return {
        cmd: "zenity",
        args: ["--file-selection", "--directory", `--title=${PROMPT}`],
      };
  }
}

/** Runs a picker command and resolves with its raw stdout (the chosen path). */
export type CaptureRunner = (command: OsCommand) => Promise<string>;

/**
 * Default runner: spawn the dialog (NOT detached — we await the user's choice)
 * and collect stdout. Resolves even on a non-zero exit (cancel), so an empty
 * result simply means "cancelled".
 */
export const captureRunner: CaptureRunner = (command) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command.cmd, [...command.args], {
      windowsVerbatimArguments: command.windowsVerbatimArguments ?? false,
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve(out));
  });

/**
 * Open the native folder picker and return the chosen absolute path, or null if
 * the user cancelled. `runner` is injectable for testing.
 */
export async function pickFolder(
  platform: NodeJS.Platform,
  runner: CaptureRunner = captureRunner,
): Promise<string | null> {
  const out = (await runner(folderPickerCommand(platform))).trim();
  return out.length > 0 ? out : null;
}
