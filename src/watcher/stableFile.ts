/**
 * Tracks whether a file's bytes have settled across successive size samples.
 *
 * A freshly-downloaded `.unitypackage` grows while Unity writes it (spec §5.7),
 * so we must wait until its size stops changing before indexing. This is the
 * pure decision core of the cache watcher — feed it size samples, it reports
 * when a path has been stable (same non-zero size) for `requiredStableHits`
 * consecutive observations.
 */
export class StableFileTracker {
  readonly #lastSize = new Map<string, number>();
  readonly #stableHits = new Map<string, number>();
  readonly #required: number;

  constructor(requiredStableHits = 2) {
    this.#required = Math.max(1, requiredStableHits);
  }

  /**
   * Record a size sample for `path`. Returns true exactly once, when the file
   * first reaches the required number of consecutive unchanged, non-zero sizes.
   */
  observe(path: string, size: number): boolean {
    if (size <= 0) {
      this.#lastSize.set(path, size);
      this.#stableHits.set(path, 0);
      return false;
    }
    const prev = this.#lastSize.get(path);
    const hits = prev === size ? (this.#stableHits.get(path) ?? 0) + 1 : 1;
    this.#lastSize.set(path, size);
    this.#stableHits.set(path, hits);
    return hits === this.#required;
  }

  /** Forget a path (e.g. after it has been indexed or removed). */
  forget(path: string): void {
    this.#lastSize.delete(path);
    this.#stableHits.delete(path);
  }
}
