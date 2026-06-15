import type { ServerResponse } from "node:http";
import type { AssetLensEngine } from "../engine.js";
import type { ProgressReporter } from "../domain/progress.js";
import { openSse } from "./http.js";

/**
 * Scan-and-index a registered local folder, streaming its progress to the
 * browser over Server-Sent Events (mirrors `steps.ts`). Emits `progress` while
 * scanning, then a single `done` carrying the resulting folder info, or an
 * `error` event on failure.
 *
 * `mode` "add" requires the path to be an existing directory; "rescan" keeps an
 * already-registered folder's files and merely flags it `missing` if its path
 * has gone away (the "keep & warn" behaviour).
 */
export type FolderScanMode = "add" | "rescan";

export async function runFolderScan(
  engine: AssetLensEngine,
  path: string,
  mode: FolderScanMode,
  res: ServerResponse,
): Promise<void> {
  const emit = openSse(res);
  const onProgress: ProgressReporter = (e) =>
    emit("progress", { message: e.message, current: e.current, total: e.total });
  try {
    const folder =
      mode === "rescan"
        ? await engine.rescanLocalFolder(path, { onProgress })
        : await engine.addLocalFolder(path, { onProgress });
    emit("done", { folder });
  } catch (err) {
    emit("error", { message: (err as Error).message });
  } finally {
    res.end();
  }
}
