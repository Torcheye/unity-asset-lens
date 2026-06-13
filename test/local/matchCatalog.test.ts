import { describe, it, expect } from "vitest";
import {
  buildCatalogMatcher,
  normalizeKey,
} from "../../src/local/matchCatalog.js";
import { catalogProduct } from "../helpers/db.js";

describe("normalizeKey", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeKey("Best HTTP/2 Plugin!")).toBe("besthttp2plugin");
    expect(normalizeKey("Toon  Deserted_Temples")).toBe("toondesertedtemples");
  });
});

describe("buildCatalogMatcher", () => {
  const products = [
    catalogProduct({ id: "1", name: "Cool SFX Pack", publisher: "Sound Co" }),
    catalogProduct({ id: "2", name: "Crate Models", publisher: "Art Co" }),
    catalogProduct({ id: "3", name: "Crate Models", publisher: "Other Co" }),
  ];
  const matcher = buildCatalogMatcher(products);

  it("matches on publisher + normalised name", () => {
    expect(
      matcher.match({ publisher: "sound co", name: "cool-sfx-pack" })?.id,
    ).toBe("1");
  });

  it("resolves an ambiguous name only when publisher also matches", () => {
    // Two products named "Crate Models" — name alone is ambiguous.
    expect(matcher.match({ publisher: "Unknown", name: "Crate Models" })).toBeUndefined();
    expect(matcher.match({ publisher: "Art Co", name: "Crate Models" })?.id).toBe("2");
  });

  it("falls back to a unique name match across publishers", () => {
    // Publisher folder differs from catalog publisher, but the name is unique.
    expect(
      matcher.match({ publisher: "MismatchedFolder", name: "Cool SFX Pack" })?.id,
    ).toBe("1");
  });

  it("returns undefined for an unknown package", () => {
    expect(matcher.match({ publisher: "X", name: "Nonexistent" })).toBeUndefined();
  });
});
