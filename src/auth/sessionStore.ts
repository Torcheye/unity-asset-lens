import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Persistence for the browser login session (Playwright `storageState`).
 *
 * The state is an opaque JSON blob of Unity cookies + local storage captured
 * from the user's authenticated browser. It is sensitive (it stands in for a
 * logged-in session), so it is stored only on the local machine and can be
 * wiped with {@link SessionStore.clear} (`assetlens logout`).
 *
 * The store is injectable so the login orchestration can be unit-tested without
 * touching the real filesystem.
 */
export interface SessionStore {
  /** Where the session is persisted (for user-facing messaging). */
  readonly path: string;
  /** Load a previously saved session, or `null` if none/unreadable. */
  load(): Promise<unknown | null>;
  /** Persist a session snapshot, creating parent directories as needed. */
  save(state: unknown): Promise<void>;
  /** Remove any saved session. Idempotent — no error if absent. */
  clear(): Promise<void>;
}

/** A {@link SessionStore} backed by a single JSON file on disk. */
export function fileSessionStore(path: string): SessionStore {
  return {
    path,

    async load(): Promise<unknown | null> {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch {
        return null; // missing/unreadable — treat as "no saved session"
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        // A corrupt session file should not be fatal: behave as logged-out.
        return null;
      }
    },

    async save(state: unknown): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(state), "utf8");
    },

    async clear(): Promise<void> {
      await rm(path, { force: true });
    },
  };
}
