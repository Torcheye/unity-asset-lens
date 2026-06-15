import { describe, it, expect } from "vitest";
import { memoryRepo, indexedProduct, catalogProduct } from "../helpers/db.js";
import { searchFiles, searchProducts } from "../../src/index/search.js";

function folderProduct(repo: ReturnType<typeof memoryRepo>, id: string, publisher: string, paths: string[]) {
  repo.writeIndexedProduct(
    indexedProduct({
      product: catalogProduct({ id, name: id, publisher }),
      paths,
      source: "local",
      storeUrl: "",
    }),
    1,
  );
}

describe("local_folders registry", () => {
  it("upserts, lists, gets, updates status, and deletes", () => {
    const repo = memoryRepo();
    repo.upsertLocalFolder({ path: "/a", productId: "folder:/a", fileCount: 3, totalSize: 30, status: "ok", addedAt: 1, scannedAt: 1 });
    repo.upsertLocalFolder({ path: "/b", productId: "folder:/b", fileCount: 1, totalSize: 10, status: "ok", addedAt: 2, scannedAt: 2 });

    expect(repo.listLocalFolders().map((r) => r.path)).toEqual(["/a", "/b"]);
    expect(repo.getLocalFolder("/a")!.file_count).toBe(3);

    // Re-upsert keeps the original added_at, refreshes the rest.
    repo.upsertLocalFolder({ path: "/a", productId: "folder:/a", fileCount: 5, totalSize: 50, status: "ok", addedAt: 999, scannedAt: 9 });
    const a = repo.getLocalFolder("/a")!;
    expect(a.added_at).toBe(1);
    expect(a.file_count).toBe(5);
    expect(a.scanned_at).toBe(9);

    repo.setLocalFolderStatus("/b", "missing");
    expect(repo.getLocalFolder("/b")!.status).toBe("missing");

    repo.deleteLocalFolder("/a");
    expect(repo.getLocalFolder("/a")).toBeUndefined();
    expect(repo.listLocalFolders().map((r) => r.path)).toEqual(["/b"]);
  });

  it("deleteProductCascade removes the product, its files, and FTS rows", () => {
    const repo = memoryRepo();
    folderProduct(repo, "folder:/x", "/x", ["/x/a.wav", "/x/b.wav"]);
    expect(searchFiles(repo.db, "a")).toHaveLength(1);

    repo.deleteProductCascade("folder:/x");
    expect(repo.getProduct("folder:/x")).toBeUndefined();
    expect(searchFiles(repo.db, "a")).toHaveLength(0);
    expect(searchProducts(repo.db, "x")).toHaveLength(0); // products_fts cleared
  });

  it("excludes folder: products from listCatalogProducts and listPublishers", () => {
    const repo = memoryRepo();
    repo.importCatalog([catalogProduct({ id: "100", name: "Real", publisher: "RealPub" })], 1);
    folderProduct(repo, "folder:/f", "/f", ["/f/x.txt"]);

    expect(repo.listCatalogProducts().map((p) => p.id)).toEqual(["100"]);
    expect(repo.listPublishers()).toEqual(["RealPub"]); // "/f" path not listed
  });

  it("excludes folder:/local: products from the keyword-enrich queue", () => {
    const repo = memoryRepo();
    // A real owned product with no keywords -> belongs in the queue.
    repo.importCatalog([catalogProduct({ id: "100", name: "Real", publisher: "RealPub" })], 1);
    // Synthetic products whose ids must never be sent to the store.
    folderProduct(repo, "folder:/Users/bob/Secret", "/Users/bob/Secret", ["/Users/bob/Secret/x.wav"]);
    folderProduct(repo, "local:pub/slug", "pub", ["/cache/pub/slug/y.wav"]);

    expect(repo.listProductsToEnrich()).toEqual(["100"]);
    // Even a forced re-enrich must not pick up the synthetic ids.
    expect(repo.listProductsToEnrich(undefined, true)).toEqual(["100"]);
  });

  it("does not surface a folder as a product-only hit, but its files are searchable", () => {
    const repo = memoryRepo();
    // Folder path contains the token "users"; without the fix the path-as-
    // publisher would match the product-only pass and float to the top.
    folderProduct(repo, "folder:/Users/Assets", "/Users/Assets", ["/Users/Assets/crate.fbx"]);

    expect(searchProducts(repo.db, "users")).toHaveLength(0);
    // The real files are still found at the file level.
    expect(searchFiles(repo.db, "crate")).toHaveLength(1);
  });

  it("excludes folder products from the library snapshot stats", () => {
    const repo = memoryRepo();
    repo.importCatalog([catalogProduct({ id: "100", name: "Real", publisher: "RealPub" })], 1);
    folderProduct(repo, "folder:/f", "/f", ["/f/a.wav", "/f/b.wav"]);

    const stats = repo.stats();
    expect(stats.products).toBe(1); // folder not counted as an owned product
    expect(stats.files).toBe(0); // folder files not counted as cache "files indexed"
    expect(stats.localProducts).toBe(0);
    expect(stats.deepProducts).toBe(0);
  });
});
