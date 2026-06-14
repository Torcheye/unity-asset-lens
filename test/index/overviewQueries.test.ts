import { describe, it, expect } from "vitest";
import { catalogProduct, indexedProduct, memoryRepo } from "../helpers/db.js";

describe("Repository overview queries", () => {
  it("counts indexed files by type bucket, best-first", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1" }),
        paths: ["A/a.wav", "A/b.wav", "A/c.png", "A/Script.cs"],
      }),
      1,
    );
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "2" }),
        paths: ["B/x.wav"],
      }),
      1,
    );

    const counts = repo.typeBucketCounts();
    const map = Object.fromEntries(counts.map((c) => [c.bucket, c.count]));
    expect(map.audio).toBe(3);
    expect(map.texture).toBe(1);
    expect(map.script).toBe(1);
    // Best-first ordering: audio (3) leads.
    expect(counts[0]).toEqual({ bucket: "audio", count: 3 });
  });

  it("returns an empty bucket list when nothing is indexed", () => {
    expect(memoryRepo().typeBucketCounts()).toEqual([]);
  });

  it("tallies enrichment keywords case-insensitively, best-first and capped", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({ product: catalogProduct({ id: "1" }), tags: ["UI", "click", "Sci-Fi"], paths: ["A/a.wav"] }),
      1,
    );
    repo.writeIndexedProduct(
      indexedProduct({ product: catalogProduct({ id: "2" }), tags: ["ui", "menu"], paths: ["B/b.wav"] }),
      1,
    );

    const top = repo.topKeywords(10);
    const map = Object.fromEntries(top.map((k) => [k.keyword, k.count]));
    expect(map.ui).toBe(2); // "UI" + "ui" folded together
    expect(map.click).toBe(1);
    expect(map.menu).toBe(1);
    expect(top[0]).toEqual({ keyword: "ui", count: 2 });

    expect(repo.topKeywords(2).length).toBe(2);
    expect(repo.topKeywords(0)).toEqual([]);
  });
});
