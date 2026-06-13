import { describe, it, expect } from "vitest";
import { formatResults } from "../../src/cli/format.js";
import type { GroupedSearchResult, SearchHit } from "../../src/domain/types.js";

function hit(over: Partial<SearchHit>): SearchHit {
  return {
    fileId: 1,
    productId: "p",
    productName: "Pack",
    publisher: "Pub",
    fullPath: "Pack/click.wav",
    fileName: "click.wav",
    typeBucket: "audio",
    source: "local",
    coverage: "deep",
    storeUrl: "https://x/p",
    score: -1,
    ...over,
  };
}

describe("formatResults", () => {
  it("reports no results", () => {
    expect(formatResults("ghost", [])).toBe('No results for "ghost".');
  });

  it("lists file hits with ids and a reveal hint for local products", () => {
    const groups: GroupedSearchResult[] = [
      {
        productId: "500",
        productName: "Cool SFX",
        publisher: "Sound Co",
        source: "local",
        coverage: "deep",
        storeUrl: "https://x/500",
        localPath: "/cache/x.unitypackage",
        bestScore: -5,
        totalHits: 1,
        hits: [hit({ fileId: 42, fullPath: "CoolSFX/UI/click.wav" })],
      },
    ];
    const out = formatResults("click", groups);
    expect(out).toContain("1 file across 1 product");
    expect(out).toContain("[42] CoolSFX/UI/click.wav  (audio)");
    expect(out).toContain("reveal: assetlens reveal 42");
  });

  it("shows download hint for online products and a metadata note when file-less", () => {
    const groups: GroupedSearchResult[] = [
      {
        productId: "777",
        productName: "Online Pack",
        publisher: "Pub",
        source: "online",
        coverage: "shallow",
        storeUrl: "https://x/777",
        bestScore: -2,
        totalHits: 0,
        hits: [],
      },
    ];
    const out = formatResults("thing", groups);
    expect(out).toContain("metadata match");
    expect(out).toContain("download: assetlens download 777");
  });

  it("truncates long file lists", () => {
    const hits = Array.from({ length: 10 }, (_, i) =>
      hit({ fileId: i, fullPath: `Pack/f${i}.wav` }),
    );
    const groups: GroupedSearchResult[] = [
      {
        productId: "p",
        productName: "Pack",
        publisher: "Pub",
        source: "local",
        coverage: "deep",
        storeUrl: "https://x/p",
        localPath: "/c/p.unitypackage",
        bestScore: -5,
        totalHits: 10,
        hits,
      },
    ];
    const out = formatResults("f", groups, { maxFilesPerProduct: 3 });
    expect(out).toContain("… 7 more");
  });
});
