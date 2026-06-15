import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively yield absolute file paths under `dir`, depth-first. Unreadable
 * directories (permissions, races) are skipped silently rather than throwing,
 * so a single bad subtree never aborts a whole scan.
 *
 * Shared by the Asset Store cache scan (`scanCache.ts`) and the user-folder
 * scan (`folderIndexer.ts`).
 */
export async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir (permissions, race) — skip silently
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
