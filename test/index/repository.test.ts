import { describe, it, expect } from "vitest";
import { searchFiles } from "../../src/index/search.js";
import {
  catalogProduct,
  indexedProduct,
  memoryRepo,
} from "../helpers/db.js";

describe("Repository", () => {
  it("imports a catalog as shallow/online product rows", () => {
    const repo = memoryRepo();
    const n = repo.importCatalog(
      [
        catalogProduct({ id: "1", name: "A" }),
        catalogProduct({ id: "2", name: "B" }),
      ],
      100,
    );
    expect(n).toBe(2);
    const stats = repo.stats();
    expect(stats.products).toBe(2);
    expect(stats.onlineProducts).toBe(2);
    expect(stats.deepProducts).toBe(0);

    const row = repo.getProduct("1")!;
    expect(row.coverage).toBe("shallow");
    expect(row.source).toBe("online");
    expect(row.store_url).toContain("/packages/slug/1");
  });

  it("catalog re-import preserves an existing deep index", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1", name: "Old Name" }),
        source: "local",
        localPath: "/cache/x.unitypackage",
        paths: ["X/click.wav"],
      }),
      1,
    );
    // Re-importing the catalog must update name but not clobber files/coverage.
    repo.importCatalog([catalogProduct({ id: "1", name: "New Name" })], 2);

    const row = repo.getProduct("1")!;
    expect(row.name).toBe("New Name");
    expect(row.coverage).toBe("deep");
    expect(row.source).toBe("local");
    expect(row.local_path).toBe("/cache/x.unitypackage");
    expect(repo.stats().files).toBe(1);
  });

  it("writeIndexedProduct replaces files (last-write-wins)", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1" }),
        paths: ["a/one.wav", "a/two.wav"],
      }),
      1,
    );
    expect(repo.stats().files).toBe(2);

    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1" }),
        paths: ["a/three.wav"],
      }),
      2,
    );
    expect(repo.stats().files).toBe(1);
    expect(searchFiles(repo.db, "two")).toHaveLength(0);
    expect(searchFiles(repo.db, "three")).toHaveLength(1);
  });

  it("enrichProduct makes new keywords searchable", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1", name: "Generic Pack" }),
        paths: ["Generic/asset_001.fbx"],
      }),
      1,
    );
    // Before keywords are fetched, "spaceship" matches nothing.
    expect(searchFiles(repo.db, "spaceship")).toHaveLength(0);

    repo.enrichProduct(
      "1",
      { category: "3D/Vehicles", tags: ["spaceship", "sci-fi"] },
      2,
    );

    const hits = searchFiles(repo.db, "spaceship");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fullPath).toBe("Generic/asset_001.fbx");
    expect(repo.getProduct("1")!.category).toBe("3D/Vehicles");
  });

  it("getFile joins product action fields", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "p1", productId: "kh1" }),
        source: "local",
        localPath: "/cache/p1.unitypackage",
        paths: ["p1/click.wav"],
      }),
      1,
    );
    const hit = searchFiles(repo.db, "click")[0]!;
    const file = repo.getFile(hit.fileId)!;
    expect(file.full_path).toBe("p1/click.wav");
    expect(file.local_path).toBe("/cache/p1.unitypackage");
    expect(file.kharma_id).toBe("kh1");
    expect(file.store_url).toContain("/packages/slug/p1");
  });

  it("tracks scanned packages for incremental rescans", () => {
    const repo = memoryRepo();
    expect(repo.getScannedPackage("/c/a.unitypackage")).toBeUndefined();
    repo.recordScannedPackage("/c/a.unitypackage", 555, 9999, "1", 10);
    const rec = repo.getScannedPackage("/c/a.unitypackage")!;
    expect(rec).toMatchObject({ mtime_ms: 555, size: 9999, product_id: "1" });
  });

  it("preserves nested_pkg provenance on files", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1" }),
        isWrapper: true,
        files: [
          {
            fullPath: "Toon/URP/Temple.fbx",
            fileName: "Temple.fbx",
            ext: "fbx",
            typeBucket: "model",
            nestedPkg: "URP_pack.unitypackage",
            source: "local",
          },
        ],
      }),
      1,
    );
    const hit = searchFiles(repo.db, "Temple")[0]!;
    expect(repo.getFile(hit.fileId)!.nested_pkg).toBe("URP_pack.unitypackage");
    expect(repo.getProduct("1")!.is_wrapper).toBe(1);
  });
});
