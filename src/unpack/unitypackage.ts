import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ProductFile } from "../domain/types.js";
import { baseNameOf, bucketForPath, extOf } from "../domain/fileType.js";
import { isWrapperByLeaves } from "../domain/wrapper.js";
import { scanTar } from "./tarScan.js";

/**
 * Parse a `.unitypackage` into its file list, recursing into nested wrapper
 * packages (spec §3.2 streaming, §3.3 tar-in-tar recursion).
 *
 * Modern multi-pipeline art packs ship as a *wrapper*: the outer package
 * contains only nested `.unitypackage` files (one per render pipeline) plus a
 * readme. Locally, each nested package's bytes are the `asset` blob of an outer
 * tar member — we read the outer tar, capture those blobs, and feed them into a
 * second tar reader. No second download needed.
 */

export interface ParseOptions {
  /** Recurse into nested `.unitypackage` blobs (default true). */
  readonly recurse?: boolean;
  /** Max nesting depth as a runaway guard (default 4). */
  readonly maxDepth?: number;
}

export interface ParsedPackage {
  readonly files: readonly ProductFile[];
  /** True when leaves are only `.unitypackage` (+ readme) — spec §3.3 heuristic. */
  readonly isWrapper: boolean;
  /** Base names of nested packages that were recursed into. */
  readonly nestedPackages: readonly string[];
}

function toFile(fullPath: string, nestedPkg?: string): ProductFile {
  const fileName = baseNameOf(fullPath);
  return {
    fullPath,
    fileName,
    ext: extOf(fileName),
    typeBucket: bucketForPath(fileName),
    ...(nestedPkg ? { nestedPkg } : {}),
    source: "local",
  };
}

interface ParseContext {
  readonly recurse: boolean;
  readonly maxDepth: number;
}

async function parseSource(
  makeStream: () => Readable,
  ctx: ParseContext,
  depth: number,
  nestedLabel: string | undefined,
): Promise<ParsedPackage> {
  // Pass 1: pathname members only (cheap), discovering nested packages.
  const entries = await scanTar(makeStream, null);

  const files: ProductFile[] = [];
  const leafPaths: string[] = [];
  const nestedGuids = new Set<string>();
  const nestedPackages: string[] = [];

  for (const [guid, rec] of entries) {
    // No asset blob ⇒ a folder, not a file (spec §3.2). Skip pathless entries.
    if (!rec.pathname || !rec.hasAsset) continue;
    const path = rec.pathname;
    leafPaths.push(path);

    const isNestedPkg = path.toLowerCase().endsWith(".unitypackage");
    if (isNestedPkg && ctx.recurse && depth < ctx.maxDepth) {
      nestedGuids.add(guid);
      nestedPackages.push(baseNameOf(path));
    } else {
      files.push(toFile(path, nestedLabel));
    }
  }

  const isWrapper = isWrapperByLeaves(leafPaths);

  // Pass 2: capture only the nested-package asset blobs and recurse into them.
  if (nestedGuids.size > 0) {
    const captured = await scanTar(makeStream, nestedGuids);
    for (const guid of nestedGuids) {
      const rec = captured.get(guid);
      const innerLabel = baseNameOf(entries.get(guid)?.pathname ?? "nested");
      if (!rec?.assetBytes) continue; // blob missing — skip rather than fail
      const innerBytes = rec.assetBytes;
      const inner = await parseSource(
        () => Readable.from(innerBytes),
        ctx,
        depth + 1,
        innerLabel,
      );
      files.push(...inner.files);
    }
  }

  return { files, isWrapper, nestedPackages };
}

function contextFrom(opts: ParseOptions | undefined): ParseContext {
  return {
    recurse: opts?.recurse ?? true,
    maxDepth: opts?.maxDepth ?? 4,
  };
}

/** Parse a `.unitypackage` from disk, streaming (low memory for huge bundles). */
export function parseUnityPackageFile(
  filePath: string,
  opts?: ParseOptions,
): Promise<ParsedPackage> {
  return parseSource(
    () => createReadStream(filePath),
    contextFrom(opts),
    0,
    undefined,
  );
}

/** Parse a `.unitypackage` already held in memory (e.g. a nested blob). */
export function parseUnityPackageBuffer(
  bytes: Buffer,
  opts?: ParseOptions,
): Promise<ParsedPackage> {
  return parseSource(() => Readable.from(bytes), contextFrom(opts), 0, undefined);
}
