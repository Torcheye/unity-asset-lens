import { describe, it, expect } from "vitest";
import { enrichProducts } from "../../src/online/enrich.js";
import { search } from "../../src/index/search.js";
import { catalogProduct, indexedProduct, memoryRepo } from "../helpers/db.js";
import { mockHttp } from "../helpers/mockHttp.js";

describe("enrichProducts (spec §5.5)", () => {
  it("adds category + keywords and makes them searchable on files", async () => {
    const repo = memoryRepo();
    // Deep-indexed product whose file path is generic.
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1", name: "Vehicle Pack" }),
        source: "local",
        paths: ["VehiclePack/Models/v_001.fbx"],
      }),
      1,
    );

    const { http, calls } = mockHttp([
      { body: `<meta name="keywords" content="spaceship, sci-fi, hover">` },
    ]);
    const result = await enrichProducts(repo, http, { now: 2 });

    expect(result.enriched).toBe(1);
    expect(calls[0]!.url).toContain("/packages/slug/1");
    // The generic .fbx is now found via the enriched keyword.
    const hits = search(repo.db, "spaceship");
    expect(hits[0]!.productId).toBe("1");
  });

  it("only targets products lacking keywords", async () => {
    const repo = memoryRepo();
    repo.importCatalog([catalogProduct({ id: "1", name: "A" })], 1);
    repo.enrichProduct("1", { tags: ["already", "tagged"] }, 1);

    const { http, calls } = mockHttp([{ body: "" }]);
    const result = await enrichProducts(repo, http, { now: 2 });
    expect(result.attempted).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("counts products with no extractable metadata as attempted-not-enriched", async () => {
    const repo = memoryRepo();
    repo.importCatalog([catalogProduct({ id: "1", name: "A" })], 1);
    const { http } = mockHttp([{ body: "<html>nothing useful</html>" }]);
    const result = await enrichProducts(repo, http, { now: 2 });
    expect(result.attempted).toBe(1);
    expect(result.enriched).toBe(0);
  });
});
