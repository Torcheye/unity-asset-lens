import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Create a unique temp directory and a disposer that removes it. */
export async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "assetlens-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Write `bytes` to `root/relativePath`, creating parent directories. */
export async function writeFileAt(
  root: string,
  relativePath: string,
  bytes: Buffer | string,
): Promise<string> {
  const full = join(root, relativePath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return full;
}
