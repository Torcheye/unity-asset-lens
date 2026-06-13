import { describe, it, expect } from "vitest";
import {
  progIdToChannel,
  orderChannels,
  detectDefaultChannel,
  type RunCommand,
} from "../../src/auth/defaultBrowser.js";

describe("progIdToChannel", () => {
  it("maps Edge identifiers to the msedge channel", () => {
    expect(progIdToChannel("MSEdgeHTM")).toBe("msedge");
    expect(progIdToChannel("microsoft-edge.desktop")).toBe("msedge");
  });

  it("maps Chrome/Chromium identifiers to the chrome channel", () => {
    expect(progIdToChannel("ChromeHTML")).toBe("chrome");
    expect(progIdToChannel("google-chrome.desktop")).toBe("chrome");
    expect(progIdToChannel("chromium.desktop")).toBe("chrome");
  });

  it("returns undefined for non-Chromium browsers", () => {
    expect(progIdToChannel("FirefoxURL")).toBeUndefined();
    expect(progIdToChannel("firefox.desktop")).toBeUndefined();
  });
});

describe("orderChannels", () => {
  it("puts the preferred channel first, then the rest, then bundled chromium", () => {
    expect(orderChannels("msedge")).toEqual(["msedge", "chrome", undefined]);
    expect(orderChannels("chrome")).toEqual(["chrome", "msedge", undefined]);
  });

  it("uses a deterministic fallback when nothing is detected", () => {
    expect(orderChannels(undefined)).toEqual(["chrome", "msedge", undefined]);
  });
});

describe("detectDefaultChannel", () => {
  it("parses the Windows UserChoice ProgId (Edge)", async () => {
    const run: RunCommand = async () =>
      "\r\nHKEY_CURRENT_USER\\...\\UserChoice\r\n    ProgId    REG_SZ    MSEdgeHTM\r\n    Hash    REG_SZ    abc==\r\n";
    expect(await detectDefaultChannel("win32", run)).toBe("msedge");
  });

  it("parses the Windows UserChoice ProgId (Chrome)", async () => {
    const run: RunCommand = async () =>
      "    ProgId    REG_SZ    ChromeHTML\r\n";
    expect(await detectDefaultChannel("win32", run)).toBe("chrome");
  });

  it("reads xdg-settings on Linux", async () => {
    const run: RunCommand = async (cmd, args) => {
      expect(cmd).toBe("xdg-settings");
      expect(args).toEqual(["get", "default-web-browser"]);
      return "microsoft-edge.desktop\n";
    };
    expect(await detectDefaultChannel("linux", run)).toBe("msedge");
  });

  it("returns undefined on macOS (no stable CLI) without running anything", async () => {
    let called = false;
    const run: RunCommand = async () => {
      called = true;
      return "";
    };
    expect(await detectDefaultChannel("darwin", run)).toBeUndefined();
    expect(called).toBe(false);
  });

  it("returns undefined when the detection command fails", async () => {
    const run: RunCommand = async () => {
      throw new Error("reg not found");
    };
    expect(await detectDefaultChannel("win32", run)).toBeUndefined();
  });

  it("returns undefined when the registry output has no ProgId", async () => {
    const run: RunCommand = async () => "no progid here";
    expect(await detectDefaultChannel("win32", run)).toBeUndefined();
  });
});
