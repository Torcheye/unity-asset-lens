import { describe, it, expect } from "vitest";
import { parseArgs, flagStr, flagBool, flagInt } from "../../src/cli/args.js";

describe("parseArgs", () => {
  it("splits command, positionals, and flags", () => {
    const r = parseArgs(["search", "ui", "click", "--type", "audio", "--local"]);
    expect(r.command).toBe("search");
    expect(r.positionals).toEqual(["ui", "click"]);
    expect(r.flags).toEqual({ type: "audio", local: true });
  });

  it("supports --key=value", () => {
    const r = parseArgs(["scan", "--cache-root=/c/cache"]);
    expect(r.flags["cache-root"]).toBe("/c/cache");
  });

  it("supports --no-flag as false", () => {
    const r = parseArgs(["scan", "--no-recurse"]);
    expect(r.flags.recurse).toBe(false);
  });

  it("treats a trailing flag without value as boolean true", () => {
    const r = parseArgs(["search", "x", "--json"]);
    expect(r.flags.json).toBe(true);
  });

  it("handles no command", () => {
    expect(parseArgs([]).command).toBeUndefined();
  });
});

describe("flag readers", () => {
  const flags = { type: "audio", local: true, limit: "25", bad: "x" };
  it("flagStr returns strings only", () => {
    expect(flagStr(flags, "type")).toBe("audio");
    expect(flagStr(flags, "local")).toBeUndefined();
  });
  it("flagBool honours presence and default", () => {
    expect(flagBool(flags, "local")).toBe(true);
    expect(flagBool(flags, "missing", true)).toBe(true);
    expect(flagBool({ recurse: false }, "recurse", true)).toBe(false);
  });
  it("flagInt parses integers, undefined on invalid", () => {
    expect(flagInt(flags, "limit")).toBe(25);
    expect(flagInt(flags, "bad")).toBeUndefined();
    expect(flagInt(flags, "missing")).toBeUndefined();
  });
});
