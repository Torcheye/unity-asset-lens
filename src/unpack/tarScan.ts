import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { buffer as readToBuffer } from "node:stream/consumers";
import { extract as tarExtract } from "tar-stream";

/**
 * Low-level gzip-tar scan tuned for `.unitypackage` files (spec §3.2).
 *
 * A `.unitypackage` is a gzip-compressed tarball where each contained file is a
 * directory named by a 32-char GUID holding `asset`, `asset.meta`, `pathname`
 * and sometimes `preview.png`. The "indexing trick" is to stream the tar and
 * read only the small `pathname` members, draining the large `asset` blobs so
 * we never hold them in memory.
 *
 * `captureAssetsFor` opts into buffering the `asset` blob for a known set of
 * GUIDs only — used for the second pass over nested wrapper packages, whose
 * GUIDs are discovered in the first (pathname-only) pass.
 */

export interface RawEntry {
  /** First line of the GUID dir's `pathname` member (the original asset path). */
  pathname?: string;
  /** Whether an `asset` blob is present (absent ⇒ the entry is a folder). */
  hasAsset: boolean;
  /** The raw `asset` bytes, only when this GUID was in `captureAssetsFor`. */
  assetBytes?: Buffer;
}

/** Parse a tar member name (`[./]<guid>/<member>`) into its GUID + member. */
export function parseEntryName(
  name: string,
): { guid: string; member: string } | null {
  const clean = name.replace(/^\.\//, "").replace(/\/+$/, "");
  const parts = clean.split("/").filter((p) => p.length > 0);
  if (parts.length < 2) return null; // top-level dir entry or stray member
  return { guid: parts[0]!, member: parts[parts.length - 1]! };
}

/** Take the first non-empty trimmed line of a `pathname` member's content. */
function firstLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

/**
 * Scan one gzip-tar stream, returning a GUID → {@link RawEntry} map.
 * The stream is produced by `makeStream` so the caller can re-open the same
 * source for a second pass without seeking.
 */
export async function scanTar(
  makeStream: () => Readable,
  captureAssetsFor: ReadonlySet<string> | null,
): Promise<Map<string, RawEntry>> {
  const entries = new Map<string, RawEntry>();
  const extract = tarExtract();

  extract.on("entry", (header, stream, next) => {
    const parsed = header.type === "directory" ? null : parseEntryName(header.name);
    if (!parsed) {
      stream.on("end", next);
      stream.resume();
      return;
    }
    const { guid, member } = parsed;
    let rec = entries.get(guid);
    if (!rec) {
      rec = { hasAsset: false };
      entries.set(guid, rec);
    }
    const current = rec;

    if (member === "pathname") {
      readToBuffer(stream)
        .then((buf) => {
          current.pathname = firstLine(buf.toString("utf8"));
          next();
        })
        .catch((err: Error) => extract.destroy(err));
      return;
    }

    if (member === "asset") {
      current.hasAsset = true;
      if (captureAssetsFor?.has(guid)) {
        readToBuffer(stream)
          .then((buf) => {
            current.assetBytes = buf;
            next();
          })
          .catch((err: Error) => extract.destroy(err));
        return;
      }
    }

    // asset.meta, preview.png, or an uncaptured asset blob → drain, don't store.
    stream.on("end", next);
    stream.resume();
  });

  await pipeline(makeStream(), createGunzip(), extract);
  return entries;
}
