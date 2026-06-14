import { h } from "../dom.js";
import { MONO, badgeStyle, pillStyle } from "../theme.js";
import { bucketIcon } from "../icon.js";
import { highlightPath, tokenize } from "../format.js";

const MAX_HITS = 8;

function marker(source) {
  return source === "local"
    ? { width: "8px", height: "8px", borderRadius: "50%", background: "#46d9a0", flexShrink: 0 }
    : { width: "8px", height: "8px", borderRadius: "50%", background: "transparent", border: "1.5px solid #5a5a64", flexShrink: 0 };
}

function actionButton(label, onClick, variant) {
  const styles = {
    reveal: { color: "#a9c4ff", background: "rgba(122,162,255,0.13)", border: "1px solid rgba(122,162,255,0.28)" },
    download: { color: "#fff", background: "#3a63d6", border: "1px solid #3a63d6" },
    store: { color: "#b7b7c1", background: "transparent", border: "1px solid #33333b" },
  }[variant];
  const hover = {
    reveal: { background: "rgba(122,162,255,0.2)" },
    download: { background: "#4a72e6" },
    store: { background: "#26262d", borderColor: "#3d3d46" },
  }[variant];
  return h(
    "button",
    { onClick, style: { padding: "5px 11px", fontSize: "0.75rem", fontWeight: variant === "store" ? 500 : 600, borderRadius: "7px", cursor: "pointer", ...styles }, hover },
    label,
  );
}

function hitRow(hit, terms) {
  return h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: "10px", padding: "6px 14px", borderTop: "1px solid #1f1f25" }, hover: { background: "#212128" } },
    h("span", { style: { fontFamily: MONO, fontSize: "0.6875rem", color: "#5f5f6a", minWidth: "42px" } }, `[${hit.fileId}]`),
    h("span", { style: { fontFamily: MONO, fontSize: "0.7813rem", letterSpacing: "-0.1px", flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, ...highlightPath(hit.fullPath, terms)),
    h(
      "span",
      { style: { ...pillStyle(hit.typeBucket), display: "inline-flex", alignItems: "center", gap: "4px" } },
      bucketIcon(hit.typeBucket, 12),
      hit.typeBucket,
    ),
  );
}

function group(g, terms, actions) {
  const isMeta = g.totalHits === 0;
  const sb = g.source === "local" ? ["local", "#46d9a0", "rgba(70,217,160,0.12)"] : ["online", "#8f8f9b", "rgba(143,143,155,0.12)"];
  const cb = g.coverage === "deep" ? ["deep", "#7aa2ff", "rgba(122,162,255,0.10)"] : ["shallow", "#ffb05c", "rgba(255,176,92,0.12)"];
  const shown = g.hits.slice(0, MAX_HITS);
  const moreCount = g.hits.length - shown.length;

  const buttons = [];
  if (g.source === "local") buttons.push(actionButton("Reveal", () => actions.runAction("reveal", g.productId), "reveal"));
  else buttons.push(actionButton("Download", () => actions.runAction("download", g.productId), "download"));
  buttons.push(actionButton("Store ↗", () => actions.runAction("open", g.productId), "store"));

  const children = [
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "11px", padding: "11px 14px" } },
      h("span", { style: marker(g.source) }),
      h(
        "div",
        { style: { minWidth: 0, flex: "1" } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
          h("span", { style: { fontSize: "0.875rem", fontWeight: 600, color: "#ededf1" } }, g.productName),
          h("span", { style: badgeStyle(sb[1], sb[2]) }, sb[0]),
          h("span", { style: badgeStyle(cb[1], cb[2]) }, cb[0]),
        ),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "7px", marginTop: "3px", fontSize: "0.75rem", color: "#83838f" } },
          h("span", {}, g.publisher),
          h("span", { style: { color: "#44444c" } }, "·"),
          h("span", {}, isMeta ? "metadata match" : `${g.totalHits} file${g.totalHits === 1 ? "" : "s"}`),
        ),
      ),
      h("div", { style: { display: "flex", gap: "7px", flexShrink: 0 } }, ...buttons),
    ),
  ];

  if (isMeta) {
    children.push(
      h(
        "div",
        { style: { padding: "9px 14px", borderTop: "1px solid #232329", background: "#191920", display: "flex", gap: "9px", alignItems: "center", fontSize: "0.75rem", color: "#8a8a96", lineHeight: "1.5" } },
        h("span", { style: { color: "#ffb05c", flexShrink: 0 } }, "◇"),
        g.coverage === "shallow"
          ? "Not deep-indexed yet — fetch its file tree or download to list its files."
          : "Matched on product metadata; no individual files matched this query.",
      ),
    );
  } else {
    const rows = shown.map((hgrp) => hitRow(hgrp, terms));
    if (moreCount > 0) {
      rows.push(
        h("div", { style: { padding: "7px 14px", borderTop: "1px solid #1f1f25", fontSize: "0.75rem", color: "#6b6b76", fontFamily: MONO } }, `… ${moreCount} more file${moreCount === 1 ? "" : "s"} in this package`),
      );
    }
    children.push(h("div", { style: { borderTop: "1px solid #232329" } }, ...rows));
  }

  return h("div", { style: { background: "#1d1d22", border: "1px solid #2a2a31", borderRadius: "10px", overflow: "hidden" } }, ...children);
}

export function ResultsView(state, actions) {
  const results = state.results;
  const terms = tokenize(state.query);

  if (state.searchError) {
    return h("div", { style: { textAlign: "center", padding: "70px 20px", color: "#ff8f6b" } }, state.searchError);
  }
  if (!results || results.groups.length === 0) {
    return h(
      "div",
      { style: { textAlign: "center", padding: "70px 20px", color: "#7a7a85" } },
      h("div", { style: { fontSize: "0.9375rem", color: "#c7c7d0", marginBottom: "7px" } }, `No matches for "${state.query}"`),
      h("div", { style: { fontSize: "0.8125rem" } }, "Try fewer or broader keywords, or clear the type filter."),
    );
  }
  return h("div", { style: { display: "flex", flexDirection: "column", gap: "11px" } }, ...results.groups.map((g) => group(g, terms, actions)));
}
