import { describe, it, expect } from "vitest";
import {
  percent,
  phaseLabel,
  formatProgressLine,
  createProgressReporter,
  type ProgressStream,
} from "../../src/cli/progressBar.js";

describe("percent", () => {
  it("rounds to the nearest whole percent", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(62, 120)).toBe(52);
  });

  it("returns 0 for a non-positive total (indeterminate)", () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(5, -1)).toBe(0);
  });

  it("clamps to 0..100 when current is out of range", () => {
    expect(percent(150, 100)).toBe(100);
    expect(percent(-5, 100)).toBe(0);
  });
});

describe("phaseLabel", () => {
  it("maps known phases to friendly labels", () => {
    expect(phaseLabel("scan")).toBe("Scanning");
    expect(phaseLabel("enrich")).toBe("Enriching");
    expect(phaseLabel("fetch")).toBe("Fetching");
    expect(phaseLabel("signin")).toBe("Signing in");
  });

  it("falls back to the raw id for unknown phases", () => {
    expect(phaseLabel("mystery")).toBe("mystery");
  });
});

describe("formatProgressLine", () => {
  it("renders a counter with percent when a total is known", () => {
    expect(
      formatProgressLine({ phase: "scan", current: 62, total: 120, message: "x" }),
    ).toBe("Scanning…  62/120  (52%)");
  });

  it("appends the detail suffix when present", () => {
    expect(
      formatProgressLine({
        phase: "enrich",
        current: 29,
        total: 120,
        message: "x",
        detail: "Realistic Water",
      }),
    ).toBe("Enriching…  29/120  (24%)  Realistic Water");
  });

  it("passes the message through for indeterminate (total 0) events", () => {
    expect(
      formatProgressLine({
        phase: "signin",
        current: 0,
        total: 0,
        message: "Please sign in…",
      }),
    ).toBe("Please sign in…");
  });
});

/** Collect everything written to a fake stream for assertion. */
function fakeStream(opts: { isTTY: boolean; columns?: number }): {
  stream: ProgressStream;
  chunks: string[];
} {
  const chunks: string[] = [];
  const stream: ProgressStream = {
    write: (c: string) => chunks.push(c),
    isTTY: opts.isTTY,
    ...(opts.columns !== undefined ? { columns: opts.columns } : {}),
  };
  return { stream, chunks };
}

describe("createProgressReporter (TTY)", () => {
  it("redraws the counter in place and clears it on done()", () => {
    const { stream, chunks } = fakeStream({ isTTY: true, columns: 80 });
    const { reporter, done } = createProgressReporter(stream);

    reporter({ phase: "scan", current: 1, total: 2, message: "a" });
    reporter({ phase: "scan", current: 2, total: 2, message: "b" });
    done();

    expect(chunks[0]).toBe("\rScanning…  1/2  (50%)\x1b[K");
    expect(chunks[1]).toBe("\rScanning…  2/2  (100%)\x1b[K");
    expect(chunks[2]).toBe("\r\x1b[K"); // bar cleared
  });

  it("prints indeterminate status on its own line, clearing any live bar", () => {
    const { stream, chunks } = fakeStream({ isTTY: true, columns: 80 });
    const { reporter } = createProgressReporter(stream);

    reporter({ phase: "scan", current: 1, total: 4, message: "a" });
    reporter({ phase: "signin", current: 0, total: 0, message: "Signed in." });

    expect(chunks[0]).toBe("\rScanning…  1/4  (25%)\x1b[K");
    expect(chunks[1]).toBe("\r\x1b[K"); // clears the live bar first
    expect(chunks[2]).toBe("Signed in.\n"); // status persists on its own line
  });

  it("truncates the bar to the terminal width", () => {
    const { stream, chunks } = fakeStream({ isTTY: true, columns: 10 });
    const { reporter } = createProgressReporter(stream);

    reporter({ phase: "scan", current: 1, total: 2, message: "x" });
    // 10 columns → 9 visible chars between \r and the clear sequence.
    expect(chunks[0]).toBe("\rScanning…\x1b[K");
  });
});

describe("createProgressReporter (non-TTY)", () => {
  it("throttles to one line per integer percent change", () => {
    const { stream, chunks } = fakeStream({ isTTY: false });
    const { reporter } = createProgressReporter(stream);

    // 0/100 and 1/100 are both ~1%/0% boundaries; only emit on bucket change.
    reporter({ phase: "scan", current: 0, total: 200, message: "a" }); // 0%
    reporter({ phase: "scan", current: 1, total: 200, message: "b" }); // still 1% → 0? rounds to 1
    reporter({ phase: "scan", current: 1, total: 200, message: "c" }); // duplicate %
    reporter({ phase: "scan", current: 100, total: 200, message: "d" }); // 50%

    // Buckets seen: 0, 1, 50 → three lines (the duplicate 1% is suppressed).
    expect(chunks.filter((c) => c.endsWith("\n"))).toHaveLength(3);
    expect(chunks.some((c) => c.includes("(50%)"))).toBe(true);
  });

  it("dedupes consecutive identical status messages", () => {
    const { stream, chunks } = fakeStream({ isTTY: false });
    const { reporter } = createProgressReporter(stream);

    reporter({ phase: "signin", current: 0, total: 0, message: "Working…" });
    reporter({ phase: "signin", current: 0, total: 0, message: "Working…" });
    reporter({ phase: "signin", current: 0, total: 0, message: "Done." });

    expect(chunks).toEqual(["Working…\n", "Done.\n"]);
  });
});
