import { stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { walkFiles } from "./walk.js";

/**
 * Discover downloaded `.unitypackage` files in the Asset Store cache (spec §3.1,
 * §5.2). Layout is `<root>/<Publisher>/<Category>/<Name>.unitypackage`, so the
 * publisher/category/name are derived from the path relative to the root.
 */

export interface ScannedPackage {
  readonly filePath: string;
  readonly publisher: string;
  readonly category: string;
  readonly name: string;
  readonly mtimeMs: number;
  readonly size: number;
}

const UNITYPACKAGE_RE = /\.unitypackage$/i;

export function isUnityPackage(path: string): boolean {
  return UNITYPACKAGE_RE.test(path);
}

function deriveParts(root: string, filePath: string): {
  publisher: string;
  category: string;
  name: string;
} {
  const rel = relative(root, filePath);
  const segments = rel.split(sep).filter(Boolean);
  const fileName = segments.length > 0 ? segments[segments.length - 1]! : filePath;
  const name = fileName.replace(UNITYPACKAGE_RE, "");
  const publisher = segments.length >= 2 ? segments[0]! : "Unknown";
  const category =
    segments.length >= 3 ? segments.slice(1, -1).join("/") : "";
  return { publisher, category, name };
}

/** Stat a single package path into a {@link ScannedPackage} (watcher use). */
export async function statPackage(
  root: string,
  filePath: string,
): Promise<ScannedPackage | undefined> {
  let st;
  try {
    st = await stat(filePath);
  } catch {
    return undefined;
  }
  if (!st.isFile()) return undefined;
  const { publisher, category, name } = deriveParts(root, filePath);
  return {
    filePath,
    publisher,
    category,
    name,
    mtimeMs: Math.floor(st.mtimeMs),
    size: st.size,
  };
}

/**
 * Scan the cache root, returning one entry per `.unitypackage` with its
 * mtime/size (used for incremental re-scans — spec §3.3). Returns an empty list
 * if the root does not exist.
 */
export async function scanCache(root: string): Promise<ScannedPackage[]> {
  try {
    const st = await stat(root);
    if (!st.isDirectory()) return [];
  } catch {
    return []; // cache root not present yet
  }

  const out: ScannedPackage[] = [];
  for await (const filePath of walkFiles(root)) {
    if (!isUnityPackage(filePath)) continue;
    let st;
    try {
      st = await stat(filePath);
    } catch {
      continue;
    }
    const { publisher, category, name } = deriveParts(root, filePath);
    out.push({
      filePath,
      publisher,
      category,
      name,
      mtimeMs: Math.floor(st.mtimeMs),
      size: st.size,
    });
  }
  return out;
}
