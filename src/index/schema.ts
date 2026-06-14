/**
 * SQLite index schema (spec §6). One global DB shared across projects.
 *
 * Design choice: `files_fts` is a *standalone* FTS5 table (not external-content)
 * that denormalises the small set of searchable product fields onto every file
 * row. This trades a little disk for simplicity and correctness — no triggers,
 * fully atomic per-product rewrites, and direct UPDATE for keyword indexing.
 * `product_id` is carried UNINDEXED so we can delete/update a product's rows.
 *
 * Column order in `files_fts` matters: bm25() weights are positional from
 * column 0, so the indexed text columns come first (see search.ts weights).
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  product_id    TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  publisher     TEXT NOT NULL,
  category      TEXT,
  description   TEXT,
  tags          TEXT,
  download_size INTEGER,
  is_hidden     INTEGER NOT NULL DEFAULT 0,
  is_wrapper    INTEGER NOT NULL DEFAULT 0,
  coverage      TEXT NOT NULL CHECK (coverage IN ('deep','shallow')),
  source        TEXT NOT NULL CHECK (source IN ('local','online')),
  store_url     TEXT NOT NULL,
  local_path    TEXT,
  kharma_id     TEXT,
  indexed_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  TEXT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  full_path   TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  ext         TEXT,
  type_bucket TEXT NOT NULL,
  nested_pkg  TEXT,
  source      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_product ON files(product_id);
CREATE INDEX IF NOT EXISTS idx_files_bucket ON files(type_bucket);

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  full_path,
  file_name,
  product_name,
  publisher,
  category,
  tags,
  product_id UNINDEXED,
  tokenize = 'unicode61'
);

-- Incremental local-scan cache: skip re-parsing packages whose bytes are
-- unchanged (spec §3.3 "keyed by file mtime/size so re-scans are incremental").
CREATE TABLE IF NOT EXISTS scanned_packages (
  file_path  TEXT PRIMARY KEY,
  mtime_ms   INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  product_id TEXT,
  indexed_at INTEGER NOT NULL
);

-- Product-level metadata FTS: lets a product be found by name/keywords even
-- before it has any indexed files (shallow/online/wrapper), then "upgraded" to
-- file hits once deep-indexed (spec §4, §7). product_id carried UNINDEXED.
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  product_name,
  publisher,
  category,
  tags,
  description,
  product_id UNINDEXED,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

/** Current schema version, bumped on breaking schema changes. */
export const SCHEMA_VERSION = "1";
