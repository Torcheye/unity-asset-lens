import { createGzip } from "node:zlib";
import { buffer as readToBuffer } from "node:stream/consumers";
import { pack as tarPack } from "tar-stream";

/**
 * Test helper: synthesise a real gzip-compressed `.unitypackage` byte buffer
 * with Unity's `<guid>/{asset,asset.meta,pathname}` layout, so the parser is
 * exercised against genuine tar/gzip rather than mocks.
 */

export interface PackageEntry {
  /** Original project-relative path stored in the `pathname` member. */
  readonly path: string;
  /** Raw `asset` blob. For a nested wrapper, pass another package's bytes. */
  readonly asset?: Buffer;
  /** Folders have a `pathname` + `asset.meta` but no `asset` blob (spec §3.2). */
  readonly isFolder?: boolean;
}

function makeGuid(n: number): string {
  return n.toString(16).padStart(32, "0");
}

function addEntry(
  pack: ReturnType<typeof tarPack>,
  name: string,
  content: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    pack.entry({ name }, content, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

/** Build a `.unitypackage` buffer from a list of entries. */
export async function buildUnityPackage(
  entries: readonly PackageEntry[],
): Promise<Buffer> {
  const pack = tarPack();
  const gzip = createGzip();
  pack.pipe(gzip);
  const bytes = readToBuffer(gzip);

  let counter = 0;
  for (const e of entries) {
    const guid = makeGuid(counter++);
    // Real packages emit asset before pathname; mirror that ordering so the
    // parser is tested against the harder case.
    if (!e.isFolder) {
      await addEntry(
        pack,
        `${guid}/asset`,
        e.asset ?? Buffer.from(`dummy-bytes-for:${e.path}`, "utf8"),
      );
    }
    await addEntry(pack, `${guid}/asset.meta`, Buffer.from("guid: x\n", "utf8"));
    await addEntry(
      pack,
      `${guid}/pathname`,
      Buffer.from(`${e.path}\n00`, "utf8"),
    );
  }

  pack.finalize();
  return bytes;
}
