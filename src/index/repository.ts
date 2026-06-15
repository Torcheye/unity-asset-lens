import type { DB } from "./db.js";
import type {
  CatalogProduct,
  Coverage,
  IndexedProduct,
  ProductFile,
  Source,
} from "../domain/types.js";
import { storeUrl as buildStoreUrl } from "../store/constants.js";

/**
 * Data-access layer over the SQLite index (spec §6).
 *
 * All multi-statement writes run inside transactions so a product and its files
 * are always consistent. Re-indexing is last-write-wins: writing a product
 * replaces its file set atomically.
 */

function tagsToText(tags: readonly string[]): string | null {
  const joined = tags.map((t) => t.trim()).filter(Boolean).join(", ");
  return joined.length > 0 ? joined : null;
}

export interface ProductRow {
  product_id: string;
  name: string;
  publisher: string;
  category: string | null;
  description: string | null;
  tags: string | null;
  download_size: number | null;
  is_hidden: number;
  is_wrapper: number;
  coverage: Coverage;
  source: Source;
  store_url: string;
  local_path: string | null;
  kharma_id: string | null;
  indexed_at: number;
}

export interface FileRow {
  id: number;
  product_id: string;
  full_path: string;
  file_name: string;
  ext: string | null;
  type_bucket: string;
  nested_pkg: string | null;
  source: Source;
}

export interface IndexStats {
  products: number;
  files: number;
  localProducts: number;
  onlineProducts: number;
  deepProducts: number;
}

/** A registered local-folder row (the `local_folders` table). */
export interface LocalFolderRow {
  path: string;
  product_id: string;
  file_count: number;
  total_size: number;
  status: "ok" | "missing";
  added_at: number;
  scanned_at: number;
}

/** Fields needed to insert/refresh a {@link LocalFolderRow}. */
export interface LocalFolderInput {
  readonly path: string;
  readonly productId: string;
  readonly fileCount: number;
  readonly totalSize: number;
  readonly status: "ok" | "missing";
  readonly addedAt: number;
  readonly scannedAt: number;
}

export class Repository {
  readonly #db: DB;

  constructor(db: DB) {
    this.#db = db;
  }

  get db(): DB {
    return this.#db;
  }

  /**
   * Seed/update a product at the catalog level only (spec §5.1). Preserves any
   * existing coverage/source/category/file data on conflict — this is used when
   * (re)importing the owned list and must not clobber a deep-indexed product.
   */
  upsertCatalogProduct(p: CatalogProduct, now: number): void {
    this.#db
      .prepare(
        `INSERT INTO products
           (product_id, name, publisher, download_size, is_hidden,
            store_url, kharma_id, coverage, source, indexed_at)
         VALUES
           (@product_id, @name, @publisher, @download_size, @is_hidden,
            @store_url, @kharma_id, 'shallow', 'online', @indexed_at)
         ON CONFLICT(product_id) DO UPDATE SET
           name = excluded.name,
           publisher = excluded.publisher,
           download_size = excluded.download_size,
           is_hidden = excluded.is_hidden,
           store_url = excluded.store_url,
           kharma_id = excluded.kharma_id,
           indexed_at = excluded.indexed_at`,
      )
      .run({
        product_id: p.id,
        name: p.name,
        publisher: p.publisher,
        download_size: p.downloadSize ?? null,
        is_hidden: p.isHidden ? 1 : 0,
        store_url: buildStoreUrl(p.id),
        kharma_id: p.productId ?? p.id,
        indexed_at: now,
      });
    this.#writeProductFts(p.id);
  }

