import { describe, it, expect } from "vitest";
import {
  parseMyAssets,
  parseMyAssetsText,
} from "../../src/catalog/parseMyAssets.js";

describe("parseMyAssets", () => {
  it("parses a bare array of product nodes", () => {
    const { products, skipped } = parseMyAssets([
      {
        id: "100",
        productId: "p100",
        name: "Cool SFX",
        publisher: { name: "Sound Co" },
        downloadSize: 1234,
        currentVersion: { name: "1.2.0", publishedDate: "2024-01-01" },
      },
    ]);
    expect(skipped).toBe(0);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: "100",
      productId: "p100",
      name: "Cool SFX",
      publisher: "Sound Co",
      downloadSize: 1234,
      version: "1.2.0",
      publishedDate: "2024-01-01",
      isHidden: false,
    });
  });

  it("parses the raw graphql/batch response shape", () => {
    const batch = [
      {
        data: {
          ownedProducts: {
            results: [
              { id: "1", name: "A", publisher: { name: "P" } },
              { id: "2", name: "B", publisher: { name: "P" } },
            ],
          },
        },
      },
    ];
    const { products } = parseMyAssets(batch);
    expect(products.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("parses a { results: [...] } wrapper", () => {
    const { products } = parseMyAssets({
      results: [{ id: "9", name: "Z", publisher: "Solo Dev" }],
    });
    expect(products[0]!.publisher).toBe("Solo Dev");
  });

  it("flags hidden/archived assets via the #BIN tag", () => {
    const { products } = parseMyAssets([
      { id: "1", name: "vis", publisher: { name: "p" } },
      { id: "2", name: "hid", publisher: { name: "p" }, tagging: ["#BIN"] },
      { id: "3", name: "exp", publisher: { name: "p" }, isHidden: true },
    ]);
    expect(products.find((p) => p.id === "1")!.isHidden).toBe(false);
    expect(products.find((p) => p.id === "2")!.isHidden).toBe(true);
    expect(products.find((p) => p.id === "3")!.isHidden).toBe(true);
  });

  it("de-dupes by id across pages and skips id-less nodes", () => {
    const { products, skipped } = parseMyAssets([
      { id: "1", name: "A", publisher: { name: "p" } },
      { id: "1", name: "A dup", publisher: { name: "p" } },
      { name: "no id", publisher: { name: "p" } },
    ]);
    expect(products).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("falls back to productId when id is absent", () => {
    const { products } = parseMyAssets([
      { productId: "abc", name: "X", publisher: { name: "p" } },
    ]);
    expect(products[0]!.id).toBe("abc");
  });

  it("derives a placeholder name when missing", () => {
    const { products } = parseMyAssets([{ id: "42", publisher: { name: "p" } }]);
    expect(products[0]!.name).toBe("Product 42");
  });
});

describe("parseMyAssetsText", () => {
  it("throws a helpful error on invalid JSON", () => {
    expect(() => parseMyAssetsText("{not json")).toThrow(/not valid JSON/);
  });

  it("parses valid JSON text", () => {
    const { products } = parseMyAssetsText(
      JSON.stringify([{ id: "5", name: "Five", publisher: "P" }]),
    );
    expect(products[0]!.id).toBe("5");
  });
});
