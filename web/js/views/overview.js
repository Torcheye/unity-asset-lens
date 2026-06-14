import { h, s } from "../dom.js";
import { MONO, colorForBucket } from "../theme.js";
import { formatInt } from "../format.js";

function sectionLabel(text, marginTop) {
  return h(
    "div",
    { style: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.7px", color: "#6a6a74", margin: marginTop ? `${marginTop} 0 11px` : "0 0 11px" } },
    text,
  );
}

function statTiles(stats) {
  const s2 = stats || { products: 0, files: 0, localProducts: 0, onlineProducts: 0 };
  const tiles = [
    { value: formatInt(s2.products), label: "Products owned" },
    { value: formatInt(s2.files), label: "Files indexed" },
    { value: formatInt(s2.localProducts), label: "Local packages" },
    { value: formatInt(s2.onlineProducts), label: "Online-only" },
  ];
  return h(
    "div",
    { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" } },
    ...tiles.map((t) =>
      h(
        "div",
        { style: { background: "#1c1c21", border: "1px solid #2a2a31", borderRadius: "10px", padding: "13px 15px" } },
        h("div", { style: { fontSize: "22px", fontWeight: 700, color: "#ededf1", letterSpacing: "-0.5px" } }, t.value),
        h("div", { style: { fontSize: "11.5px", color: "#83838f", marginTop: "2px" } }, t.label),
      ),
    ),
  );
}

function donut(buckets) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const R = 54, CX = 70, CY = 70, CIRC = 2 * Math.PI * R;
  let off = 0;
  const segs = [];
  for (const b of buckets) {
    const frac = total ? b.count / total : 0;
    const len = frac * CIRC;
    segs.push(
      s("circle", {
        cx: CX, cy: CY, r: R, fill: "none", stroke: colorForBucket(b.bucket), "stroke-width": "20",
        "stroke-dasharray": `${len.toFixed(2)} ${(CIRC - len).toFixed(2)}`,
        "stroke-dashoffset": (-off).toFixed(2),
        transform: `rotate(-90 ${CX} ${CY})`, "stroke-linecap": "butt",
      }),
    );
    off += len;
  }
  return s(
    "svg",
    { width: "130", height: "130", viewBox: "0 0 140 140" },
    s("circle", { cx: CX, cy: CY, r: R, fill: "none", stroke: "#232329", "stroke-width": "20" }),
    ...segs,
    s("text", { x: "70", y: "65", "text-anchor": "middle", fill: "#ededf1", "font-size": "21", "font-weight": "700", "font-family": "'IBM Plex Sans',sans-serif" }, formatInt(total)),
    s("text", { x: "70", y: "83", "text-anchor": "middle", fill: "#83838f", "font-size": "10.5", "font-family": MONO }, "indexed"),
  );
}

function assetTypesCard(buckets, actions) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const legend = buckets.map((b) =>
    h(
      "button",
      { onClick: () => actions.setType(b.bucket), style: { display: "flex", alignItems: "center", gap: "8px", padding: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%" } },
      h("span", { style: { width: "9px", height: "9px", borderRadius: "2px", background: colorForBucket(b.bucket), flexShrink: 0 } }),
      h("span", { style: { fontSize: "12px", color: "#c4c4cd", textTransform: "capitalize" } }, b.bucket),
      h("span", { style: { flex: "1" } }),
      h("span", { style: { fontSize: "11.5px", color: "#7a7a85", fontFamily: MONO } }, `${total ? Math.round((b.count / total) * 100) : 0}%`),
    ),
  );
  return h(
    "div",
    { style: { background: "#1c1c21", border: "1px solid #2a2a31", borderRadius: "10px", padding: "16px 17px" } },
    h("div", { style: { fontSize: "12.5px", fontWeight: 600, color: "#d4d4dc", marginBottom: "14px" } }, "Asset types"),
    buckets.length === 0
      ? h("div", { style: { fontSize: "12.5px", color: "#6b6b76" } }, "No files indexed yet.")
      : h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "18px" } },
          h("div", { style: { flexShrink: 0, lineHeight: 0 } }, donut(buckets)),
          h("div", { style: { flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" } }, ...legend),
        ),
  );
}

function keywordCloud(keywords, actions) {
  const counts = keywords.map((k) => k.count);
  const maxK = Math.max(...counts, 1);
  const minK = Math.min(...counts, 1);
  const words = keywords.map((k) => {
    const t = maxK > minK ? (k.count - minK) / (maxK - minK) : 0.5;
    const size = 12 + t * 15;
    const col = t > 0.66 ? "#cdd9ff" : t > 0.33 ? "#a9a9b8" : "#7a7a85";
    return h(
      "button",
      {
        onClick: () => actions.setQuery(k.keyword),
        style: {
          fontFamily: MONO, fontSize: size.toFixed(1) + "px", lineHeight: "1.05",
          fontWeight: t > 0.5 ? 600 : 400, color: col, background: "none",
          border: "1px solid transparent", borderRadius: "7px", padding: "3px 8px",
          margin: "-3px 0", cursor: "pointer", display: "inline-block",
          transition: "transform .13s cubic-bezier(.2,.8,.2,1), color .13s ease, background .13s ease, border-color .13s ease",
        },
        hover: { color: "#ffffff", background: "rgba(122,162,255,0.16)", borderColor: "rgba(122,162,255,0.4)", transform: "scale(1.14)" },
      },
      k.keyword,
    );
  });
  return h(
    "div",
    { style: { background: "#1c1c21", border: "1px solid #2a2a31", borderRadius: "10px", padding: "16px 17px" } },
    h("div", { style: { fontSize: "12.5px", fontWeight: 600, color: "#d4d4dc", marginBottom: "14px" } }, "Frequent keywords"),
    keywords.length === 0
      ? h("div", { style: { fontSize: "12.5px", color: "#6b6b76" } }, "Keywords are collected from store pages when you import your catalog.")
      : h("div", { style: { display: "flex", flexWrap: "wrap", gap: "7px 13px", alignItems: "baseline" } }, ...words),
  );
}

function recentSearches(state, actions) {
  if (state.history.length === 0) {
    return h("div", { style: { fontSize: "13px", color: "#6b6b76", padding: "5px 0 2px" } }, "No recent searches yet — searches you run will collect here.");
  }
  return h(
    "div",
    { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
    ...state.history.map((q) =>
      h(
        "div",
        { style: { display: "inline-flex", alignItems: "stretch", background: "#1c1c21", border: "1px solid #2a2a31", borderRadius: "8px", overflow: "hidden" }, hover: { borderColor: "#3a63d6" } },
        h(
          "button",
          { onClick: () => actions.setQuery(q), style: { display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 5px 8px 12px", fontSize: "13px", color: "#c7c7d0", background: "transparent", border: "none", cursor: "pointer", fontFamily: MONO } },
          h("span", { style: { color: "#5b8cff" } }, "↳"),
          q,
        ),
        h(
          "button",
          { onClick: () => actions.removeHistory(q), title: "Remove from history", style: { display: "flex", alignItems: "center", justifyContent: "center", width: "26px", color: "#5f5f6a", background: "transparent", border: "none", borderLeft: "1px solid #232329", cursor: "pointer", fontSize: "11px" }, hover: { color: "#ff8f6b", background: "#212128" } },
          "✕",
        ),
      ),
    ),
  );
}

export function OverviewView(state, actions) {
  const ov = state.overview || { stats: null, buckets: [], keywords: [] };
  return h(
    "div",
    { style: { maxWidth: "800px" } },
    sectionLabel("LIBRARY SNAPSHOT"),
    statTiles(ov.stats),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "24px 0 11px" } },
      h("div", { style: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.7px", color: "#6a6a74" } }, "RECENT SEARCHES"),
      state.history.length > 0
        ? h("button", { onClick: actions.clearHistory, style: { padding: 0, background: "none", border: "none", color: "#6a6a74", fontSize: "11.5px", cursor: "pointer" }, hover: { color: "#a9a9b8" } }, "Clear all")
        : null,
    ),
    recentSearches(state, actions),
    sectionLabel("INDEXED FILES", "24px"),
    h(
      "div",
      { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "10px" } },
      assetTypesCard(ov.buckets, actions),
      keywordCloud(ov.keywords, actions),
    ),
  );
}
