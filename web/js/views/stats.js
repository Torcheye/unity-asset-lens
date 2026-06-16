// Shared "library snapshot" stat cards — used by both the Setup page and the
// search Overview so the two never drift. Two cards: a plain "Files indexed"
// count, and a "Products owned" total with a Local / Online-only split bar.

import { h } from "../dom.js";
import { MONO } from "../theme.js";
import { formatInt } from "../format.js";

const LOCAL_COLOR = "#46d9a0"; // green — downloaded / on disk
const ONLINE_COLOR = "#7aa2ff"; // blue — owned in catalog, not downloaded

function pct(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

function filesCard(files) {
  return h(
    "div",
    { style: { background: "#1c1c21", border: "1px solid #2a2a31", borderRadius: "10px", padding: "13px 15px", display: "flex", flexDirection: "column", justifyContent: "center" } },
    h("div", { style: { fontSize: "1.375rem", fontWeight: 700, color: "#ededf1", letterSpacing: "-0.5px" } }, formatInt(files)),
    h("div", { style: { fontSize: "0.7188rem", color: "#83838f", marginTop: "2px" } }, "Files indexed"),
  );
}

function segmentLabel(seg, total) {
  return h(
    "div",
    { style: { flex: `${seg.count} 1 0`, minWidth: 0, display: "flex", alignItems: "baseline", justifyContent: "center", gap: "6px", overflow: "hidden", whiteSpace: "nowrap" } },
    h("span", { style: { fontSize: "0.75rem", fontWeight: 600, color: seg.color, overflow: "hidden", textOverflow: "ellipsis" } }, seg.label),
    h("span", { style: { fontFamily: MONO, fontSize: "0.7188rem", color: "#ededf1", fontWeight: 600 } }, formatInt(seg.count)),
    h("span", { style: { fontFamily: MONO, fontSize: "0.7188rem", color: "#7a7a85" } }, pct(seg.count, total) + "%"),
  );
}

function productsCard(stats) {
  const s2 = stats || { products: 0, localProducts: 0, onlineProducts: 0 };
  const total = s2.products;
  const segs = [
    { label: "Local", count: s2.localProducts, color: LOCAL_COLOR },
    { label: "Online-only", count: s2.onlineProducts, color: ONLINE_COLOR },
  ].filter((seg) => seg.count > 0);
  return h(
    "div",
    { style: { background: "#1c1c21", border: "1px solid #2a2a31", borderRadius: "10px", padding: "14px 16px", display: "flex", alignItems: "center", gap: "18px" } },
    h(
      "div",
      { style: { flexShrink: 0 } },
      h("div", { style: { fontSize: "1.375rem", fontWeight: 700, color: "#ededf1", letterSpacing: "-0.5px", lineHeight: "1.15" } }, formatInt(total)),
      h("div", { style: { fontSize: "0.7188rem", color: "#83838f", marginTop: "2px" } }, "Products owned"),
    ),
    h(
      "div",
      { style: { flex: "1", minWidth: 0 } },
      h(
        "div",
        { style: { display: "flex", gap: "2px", height: "8px", borderRadius: "5px", overflow: "hidden", background: "#232329" } },
        ...segs.map((seg) => h("div", { style: { flex: `${seg.count} 1 0`, background: seg.color } })),
      ),
      h(
        "div",
        { style: { display: "flex", gap: "2px", marginTop: "9px" } },
        ...segs.map((seg) => segmentLabel(seg, total)),
      ),
    ),
  );
}

/** Two-card library snapshot grid: Files indexed + Products owned (split bar). */
export function libraryStatCards(stats) {
  const s2 = stats || { products: 0, files: 0, localProducts: 0, onlineProducts: 0 };
  return h(
    "div",
    { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.7fr)", gap: "10px" } },
    filesCard(s2.files),
    productsCard(s2),
  );
}
