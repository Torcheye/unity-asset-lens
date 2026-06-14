import { describe, it, expect } from "vitest";
import {
  downloadCommand,
  openCommand,
  revealCommand,
} from "../../src/actions/actions.js";

describe("revealCommand", () => {
  it("uses explorer /select on Windows", () => {
    expect(revealCommand("win32", "C:\\cache\\Pack.unitypackage")).toEqual({
      cmd: "explorer.exe",
      args: ['/select,"C:\\cache\\Pack.unitypackage"'],
      windowsVerbatimArguments: true,
    });
  });

  it("quotes paths with spaces and back-slashes forward slashes (Windows)", () => {
    expect(revealCommand("win32", "C:/cache/My SFX Pack.unitypackage")).toEqual({
      cmd: "explorer.exe",
      args: ['/select,"C:\\cache\\My SFX Pack.unitypackage"'],
      windowsVerbatimArguments: true,
    });
  });

  it("uses open -R on macOS", () => {
    expect(revealCommand("darwin", "/cache/Pack.unitypackage")).toEqual({
      cmd: "open",
      args: ["-R", "/cache/Pack.unitypackage"],
    });
  });

  it("opens the containing folder on Linux", () => {
    expect(revealCommand("linux", "/cache/sub/Pack.unitypackage")).toEqual({
      cmd: "xdg-open",
      args: ["/cache/sub"],
    });
  });
});

describe("openCommand", () => {
  it("uses cmd start on Windows with an empty title arg", () => {
    expect(openCommand("win32", "https://x.test/p")).toEqual({
      cmd: "cmd",
      args: ["/c", "start", "", "https://x.test/p"],
    });
  });

  it("uses open on macOS and xdg-open on Linux", () => {
    expect(openCommand("darwin", "https://x.test").cmd).toBe("open");
    expect(openCommand("linux", "https://x.test").cmd).toBe("xdg-open");
  });
});

describe("downloadCommand", () => {
  it("opens the kharma deep link for Package Manager (spec §5.7)", () => {
    const cmd = downloadCommand("darwin", "12345");
    expect(cmd.cmd).toBe("open");
    expect(cmd.args[0]).toBe("com.unity3d.kharma:content/12345");
  });
});
