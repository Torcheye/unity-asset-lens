import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively yield absolute file paths under `dir`, depth-first. Unreadable
 * directories (permissions, races) are skipped silently rather than throwing,
 * so a single bad subtree never aborts a whole scan.
 *
 * Cycle-safe: each directory's resolved real path is tracked in `seen`, so a
 * symlink or Windows directory-junction loop (e.g. a junction pointing at an
 * ancestor) is detected and stopped instead of recursing forever. This matters
 * now that the walker also runs on arbitrary user-chosen folders, not just the
 * Unity-controlled cache root. The *yielded* paths are still the plain
 * `join`-based paths (not the resolved real paths), so callers that derive
 * structure from the path see no change.
 *
 * Shared by the Asset Store cache scan (`scanCache.ts`) and the user-folder
 * scan (`folderIndexer.ts`).
 */
export async function* walkFiles(
  dir: string,
  seen: Set<string> = new Set(),
): AsyncGenerator<string> {
  let real: string;
  try {
    real = await realpath(dir);
  } catch {
    return; // vanished/unreadable — skip silently
  }
  if (seen.has(real)) return; // symlink/junction cycle (or duplicate) — stop
  seen.add(real);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir (permissions, race) — skip silently
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, seen);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
