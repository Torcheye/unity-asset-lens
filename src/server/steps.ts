import type { ServerResponse } from "node:http";
import type { AssetLensEngine } from "../engine.js";
import { openSse } from "./http.js";

/**
 * Run a setup step (login → scan → fetch, spec §5.1–5.4) and stream its
 * `onProgress` output to the browser over Server-Sent Events. Each step emits
 * `progress` events while running, then a single `done` event carrying a
 * human-readable summary, or an `error` event on failure.
 */

export type StepName = "import" | "scan" | "fetch";

export function isStepName(s: string): s is StepName {
  return s === "import" || s === "scan" || s === "fetch";
}

export async function runStep(
  engine: AssetLensEngine,
  name: StepName,
  res: ServerResponse,
): Promise<void> {
  const emit = openSse(res);
  const onProgress = (message: string): void => emit("progress", { message });
  try {
    const detail = await execute(engine, name, onProgress, emit);
    emit("done", { detail });
  } catch (err) {
    emit("error", { message: (err as Error).message });
  } finally {
    res.end();
  }
}

async function execute(
  engine: AssetLensEngine,
  name: StepName,
  onProgress: (message: string) => void,
  emit: (event: string, data: unknown) => void,
): Promise<string> {
  switch (name) {
    case "import": {
      const r = await engine.loginAndImport({
        onProgress,
        delayMs: 250,
        // Push the signed-in status to the browser immediately, so the header
        // updates before catalog import + keyword enrichment finish.
        onSignedIn: (status) => emit("account", status),
      });
      return (
        `${r.email ? `${r.email} · ` : ""}` +
        `${r.imported} of ${r.owned} owned products imported · ` +
        `keywords for ${r.keywords}` +
        (r.remembered ? " · session saved for next time" : "")
      );
    }
    case "scan": {
      const r = await engine.scanLocal({ onProgress });
      return (
        `${r.indexed} indexed · ${r.matched} matched · ` +
        `${r.scanned} packages (${r.errors.length} errors)`
      );
    }
    case "fetch": {
      const session = await engine.anonymousSession();
      const r = await engine.fetchOnline(session, { delayMs: 250, onProgress });
      return `${r.deepIndexed} deep-indexed · ${r.wrappers} wrappers kept shallow`;
    }
  }
}
