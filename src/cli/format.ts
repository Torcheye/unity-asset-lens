import type { GroupedSearchResult } from "../domain/types.js";

/**
 * Human-readable formatting of grouped search results for the terminal
 * (spec §7: group by product, show file type, indicate local vs online, and
 * surface the actionable command per hit). Pure: returns a string.
 */

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatResults(
  query: string,
  groups: readonly GroupedSearchResult[],
  opts: { maxFilesPerProduct?: number } = {},
): string {
  const maxFiles = opts.maxFilesPerProduct ?? 8;
  if (groups.length === 0) {
    return `No results for "${query}".`;
  }

  const totalHits = groups.reduce((n, g) => n + g.totalHits, 0);
  const lines: string[] = [
    `${pluralize(totalHits, "file")} across ${pluralize(groups.length, "product")} for "${query}"`,
    "",
  ];

  for (const g of groups) {
    const marker = g.source === "local" ? "●" : "○";
    lines.push(
      `${marker} ${g.productName} — ${g.publisher}  [${g.source}, ${g.coverage}]`,
    );
    if (g.totalHits === 0) {
      // Product-level metadata match with no deep-indexed files yet (spec §4).
      lines.push("   (metadata match — not deep-indexed; fetch or download to list files)");
    }
    const shown = g.hits.slice(0, maxFiles);
    for (const hit of shown) {
      lines.push(`   [${hit.fileId}] ${hit.fullPath}  (${hit.typeBucket})`);
    }
    if (g.hits.length > shown.length) {
      lines.push(`   … ${g.hits.length - shown.length} more`);
    }
    // Action hints (spec §7).
    if (g.source === "local" && g.localPath) {
      const firstId = g.hits[0]?.fileId;
      lines.push(`   ↳ reveal: assetlens reveal ${firstId}`);
    } else {
      lines.push(
        `   ↳ open: assetlens open ${g.productId}   download: assetlens download ${g.productId}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