  /** Rebuild the product-level FTS row from the current product row. */
  #writeProductFts(productId: string): void {
    const r = this.getProduct(productId);
    if (!r) return;
    this.#db
      .prepare("DELETE FROM products_fts WHERE product_id = ?")
      .run(productId);
    this.#db
      .prepare(
        `INSERT INTO products_fts
           (product_name, publisher, category, tags, description, product_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.name,
        r.publisher,
        r.category ?? "",
        r.tags ?? "",
        r.description ?? "",
        productId,
      );
  }

  /** Bulk catalog import in one transaction; returns the count written. */
  importCatalog(products: readonly CatalogProduct[], now: number): number {
    const tx = this.#db.transaction((rows: readonly CatalogProduct[]) => {
      for (const p of rows) this.upsertCatalogProduct(p, now);
      return rows.length;
    });
    return tx(products);
  }

  /**
   * Write a fully-resolved product and its file set atomically, replacing any
   * prior files for that product (deep index — spec §4, §5.3/§5.4).
   */
  writeIndexedProduct(indexed: IndexedProduct, now: number): void {
    const tx = this.#db.transaction((ip: IndexedProduct) => {
      const p = ip.product;
      this.#db
        .prepare(
          `INSERT INTO products
             (product_id, name, publisher, category, description, tags,
              download_size, is_hidden, is_wrapper, coverage, source,
              store_url, local_path, kharma_id, indexed_at)
           VALUES
             (@product_id, @name, @publisher, @category, @description, @tags,
              @download_size, @is_hidden, @is_wrapper, @coverage, @source,
              @store_url, @local_path, @kharma_id, @indexed_at)
           ON CONFLICT(product_id) DO UPDATE SET
             name = excluded.name,
             publisher = excluded.publisher,
             -- Keep an existing category (a canonical store breadcrumb from
             -- enrichment, e.g. "3D/Props/Exterior") over the incoming value: a
             -- local scan only supplies a mangled folder-name guess ("3D Models
             -- PropsExterior"), so it must not clobber the better one. Enrichment
             -- still upgrades it via enrichProduct's own COALESCE(@category, …).
             category = COALESCE(products.category, excluded.category),
             description = COALESCE(excluded.description, products.description),
             tags = COALESCE(excluded.tags, products.tags),
             download_size = excluded.download_size,
             is_hidden = excluded.is_hidden,
             is_wrapper = excluded.is_wrapper,
             coverage = excluded.coverage,
             source = excluded.source,
             store_url = excluded.store_url,
             local_path = excluded.local_path,
             kharma_id = excluded.kharma_id,
             indexed_at = excluded.indexed_at`,
        )
        .run({
          product_id: p.id,
          name: p.name,
          publisher: p.publisher,
          category: ip.category ?? null,
          description: ip.description ?? null,
          tags: tagsToText(ip.tags),
          download_size: p.downloadSize ?? null,
          is_hidden: p.isHidden ? 1 : 0,
          is_wrapper: ip.isWrapper ? 1 : 0,
          coverage: ip.coverage,
          source: ip.source,
          store_url: ip.storeUrl,
          local_path: ip.localPath ?? null,
          kharma_id: p.productId ?? p.id,
          indexed_at: now,
        });

      this.#replaceFiles(p.id, ip.files, p.name, p.publisher, ip.category, ip.tags);
      this.#writeProductFts(p.id);
    });
    tx(indexed);
  }

  /** Replace a product's file rows (+ FTS rows) with a new set. */
  #replaceFiles(
    productId: string,
    files: readonly ProductFile[],
    productName: string,
    publisher: string,
    category: string | undefined,
    tags: readonly string[],
  ): void {
    this.#db.prepare("DELETE FROM files_fts WHERE product_id = ?").run(productId);
    this.#db.prepare("DELETE FROM files WHERE product_id = ?").run(productId);

    const insertFile = this.#db.prepare(
      `INSERT INTO files
         (product_id, full_path, file_name, ext, type_bucket, nested_pkg, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = this.#db.prepare(
      `INSERT INTO files_fts
         (rowid, full_path, file_name, product_name, publisher, category, tags, product_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tagText = tagsToText(tags) ?? "";
    const cat = category ?? "";
    for (const f of files) {
      const info = insertFile.run(
        productId,
        f.fullPath,
        f.fileName,
        f.ext || null,
        f.typeBucket,
        f.nestedPkg ?? null,
        f.source,
      );
      insertFts.run(
        Number(info.lastInsertRowid),
        f.fullPath,
        f.fileName,
        productName,
        publisher,
        cat,
        tagText,
        productId,
      );
    }
  }

  /**
   * Index a product's store-page **keywords** (+ category) as searchable
   * metadata, updating both the product row and its FTS rows so the new
   * keywords are immediately searchable. Runs as part of catalog import
   * (spec §3.4). Never stores a product description.
   */
  enrichProduct(
    productId: string,
    meta: { category?: string; tags?: readonly string[] },
    now: number,
  ): void {
    const tagText = meta.tags ? tagsToText(meta.tags) : undefined;
    const tx = this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE products SET
             category = COALESCE(@category, category),
             tags = COALESCE(@tags, tags),
             indexed_at = @indexed_at
           WHERE product_id = @product_id`,
        )
        .run({
          product_id: productId,
          category: meta.category ?? null,
          tags: tagText ?? null,
          indexed_at: now,
        });
      // Mirror onto FTS rows (skip COALESCE: FTS has no null semantics here).
      this.#db
        .prepare(
          `UPDATE files_fts SET
             category = COALESCE(?, category),
             tags = COALESCE(?, tags)
           WHERE product_id = ?`,
        )
        .run(meta.category ?? null, tagText ?? null, productId);
      this.#writeProductFts(productId);
    });
    tx();
  }

  getProduct(productId: string): ProductRow | undefined {
    return this.#db
      .prepare("SELECT * FROM products WHERE product_id = ?")
      .get(productId) as ProductRow | undefined;
  }

  getFile(id: number): (FileRow & { store_url: string; local_path: string | null; kharma_id: string | null }) | undefined {
    return this.#db
      .prepare(
        `SELECT f.*, p.store_url, p.local_path, p.kharma_id
         FROM files f JOIN products p ON p.product_id = f.product_id
         WHERE f.id = ?`,
      )
      .get(id) as
      | (FileRow & { store_url: string; local_path: string | null; kharma_id: string | null })
      | undefined;
  }

  /**
   * Reconstruct the real store-catalog rows from the index (for local matching).
   * Excludes synthetic `local:` placeholders — they are not catalog entries, and
   * including them would shadow a real product's name and make the matcher's
   * name-only fallback ambiguous, so a re-scan could never re-home them. Also
   * excludes `folder:` rows (registered local folders are not catalog products).
   */
  listCatalogProducts(): CatalogProduct[] {
    const rows = this.#db
      .prepare(
        "SELECT product_id, name, publisher, download_size, is_hidden, kharma_id " +
          "FROM products WHERE product_id NOT LIKE 'local:%' " +
          "AND product_id NOT LIKE 'folder:%'",
      )
      .all() as Array<{
      product_id: string;
      name: string;
      publisher: string;
      download_size: number | null;
      is_hidden: number;
      kharma_id: string | null;
    }>;
    return rows.map((r) => ({
      id: r.product_id,
      productId: r.kharma_id ?? r.product_id,
      name: r.name,
      publisher: r.publisher,
      ...(r.download_size !== null ? { downloadSize: r.download_size } : {}),
      isHidden: r.is_hidden === 1,
    }));
  }

  /** Product ids that are owned but not yet deep-indexed (online fetch queue). */
  listProductsToFetchOnline(limit?: number): string[] {
    const sql =
      "SELECT product_id FROM products WHERE coverage = 'shallow' AND source = 'online'" +
      (limit ? " LIMIT ?" : "");
    const rows = (limit
      ? this.#db.prepare(sql).all(limit)
      : this.#db.prepare(sql).all()) as { product_id: string }[];
    return rows.map((r) => r.product_id);
  }

  /**
   * Product ids for the keyword-fetch queue. By default only products *lacking*
   * keywords (the incremental import path); with `force`, every product — used
   * by `assetlens enrich --force` to re-pull Related keywords after a parser
   * change (existing rows would otherwise never refresh).
   */
  listProductsToEnrich(limit?: number, force = false): string[] {
    const where = force ? "" : " WHERE tags IS NULL OR tags = ''";
    const sql =
      `SELECT product_id FROM products${where}` + (limit ? " LIMIT ?" : "");
    const rows = (limit
      ? this.#db.prepare(sql).all(limit)
      : this.#db.prepare(sql).all()) as { product_id: string }[];
    return rows.map((r) => r.product_id);
  }

  /**
   * Drop all stored keyword tags (products + both FTS mirrors) ahead of a forced
   * re-enrich, so the keyword cloud reflects *only* freshly-fetched Related
   * keywords — no stale title/category text lingering for products that turn out
   * to have no Related-keywords section. Category and names are untouched.
   */
  clearKeywordTags(): void {
    const tx = this.#db.transaction(() => {
      this.#db.prepare("UPDATE products SET tags = NULL").run();
      this.#db.prepare("UPDATE files_fts SET tags = ''").run();
      this.#db.prepare("UPDATE products_fts SET tags = ''").run();
    });
    tx();
  }

  /**
   * Remove `local:` placeholder products that have been superseded.
   *
   * A synthetic `local:<pub>/<slug>` row is created when a cached package can't
   * be matched to the catalog *at scan time* (e.g. `scan` ran before the owned
   * catalog was imported). Once the catalog is present, a re-scan re-homes those
   * files onto the real store id and repoints the package's `scanned_packages`
   * row, leaving the old `local:` row orphaned.
   *
   * The precise, safe signal is **no `scanned_packages` row references it**: a
   * `local:` product is created with such a reference and only loses it when a
   * later scan re-homes the package elsewhere (and `writeIndexedProduct` is
   * transactional, so the files are already safe under the new id). A genuinely
   * local-only package keeps its reference and is never pruned — so this is safe
   * to run after *every* scan, regardless of publisher (name-only re-homes
   * included). Returns the number of products removed.
   */
  pruneSupersededLocalProducts(): number {
    const rows = this.#db
      .prepare("SELECT product_id FROM products WHERE product_id LIKE 'local:%'")
      .all() as Array<{ product_id: string }>;
    const referenced = new Set(
      (
        this.#db
          .prepare(
            "SELECT DISTINCT product_id FROM scanned_packages WHERE product_id IS NOT NULL",
          )
          .all() as Array<{ product_id: string }>
      ).map((r) => r.product_id),
    );

    const superseded = rows.filter((r) => !referenced.has(r.product_id));
    if (superseded.length === 0) return 0;

    const tx = this.#db.transaction(() => {
      const delFts = this.#db.prepare("DELETE FROM files_fts WHERE product_id = ?");
      const delPFts = this.#db.prepare(
        "DELETE FROM products_fts WHERE product_id = ?",
      );
      const delFiles = this.#db.prepare("DELETE FROM files WHERE product_id = ?");
      const delProd = this.#db.prepare("DELETE FROM products WHERE product_id = ?");
      for (const r of superseded) {
        delFts.run(r.product_id);
        delPFts.run(r.product_id);
        delFiles.run(r.product_id);
        delProd.run(r.product_id);
      }
    });
    tx();
    return superseded.length;
  }

  /** Map a stored product row back to a CatalogProduct. */
  catalogProductFor(productId: string): CatalogProduct | undefined {
    const r = this.getProduct(productId);
    if (!r) return undefined;
    return {
      id: r.product_id,
      productId: r.kharma_id ?? r.product_id,
      name: r.name,
      publisher: r.publisher,
      ...(r.download_size !== null ? { downloadSize: r.download_size } : {}),
      isHidden: r.is_hidden === 1,
    };
  }

  listPublishers(): string[] {
    // Registered folders store their absolute path as `publisher` for display;
    // exclude them so raw paths don't clutter the publisher filter dropdown.
    const rows = this.#db
      .prepare(
        "SELECT DISTINCT publisher FROM products WHERE product_id NOT LIKE 'folder:%' " +
          "ORDER BY publisher COLLATE NOCASE",
      )
      .all() as { publisher: string }[];
    return rows.map((r) => r.publisher);
  }

  stats(): IndexStats {
    const one = (sql: string): number =>
      (this.#db.prepare(sql).get() as { n: number }).n;
    return {
      products: one("SELECT COUNT(*) n FROM products"),
      files: one("SELECT COUNT(*) n FROM files"),
      localProducts: one("SELECT COUNT(*) n FROM products WHERE source = 'local'"),
      onlineProducts: one("SELECT COUNT(*) n FROM products WHERE source = 'online'"),
      deepProducts: one("SELECT COUNT(*) n FROM products WHERE coverage = 'deep'"),
    };
  }

  /**
   * Indexed-file counts grouped by type bucket, best-first (powers the GUI
   * overview donut / asset-type breakdown — spec §7 type filters).
   */
  typeBucketCounts(): Array<{ bucket: string; count: number }> {
    return this.#db
      .prepare(
        `SELECT type_bucket AS bucket, COUNT(*) AS count
         FROM files GROUP BY type_bucket ORDER BY count DESC, type_bucket`,
      )
      .all() as Array<{ bucket: string; count: number }>;
  }

  /**
   * Most frequent keywords across products (powers the GUI keyword cloud).
   * Keywords are stored comma-joined in `products.tags`; they are tallied here
   * case-insensitively, returning at most `limit` best-first.
   */
  topKeywords(limit = 26): Array<{ keyword: string; count: number }> {
    const rows = this.#db
      .prepare("SELECT tags FROM products WHERE tags IS NOT NULL AND tags <> ''")
      .all() as Array<{ tags: string }>;
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const raw of r.tags.split(",")) {
        const kw = raw.trim().toLowerCase();
        if (!kw) continue;
        counts.set(kw, (counts.get(kw) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
      .slice(0, Math.max(0, limit));
  }

  // ---- incremental local-scan cache (spec §3.3) ----------------------------

  /** Look up a previously-scanned package's recorded size/mtime. */
  getScannedPackage(
    filePath: string,
  ): { mtime_ms: number; size: number; product_id: string | null } | undefined {
    return this.#db
      .prepare(
        "SELECT mtime_ms, size, product_id FROM scanned_packages WHERE file_path = ?",
      )
      .get(filePath) as
      | { mtime_ms: number; size: number; product_id: string | null }
      | undefined;
  }

  recordScannedPackage(
    filePath: string,
    mtimeMs: number,
    size: number,
    productId: string,
    now: number,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO scanned_packages (file_path, mtime_ms, size, product_id, indexed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           mtime_ms = excluded.mtime_ms,
           size = excluded.size,
           product_id = excluded.product_id,
           indexed_at = excluded.indexed_at`,
      )
      .run(filePath, mtimeMs, size, productId, now);
  }

  /**
   * Delete a product and every trace of it (file + product FTS rows, files,
   * product row) in one transaction. Used to remove a registered folder's
   * synthetic product. (`files` cascades on the FK, but FTS rows are
   * standalone, so both are deleted explicitly.)
   */
  deleteProductCascade(productId: string): void {
    const tx = this.#db.transaction(() => {
      this.#db.prepare("DELETE FROM files_fts WHERE product_id = ?").run(productId);
      this.#db.prepare("DELETE FROM products_fts WHERE product_id = ?").run(productId);
      this.#db.prepare("DELETE FROM files WHERE product_id = ?").run(productId);
      this.#db.prepare("DELETE FROM products WHERE product_id = ?").run(productId);
    });
    tx();
  }

  // ---- registered local folders --------------------------------------------

  /**
   * Insert or refresh a registered folder's row. On conflict the original
   * `added_at` is preserved (a re-scan keeps the time the folder was first
   * added); everything else is updated to the latest scan.
   */
  upsertLocalFolder(f: LocalFolderInput): void {
    this.#db
      .prepare(
        `INSERT INTO local_folders
           (path, product_id, file_count, total_size, status, added_at, scanned_at)
         VALUES (@path, @product_id, @file_count, @total_size, @status, @added_at, @scanned_at)
         ON CONFLICT(path) DO UPDATE SET
           product_id = excluded.product_id,
           file_count = excluded.file_count,
           total_size = excluded.total_size,
           status = excluded.status,
           scanned_at = excluded.scanned_at`,
      )
      .run({
        path: f.path,
        product_id: f.productId,
        file_count: f.fileCount,
        total_size: f.totalSize,
        status: f.status,
        added_at: f.addedAt,
        scanned_at: f.scannedAt,
      });
  }

  listLocalFolders(): LocalFolderRow[] {
    return this.#db
      .prepare("SELECT * FROM local_folders ORDER BY added_at")
      .all() as LocalFolderRow[];
  }

  getLocalFolder(path: string): LocalFolderRow | undefined {
    return this.#db
      .prepare("SELECT * FROM local_folders WHERE path = ?")
      .get(path) as LocalFolderRow | undefined;
  }

  setLocalFolderStatus(path: string, status: "ok" | "missing"): void {
    this.#db
      .prepare("UPDATE local_folders SET status = ? WHERE path = ?")
      .run(status, path);
  }

  deleteLocalFolder(path: string): void {
    this.#db.prepare("DELETE FROM local_folders WHERE path = ?").run(path);
  }
}
