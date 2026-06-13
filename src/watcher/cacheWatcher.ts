import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { isUnityPackage } from "../local/scanCache.js";
import { StableFileTracker } from "./stableFile.js";

/**
 * Watch the Asset Store cache for newly-downloaded `.unitypackage` files and
 * fire a callback once each file's bytes have settled (spec §5.7: detect the
 * new package, then run the recursive unpack to flip it to local+deep).
 *
 * Recursive watching is supported on Windows and macOS; on Linux `fs.watch`
 * recursion is unavailable, so only the root level is observed there.
 */

export interface CacheWatcher {
  close(): void;
}

export interface WatchOptions {
  /** Debounce before stat-polling a changed path (ms). Default 750. */
  readonly settleDelayMs?: number;
  /** Consecutive equal-size samples required before firing. Default 2. */
  readonly stableHits?: number;
  readonly onError?: (err: Error) => void;
}

export function watchCache(
  root: string,
  onPackageStable: (filePath: string) => void,
  opts: WatchOptions = {},
): CacheWatcher {
  const settleDelay = opts.settleDelayMs ?? 750;
  const tracker = new StableFileTracker(opts.stableHits ?? 2);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const onError = opts.onError ?? (() => {});

  const poll = (filePath: string): void => {
    void stat(filePath)
      .then((st) => {
        if (tracker.observe(filePath, st.size)) {
          tracker.forget(filePath);
          onPackageStable(filePath);
        } else {
          schedule(filePath); // not settled yet — check again
        }
      })
      .catch(() => {
        // File vanished mid-download or is briefly locked; drop it.
        tracker.forget(filePath);
      });
  };

  const schedule = (filePath: string): void => {
    const existing = timers.get(filePath);
    if (existing) clearTimeout(existing);
    timers.set(
      filePath,
      setTimeout(() => {
        timers.delete(filePath);
        poll(filePath);
      }, settleDelay),
    );
  };

  let watcher: ReturnType<typeof watch>;
  try {
    watcher = watch(root, { recursive: process.platform !== "linux" });
  } catch (err) {
    onError(err as Error);
    return { close: () => {} };
  }

  watcher.on("change", (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString();
    if (!isUnityPackage(rel)) return;
    schedule(join(root, rel));
  });
  watcher.on("error", (err) => onError(err));

  return {
    close: () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      watcher.close();
    },
  };
}
