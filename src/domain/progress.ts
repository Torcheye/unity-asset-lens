/**
 * Structured progress vocabulary shared by every long-running operation
 * (scan, enrich, fetch, sign-in). A {@link ProgressReporter} carries a
 * `current`/`total` count so consumers can render a real progress bar, plus a
 * human-readable `message` for log-style consumers (the GUI's SSE stream,
 * non-TTY terminals, and indeterminate phases where no total is yet known).
 */
export interface ProgressEvent {
  /** Stable phase id used to label the bar, e.g. "scan" | "enrich" | "fetch" | "signin". */
  readonly phase: string;
  /** Items finished so far, in `0..total`. */
  readonly current: number;
  /** Total items, or `0` when the count is indeterminate / not yet known. */
  readonly total: number;
  /** Full human-readable line (SSE / non-TTY / indeterminate phases). */
  readonly message: string;
  /** Short label for the current item, shown as the counter suffix. */
  readonly detail?: string;
}

export type ProgressReporter = (event: ProgressEvent) => void;
