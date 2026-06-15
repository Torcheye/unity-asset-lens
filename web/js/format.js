// Text helpers ported from the design: tokenise a query and render a file path
// with the matching prefixes highlighted.
import { h } from "./dom.js";

export function tokenize(str) {
  return String(str).toLowerCase().match(/[a-z0-9]+/g) || [];
}

/**
 * Render a path with query terms highlighted. Splits on word boundaries so the
 * separators (slashes, dots, underscores) stay dimmed and any segment that
 * starts with a search term is emphasised — same rule as the FTS prefix match.
 */
export function highlightPath(path, terms) {
  const parts = String(path).split(/([A-Za-z0-9]+)/);
  const spans = [];
  parts.forEach((seg) => {
    if (seg === "") return;
    const low = seg.toLowerCase();
    if (/^[a-z0-9]+$/.test(low)) {
      const match = terms.some((t) => low.startsWith(t));
      spans.push(
        h(
          "span",
          {
            style: match
              ? { color: "#bcd0ff", background: "rgba(122,162,255,0.18)", borderRadius: "3px", padding: "0 1px" }
              : { color: "#c4c4cd" },
          },
          seg,
        ),
      );
    } else {
      spans.push(h("span", { style: { color: "#5a5a64" } }, seg));
    }
  });
  return spans;
}

export function formatInt(n) {
  return Number(n || 0).toLocaleString();
}

/** Human-readable byte size, e.g. 1536 → "1.5 KB", 0 → "0 B". */
export function formatBytes(n) {
  const bytes = Number(n || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
