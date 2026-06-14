import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";
import { contentTypeFor } from "./http.js";

/**
 * Serve the static GUI assets from a fixed web root, with a path-traversal
 * guard so a crafted URL can never escape the root (validate at the boundary —
 * never trust the request path).
 */

/** Resolve a URL path to a real file inside `webRoot`, or null if it escapes. */
export function resolveSafePath(webRoot: string, urlPath: string): string | null {
  const decoded = safeDecode(urlPath);
  if (decoded === null) return null;
  // Strip the query/hash already removed by the caller; normalise separators.
  const rel = normalize(decoded).replace(/^([/\\])+/, "");
  const root = resolve(webRoot);
  const full = resolve(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * Stream a static file if it exists under `webRoot`. Returns false (without
 * writing a response) when the path is missing or not a regular file, so the
 * caller can fall back (e.g. to the SPA entry point).
 */
export async function serveStatic(
  webRoot: string,
  urlPath: string,
  res: ServerResponse,
): Promise<boolean> {
  const full = resolveSafePath(webRoot, urlPath === "/" ? "/index.html" : urlPath);
  if (full === null) return false;
  let info;
  try {
    info = await stat(full);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const ext = extname(full).replace(/^\./, "");
  res.writeHead(200, {
    "content-type": contentTypeFor(ext),
    "content-length": info.size,
    "cache-control": "no-cache",
  });
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(full);
    stream.on("error", fail);
    stream.on("end", done);
    stream.pipe(res);
  });
  return true;
}
