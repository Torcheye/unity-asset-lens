import { describe, it, expect } from "vitest";
import {
  buildMatchQuery,
  search,
  searchFiles,
} from "../../src/index/search.js";
import {
  catalogProduct,
  indexedProduct,
  memoryRepo,
} from "../helpers/db.js";

describe("buildMatchQuery", () => {
  it("quotes terms and adds prefix wildcards", () => {
    expect(buildMatchQuery("ui click")).toBe('"ui"* "click"*');
  });

  it("de-dupes terms case-insensitively", () => {
    expect(buildMatchQuery("Click click CLICK")).toBe('"Click"*');
  });

  it("drops punctuation-only tokens but keeps the rest", () => {
    expect(buildMatchQuery("sci-fi !! crate")).toBe('"sci-fi"* "crate"*');
  });

  it("escapes embedded double quotes", () => {
    expect(buildMatchQuery('say"hi')).toBe('"say""hi"*');
  });

  it("returns null for empty / whitespace / punctuation-only input", () => {
    expect(buildMatchQuery("   ")).toBeNull();
    expect(buildMatchQuery("!!! ???")).toBeNull();
  });
});

describe("search ranking and matching", () => {
  it("matches on file path and on product metadata (spec §7)", () => {
    const repo = memoryRepo();
    const now = 1_000;
    // A generic-named fbx whose pack metadata says "sci-fi".
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1", name: "Crate Pack" }),
        category: "3D/Props",
        tags: ["sci-fi", "spaceship", "container"],
        paths: ["CratePack/Models/box_a.fbx"],
      }),
      now,
    );

    // "sci-fi crate" should hit the fbx via metadata even though the path is generic.
    const hits = searchFiles(repo.db, "sci-fi crate");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fullPath).toBe("CratePack/Models/box_a.fbx");
  });

  it("ranks exact filename hits above metadata-only hits", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "name", name: "Audio Pack" }),
        paths: ["Audio/UI/click.wav"], // filename literally "click"
      }),
      1,
    );
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "meta", name: "Click Sounds Bundle" }),
        tags: ["click", "ui"],
        paths: ["Bundle/Sounds/sound_042.wav"], // only metadata mentions click
      }),
      1,
    );

    const hits = searchFiles(repo.db, "click");
    expect(hits[0]!.productId).toBe("name");
  });

  it("boosts local products over online ones (spec §7)", () => {
    const repo = memoryRepo();
    // Identical matching filename; one product local, one online.
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "online", name: "Pack A" }),
        source: "online",
        paths: ["A/click.wav"],
      }),
      1,
    );
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "local", name: "Pack B" }),
        source: "local",
        localPath: "/cache/B.unitypackage",
        paths: ["B/click.wav"],
      }),
      1,
    );

    const hits = searchFiles(repo.db, "click");
    expect(hits[0]!.productId).toBe("local");
    expect(hits[0]!.localPath).toBe("/cache/B.unitypackage");
  });

  it("applies type-bucket, local-only, and publisher filters", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1", name: "Mix", publisher: "Pub X" }),
        source: "local",
        paths: ["Mix/click.wav", "Mix/click_button.prefab"],
      }),
      1,
    );
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "2", name: "Online", publisher: "Pub Y" }),
        source: "online",
        paths: ["Online/click.wav"],
      }),
      1,
    );

    expect(searchFiles(repo.db, "click", { typeBucket: "audio" }).every((h) => h.typeBucket === "audio")).toBe(true);
    expect(searchFiles(repo.db, "click", { localOnly: true }).every((h) => h.source === "local")).toBe(true);
    const byPub = searchFiles(repo.db, "click", { publisher: "Pub Y" });
    expect(byPub).toHaveLength(1);
    expect(byPub[0]!.productId).toBe("2");
  });

  it("groups hits by product, best-first (spec §7)", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "big", name: "Mega Bundle" }),
        source: "local",
        paths: ["Mega/click_1.wav", "Mega/click_2.wav", "Mega/click_3.wav"],
      }),
      1,
    );

    const groups = search(repo.db, "click");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.productId).toBe("big");
    expect(groups[0]!.totalHits).toBe(3);
    expect(groups[0]!.hits).toHaveLength(3);
  });

  it("returns nothing for an empty query", () => {
    const repo = memoryRepo();
    repo.writeIndexedProduct(
      indexedProduct({
        product: catalogProduct({ id: "1" }),
        paths: ["x/click.wav"],
      }),
      1,
    );
    expect(searchFiles(repo.db, "   ")).toEqual([]);
  });
});
