import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

/** A better-sqlite3 database handle. */
export type DB = Database.Database;

export interface OpenOptions {
  /** Use `":memory:"` for an ephemeral DB (tests). Otherwise a file path. */
  readonly path: string;
  readonly readonly?: boolean;
}

/**
 * Open (creating if needed) the SQLite index, apply pragmas, and ensure the
 * schema exists. Returns a ready-to-use handle the repository wraps.
 */
export function openDatabase(opts: OpenOptions): DB {
  const { path } = opts;
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { readonly: opts.readonly ?? false });
  // WAL gives readers-don't-block-writers; fine for a single-user local index.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  if (!opts.readonly) {
    db.exec(SCHEMA_SQL);
    db.prepare(
      "INSERT INTO meta(key, value) VALUES ('schema_version', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(SCHEMA_VERSION);
  }
  return db;
}
