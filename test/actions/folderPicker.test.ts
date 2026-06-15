import { describe, it, expect } from "vitest";
import {
  folderPickerCommand,
  pickFolder,
} from "../../src/actions/folderPicker.js";
import type { OsCommand } from "../../src/actions/actions.js";

describe("folderPickerCommand", () => {
  it("uses a PowerShell FolderBrowserDialog on Windows", () => {
    const cmd = folderPickerCommand("win32");
    expect(cmd.cmd).toBe("powershell.exe");
    expect(cmd.args).toContain("-STA");
    expect(cmd.args.join(" ")).toContain("FolderBrowserDialog");
  });

  it("uses osascript 'choose folder' on macOS", () => {
    const cmd = folderPickerCommand("darwin");
    expect(cmd.cmd).toBe("osascript");
    expect(cmd.args.join(" ")).toContain("choose folder");
  });

  it("uses zenity --directory on Linux", () => {
    const cmd = folderPickerCommand("linux");
    expect(cmd.cmd).toBe("zenity");
    expect(cmd.args).toContain("--directory");
  });
});

describe("pickFolder", () => {
  it("returns the trimmed path the runner produced", async () => {
    const picked = await pickFolder("win32", async () => "  C:\\Chosen\\Folder \n");
    expect(picked).toBe("C:\\Chosen\\Folder");
  });

  it("returns null when the runner yields nothing (cancelled)", async () => {
    expect(await pickFolder("darwin", async () => "")).toBeNull();
    expect(await pickFolder("darwin", async () => "  \n")).toBeNull();
  });

  it("hands the per-OS command to the runner", async () => {
    let received: OsCommand | undefined;
    await pickFolder("linux", async (c) => {
      received = c;
      return "/picked";
    });
    expect(received?.cmd).toBe("zenity");
  });
});
