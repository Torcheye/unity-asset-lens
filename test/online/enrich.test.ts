import { describe, it, expect } from "vitest";
import { enrichProducts } from "../../src/online/enrich.js";
import { search } from "../../src/index/search.js";
import { catalogProduct, indexedProduct, memoryRepo } from "../helpers/db.js";
import { mockHttp } from "../helpers/mockHttp.js";

/** A minimal stand-in for the store's "Related keywords" section markup. */
function relatedSection(keywords: string[]): string {
  const anchors = keywords
    .map((k) => `<a href="/?q=${encodeURIComponent(k)}">${k}</a>`)
    .join("");
  return `<h2>Related keywords</h2><div>${anchors}</div><h2>More</h2>`;
}

describe("enrichProducts (spec §5.5)", () => {
  it("adds keywords and makes them searchable on files", async () => {
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
      { body: relatedSection(["spaceship", "sci-fi", "hover"]) },
    ]);
    const result = await enrichProducts(repo, http, { now: 2 });

    expect(result.enriched).toBe(1);
    expect(calls[0]!.url).toContain("/packages/slug/1");
    // The generic .fbx is now found via the enriched keyword.
    const hits = search(repo.db, "spaceship");
    expect(hits[0]!.productId).toBe("1");
  });

  it("re-fetches already-tagged products when force is set", async () => {
    const repo = memoryRepo();
    repo.importCatalog([catalogProduct({ id: "1", name: "A" })], 1);
    repo.enrichProduct("1", { tags: ["stale", "title noise"] }, 1);

    const { http, calls } = mockHttp([
      { body: relatedSection(["cityscape", "lowpoly"]) },
    ]);
    const result = await enrichProducts(repo, http, { now: 2, force: true });

    expect(result.attempted).toBe(1);
    expect(calls).toHaveLength(1);
    // Fresh Related keywords are searchable; replaces the stale tags.
    expect(search(repo.db, "cityscape").map((h) => h.productId)).toContain("1");
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
