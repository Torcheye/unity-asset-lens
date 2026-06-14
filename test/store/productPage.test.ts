import { describe, it, expect } from "vitest";
import {
  fetchProductMetadata,
  parseProductPage,
} from "../../src/store/productPage.js";
import { mockHttp } from "../helpers/mockHttp.js";

/** A minimal stand-in for the store's "Related keywords" section markup. */
function relatedSection(keywords: string[]): string {
  const anchors = keywords
    .map((k) => `<a href="/?q=${encodeURIComponent(k)}">${k}</a>`)
    .join("");
  return `<h2>Related keywords</h2><div>${anchors}</div><h2>Frequently bought together</h2>`;
}

describe("parseProductPage", () => {
  it("extracts the curated Related keywords section", () => {
    const html = relatedSection(["cityscape", "urban", "lowpoly", "city builder"]);
    expect(parseProductPage(html).keywords).toEqual([
      "cityscape",
      "urban",
      "lowpoly",
      "city builder",
    ]);
  });

  it("ignores /?q= links outside the Related keywords section", () => {
    const html = `
      <a href="/?q=publisher-tag">Some Other Link</a>
      ${relatedSection(["road", "subway"])}
      <a href="/?q=footer-link">Footer</a>
    `;
    expect(parseProductPage(html).keywords).toEqual(["road", "subway"]);
  });

  it("does NOT read <meta name=keywords> (it is just title + category)", () => {
    const html = `<meta name="keywords" content="Low Poly Mega City,3D/Environments/Urban">`;
    expect(parseProductPage(html).keywords).toEqual([]);
  });

  it("extracts category from a JSON-LD BreadcrumbList (drop root + leaf)", () => {
    const ld = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { name: "Home" },
        { name: "Tools" },
        { name: "Network" },
        { name: "Best HTTP Plugin" },
      ],
    };
    const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    expect(parseProductPage(html).category).toBe("Tools/Network");
  });

  it("merges and de-dupes Related keywords with JSON-LD keywords", () => {
    const ld = { "@type": "Product", keywords: ["sci-fi", "spaceship"] };
    const html = `
      ${relatedSection(["sci-fi", "crate", "Spaceship"])}
      <script type="application/ld+json">${JSON.stringify(ld)}</script>
    `;
    const { keywords } = parseProductPage(html);
    expect(keywords).toContain("sci-fi");
    expect(keywords).toContain("crate");
    // "spaceship" appears in both sources but is de-duped case-insensitively.
    expect(keywords.filter((k) => k.toLowerCase() === "spaceship")).toHaveLength(1);
  });

  it("decodes HTML entities in keywords", () => {
    const html = relatedSection(["cars &amp; trucks", "R&amp;D"]);
    expect(parseProductPage(html).keywords).toEqual(["cars & trucks", "R&D"]);
  });

  it("returns empty keywords and no category for bare HTML", () => {
    const result = parseProductPage("<html><body>nothing</body></html>");
    expect(result.keywords).toEqual([]);
    expect(result.category).toBeUndefined();
  });

  it("ignores malformed JSON-LD blocks without throwing", () => {
    const html = `<script type="application/ld+json">{ not json }</script>`;
    expect(() => parseProductPage(html)).not.toThrow();
  });
});

describe("fetchProductMetadata", () => {
  it("GETs the product page and parses it", async () => {
    const { http, calls } = mockHttp([{ body: relatedSection(["audio", "sfx"]) }]);
    const meta = await fetchProductMetadata(http, "555");
    expect(calls[0]!.url).toContain("/packages/slug/555");
    expect(meta.keywords).toEqual(["audio", "sfx"]);
  });

  it("returns empty metadata on a non-ok response", async () => {
    const { http } = mockHttp([{ status: 404 }]);
    expect(await fetchProductMetadata(http, "x")).toEqual({ keywords: [] });
  });
});
