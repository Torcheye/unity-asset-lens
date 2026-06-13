import { describe, it, expect } from "vitest";
import { search, searchProducts } from "../../src/index/search.js";
import { catalogProduct, indexedProduct, memoryRepo } from "../helpers/db.js";

describe("product-level metadata search (spec §4, §7)", () => {
  it("finds an owned product by name before it has any files", () => {
    const repo = memoryRepo();
    repo.importCatalog(
      [catalogProduct({ id: "1", name: "Sci-Fi Spaceship Pack", publisher: "Acme" })],
      1,
    );

    const groups = searchProducts(repo.db, "spaceship");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.productId).toBe("1");
    expect(groups[0]!.totalHits).toBe(0); // metadata-only, no files yet
  });

  it("finds a product by enriched keywords with no files", () => {
    const repo = memoryRepo();
    repo.importCatalog([catalogProduct({ id: "1", name: "Generic Bundle" })], 1);
    repo.enrichProduct("1", { tags: ["medieval", "castle"] }, 2);

    expect(searchProducts(repo.db, "castle")[0]!.productId).toBe("1");
  });

  it("combined search() prefers file hits but includes file-less products", () => {
    const repo = memoryRepo();
    // Product A: deep-indexed with a matching file.
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "A", name: "Castle Audio" }),
        source: "local",
        paths: ["Castle/door.wav"],
      }),
      1,
    );
    // Product B: catalog-only, matches by name, no files.
    repo.importCatalog([catalogProduct({ id: "B", name: "Castle Models" })], 1);

    const groups = search(repo.db, "castle");
    const ids = groups.map((g) => g.productId);
    expect(ids).toContain("A");
    expect(ids).toContain("B");
    const a = groups.find((g) => g.productId === "A")!;
    const b = groups.find((g) => g.productId === "B")!;
    expect(a.totalHits).toBeGreaterThan(0);
    expect(b.totalHits).toBe(0);
  });

  it("does not duplicate a product that already has file hits", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "A", name: "Castle Pack" }),
        source: "local",
        paths: ["Castle/castle_wall.fbx"],
      }),
      1,
    );
    const groups = search(repo.db, "castle");
    expect(groups.filter((g) => g.productId === "A")).toHaveLength(1);
  });

  it("a type-bucket filter suppresses product-level (file-less) hits", () => {
    const repo = memoryRepo();
    repo.importCatalog([catalogProduct({ id: "B", name: "Castle Models" })], 1);
    expect(search(repo.db, "castle", { typeBucket: "audio" })).toHaveLength(0);
  });
});
