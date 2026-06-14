import type { ServerResponse } from "node:http";
import type { AssetLensEngine } from "../engine.js";
import { openSse } from "./http.js";

/**
 * Run a setup step (sign in → import → scan → fetch, spec §5.1–5.4) and stream
 * its `onProgress` output to the browser over Server-Sent Events. Each step
 * emits `progress` events while running, then a single `done` event carrying a
 * human-readable summary, or an `error` event on failure.
 */

export type StepName = "signin" | "import" | "scan" | "fetch";

export function isStepName(s: string): s is StepName {
  return s === "signin" || s === "import" || s === "scan" || s === "fetch";
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
    case "signin": {
      const r = await engine.signIn({
        onProgress,
        // Push the signed-in status to the browser the instant sign-in lands,
        // so the header indicator flips before the step's `done` event arrives.
        onSignedIn: (status) => emit("account", status),
      });
      return (
        `${r.email ? `${r.email} · ` : ""}` +
        `${r.ownedCount} owned products found` +
        (r.remembered ? " · session saved for next time" : "")
      );
    }
    case "import": {
      const r = await engine.importLibrary({ onProgress, delayMs: 250 });
      return (
        `${r.imported} of ${r.owned} owned products imported · ` +
        `keywords for ${r.keywords}`
      );
    }
    case "scan": {
      const r = await engine.scanLocal({ onProgress });
      return (
        `${r.indexed} indexed · ${r.matched} matched · ` +
        (r.pruned ? `${r.pruned} duplicates removed · ` : "") +
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
