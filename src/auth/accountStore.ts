import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Persistence for the signed-in account's display metadata.
 *
 * This is the non-sensitive companion to the opaque {@link SessionStore} blob:
 * the email AssetLens observed during sign-in, how many products were owned, and
 * when the catalog was last imported. The GUI reads it to show "signed in as …".
 * It shares the session's lifecycle — written on login, cleared on logout — so
 * the two never disagree about who is signed in.
 *
 * The store is injectable so login orchestration can be unit-tested without
 * touching the real filesystem.
 */
export interface AccountInfo {
  /** Email captured from the authenticated `CurrentUser` response, if any. */
  readonly email: string | null;
  /** Owned product IDs discovered for the signed-in user, if known. */
  readonly ownedCount: number | null;
  /** When the catalog was last imported, in epoch ms, if known. */
  readonly importedAt: number | null;
}

export interface AccountStore {
  /** Where the metadata is persisted (for user-facing messaging). */
  readonly path: string;
  /** Load the saved account metadata, or `null` if none/unreadable. */
  load(): Promise<AccountInfo | null>;
  /** Persist account metadata, creating parent directories as needed. */
  save(info: AccountInfo): Promise<void>;
  /** Remove any saved metadata. Idempotent — no error if absent. */
  clear(): Promise<void>;
}

function normalize(value: unknown): AccountInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  return {
    email: typeof raw.email === "string" ? raw.email : null,
    ownedCount: typeof raw.ownedCount === "number" ? raw.ownedCount : null,
    importedAt: typeof raw.importedAt === "number" ? raw.importedAt : null,
  };
}

/** An {@link AccountStore} backed by a single JSON file on disk. */
export function fileAccountStore(path: string): AccountStore {
  return {
    path,

    async load(): Promise<AccountInfo | null> {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch {
        return null; // missing/unreadable — treat as "no saved account"
      }
      try {
        return normalize(JSON.parse(text));
      } catch {
        // A corrupt file should not be fatal: behave as "no saved account".
        return null;
      }
    },

    async save(info: AccountInfo): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(info), "utf8");
    },

    async clear(): Promise<void> {
      await rm(path, { force: true });
    },
  };
}
