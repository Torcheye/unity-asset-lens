import type { ProgressEvent, ProgressReporter } from "../domain/progress.js";

/**
 * Minimal-counter progress rendering for the CLI. A single line is redrawn in
 * place on a TTY (`Scanning…  62/120  (52%)  detail`); piped/redirected output
 * falls back to throttled percentage lines so logs stay compact. Pure helpers
 * (`percent`, `phaseLabel`, `formatProgressLine`) are exported for testing; the
 * I/O wrapper writes to stderr only, keeping stdout clean for the final summary.
 */

const PHASE_LABELS: Readonly<Record<string, string>> = {
  scan: "Scanning",
  enrich: "Enriching",
  fetch: "Fetching",
  signin: "Signing in",
  import: "Importing",
};

/** Human label for a phase id, falling back to the raw id when unknown. */
export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

/** Completion percentage in `0..100`, rounded; `0` when total is non-positive. */
export function percent(current: number, total: number): number {
  if (total <= 0) return 0;
  const pct = Math.round((current / total) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * The visible text for a progress event (no ANSI, no carriage return). With a
 * known total it renders the counter; otherwise it passes the message through
 * as an indeterminate status line.
 */
export function formatProgressLine(e: ProgressEvent): string {
  if (e.total > 0) {
    const base = `${phaseLabel(e.phase)}…  ${e.current}/${e.total}  (${percent(e.current, e.total)}%)`;
    return e.detail ? `${base}  ${e.detail}` : base;
  }
  return e.message;
}

/** Minimal stderr-like sink the renderer needs (subset of NodeJS.WriteStream). */
export interface ProgressStream {
  write(chunk: string): unknown;
  readonly isTTY?: boolean;
  readonly columns?: number;
}

export interface ProgressHandle {
  /** Feed a progress event; renders/throttles according to the stream type. */
  readonly reporter: ProgressReporter;
  /** Finish the run: clear the in-place bar so the stdout summary stands alone. */
  done(): void;
}

const CLEAR_LINE = "\x1b[K"; // erase from cursor to end of line

/**
 * Build a {@link ProgressReporter} bound to `stream` (stderr by default). On a
 * TTY the line is rewritten in place; otherwise a new line is emitted only when
 * the integer percent changes (or, for indeterminate phases, when the message
 * text changes), so piped logs don't get one line per item.
 */
export function createProgressReporter(
  stream: ProgressStream = process.stderr,
): ProgressHandle {
  const isTty = Boolean(stream.isTTY);
  let lastPct = -1;
  let lastMessage = "";
  let active = false;

  const reporter: ProgressReporter = (e) => {
    const line = formatProgressLine(e);
    if (isTty) {
      if (e.total > 0) {
        const width = Math.max(1, (stream.columns ?? 80) - 1);
        const text = line.length > width ? line.slice(0, width) : line;
        stream.write(`\r${text}${CLEAR_LINE}`);
        active = true;
      } else {
        // Indeterminate status: clear any live bar, then print it on its own
        // line so it persists instead of being overwritten by the next tick.
        if (active) {
          stream.write(`\r${CLEAR_LINE}`);
          active = false;
        }
        stream.write(`${line}\n`);
      }
      return;
    }
    // Non-TTY: throttle to avoid flooding logs.
    if (e.total > 0) {
      const pct = percent(e.current, e.total);
      if (pct !== lastPct) {
        lastPct = pct;
        stream.write(`${line}\n`);
      }
    } else if (line !== lastMessage) {
      lastMessage = line;
      stream.write(`${line}\n`);
    }
  };

  const done = (): void => {
    if (isTty && active) {
      stream.write(`\r${CLEAR_LINE}`);
      active = false;
    }
  };

  return { reporter, done };
}
