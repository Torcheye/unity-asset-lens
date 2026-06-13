import { describe, it, expect } from "vitest";
import { StableFileTracker } from "../../src/watcher/stableFile.js";

describe("StableFileTracker", () => {
  it("fires once after the required consecutive equal sizes", () => {
    const t = new StableFileTracker(2);
    expect(t.observe("a", 100)).toBe(false); // first sight
    expect(t.observe("a", 100)).toBe(true); // stable (2 equal)
    expect(t.observe("a", 100)).toBe(false); // does not re-fire
  });

  it("resets the streak when the size changes (still downloading)", () => {
    const t = new StableFileTracker(2);
    expect(t.observe("a", 100)).toBe(false);
    expect(t.observe("a", 200)).toBe(false); // grew — reset
    expect(t.observe("a", 200)).toBe(true); // now stable
  });

  it("never fires for zero-size (file just created/truncated)", () => {
    const t = new StableFileTracker(2);
    expect(t.observe("a", 0)).toBe(false);
    expect(t.observe("a", 0)).toBe(false);
  });

  it("tracks paths independently", () => {
    const t = new StableFileTracker(2);
    t.observe("a", 50);
    t.observe("b", 70);
    expect(t.observe("a", 50)).toBe(true);
    expect(t.observe("b", 70)).toBe(true);
  });

  it("supports a single-hit requirement", () => {
    const t = new StableFileTracker(1);
    expect(t.observe("a", 10)).toBe(true);
  });

  it("forget() clears state so a path can fire again", () => {
    const t = new StableFileTracker(2);
    t.observe("a", 100);
    expect(t.observe("a", 100)).toBe(true);
    t.forget("a");
    expect(t.observe("a", 100)).toBe(false);
    expect(t.observe("a", 100)).toBe(true);
  });
});
