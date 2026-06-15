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
});
