import { describe, it, expect } from "vitest";
import {
  fetchProductMetadata,
  parseProductPage,
} from "../../src/store/productPage.js";
import { mockHttp } from "../helpers/mockHttp.js";

describe("parseProductPage", () => {
  it("extracts keywords from a <meta name=keywords> tag", () => {
    const html = `<meta name="keywords" content="Unity HTTP request, networking plugin, REST">`;
    expect(parseProductPage(html).keywords).toEqual([
      "Unity HTTP request",
      "networking plugin",
      "REST",
    ]);
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

  it("merges and de-dupes keywords from meta, JSON-LD and search links", () => {
    const ld = { "@type": "Product", keywords: ["sci-fi", "spaceship"] };
    const html = `
      <meta name="keywords" content="sci-fi, crate">
      <script type="application/ld+json">${JSON.stringify(ld)}</script>
      <a href="/search?q=low%20poly">Low Poly</a>
      <a href="/search?q=spaceship">Spaceship</a>
    `;
    const { keywords } = parseProductPage(html);
    // "sci-fi" appears twice but is de-duped; "spaceship" too (case-insensitive).
    expect(keywords).toContain("sci-fi");
    expect(keywords).toContain("crate");
    expect(keywords).toContain("Low Poly");
    expect(keywords.filter((k) => k.toLowerCase() === "spaceship")).toHaveLength(1);
  });

  it("decodes HTML entities in keywords", () => {
    const html = `<meta name="keywords" content="cars &amp; trucks, R&amp;D">`;
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
    const { http, calls } = mockHttp([
      { body: `<meta name="keywords" content="audio, sfx">` },
    ]);
    const meta = await fetchProductMetadata(http, "555");
    expect(calls[0]!.url).toContain("/packages/slug/555");
    expect(meta.keywords).toEqual(["audio", "sfx"]);
  });

  it("returns empty metadata on a non-ok response", async () => {
    const { http } = mockHttp([{ status: 404 }]);
    expect(await fetchProductMetadata(http, "x")).toEqual({ keywords: [] });
  });
});
