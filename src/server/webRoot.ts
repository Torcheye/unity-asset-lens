import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the static GUI assets (`web/`) at runtime. They ship as plain files
 * (no build step), so we probe a small set of candidates relative to this
 * module and the CWD — working both when run from source (`src/server`) and
 * from the bundled `dist/`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function candidates(): string[] {
  return [
    // dev (tsx): src/server/webRoot.ts -> <repo>/web
    resolve(HERE, "..", "..", "web"),
    // bundled: dist/<chunk>.js -> <repo>/web
    resolve(HERE, "..", "web"),
    resolve(HERE, "web"),
    // last resort: relative to the working directory
    resolve(process.cwd(), "web"),
  ];
}

/** Resolve the web root, honouring an explicit override. Throws if not found. */
export function resolveWebRoot(override?: string): string {
  if (override && override.trim().length > 0) {
    const root = resolve(override.trim());
    if (!existsSync(resolve(root, "index.html"))) {
      throw new Error(`No index.html under web root: ${root}`);
    }
    return root;
  }
  for (const dir of candidates()) {
    if (existsSync(resolve(dir, "index.html"))) return dir;
  }
  throw new Error(
    "Could not locate the GUI assets (web/index.html). Pass an explicit webRoot.",
  );
}
