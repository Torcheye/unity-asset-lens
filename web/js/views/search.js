import { h, s } from "../dom.js";
import { MONO, chipBase, chipActive } from "../theme.js";
import { formatInt } from "../format.js";
import { OverviewView } from "./overview.js";
import { ResultsView } from "./results.js";

const TYPES = [
  ["all", "All"], ["audio", "Audio"], ["model", "Model"], ["prefab", "Prefab"],
  ["texture", "Texture"], ["script", "Script"], ["material", "Material"], ["shader", "Shader"],
];

function searchIcon() {
  return h(
    "span",
    { style: { position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)", color: "#6a6a74", pointerEvents: "none", display: "flex" } },
    s("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none" },
      s("circle", { cx: "7", cy: "7", r: "4.6", stroke: "currentColor", "stroke-width": "1.6" }),
      s("line", { x1: "10.6", y1: "10.6", x2: "14", y2: "14", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round" }),
    ),
  );
}

function searchBar(state, actions) {
  const children = [
    searchIcon(),
    h("input", {
      id: "al-search",
      value: state.query,
      onInput: actions.onQueryInput,
      onKeyDown: actions.onQueryKey,
      placeholder: "Search your library — try 'ui click sound' or 'sci-fi crate'",
      autocomplete: "off",
      spellcheck: "false",
      style: {
        width: "100%", height: "42px", padding: "0 40px 0 39px", fontSize: "14.5px",
        color: "#ededf1", background: "#1c1c21", border: "1px solid #2e2e36",
        borderRadius: "10px", outline: "none",
      },
      focusStyle: { borderColor: "#3a63d6", background: "#1e1e25" },
    }),
  ];
  if (state.query.length > 0) {
    children.push(
      h(
        "button",
        { onClick: actions.clearQuery, style: { position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8a96", background: "#26262d", border: "1px solid #33333b", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }, hover: { color: "#ededf1" } },
        "✕",
      ),
    );
  }
  return h("div", { style: { position: "relative" } }, ...children);
}

function filters(state, actions) {
  const chips = TYPES.map(([key, label]) =>
    h("button", { onClick: () => actions.setType(key), style: state.type === key ? chipActive : chipBase }, label),
  );

  const localStyle = state.localOnly
    ? { padding: "4px 11px", fontSize: "12px", fontWeight: 500, borderRadius: "7px", cursor: "pointer", border: "1px solid rgba(70,217,160,0.3)", background: "rgba(70,217,160,0.13)", color: "#7fe3b6" }
    : { padding: "4px 11px", fontSize: "12px", fontWeight: 500, borderRadius: "7px", cursor: "pointer", border: "1px solid #2c2c33", background: "transparent", color: "#9a9aa4" };

  const publishers = state.overview?.publishers || [];
  const options = [h("option", { value: "all" }, "All publishers")].concat(
    publishers.map((p) => h("option", { value: p }, p)),
  );
  const select = h(
    "select",
    { value: state.publisher, onChange: actions.setPublisher, style: { appearance: "none", "-webkit-appearance": "none", background: "#1c1c21", color: "#c7c7d0", border: "1px solid #2c2c33", borderRadius: "7px", padding: "5px 26px 5px 11px", fontSize: "12px", cursor: "pointer", outline: "none" } },
    ...options,
  );

  return h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" } },
    h("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap" } }, ...chips),
    h("div", { style: { width: "1px", height: "20px", background: "#2c2c33", margin: "0 3px" } }),
    h("button", { onClick: actions.toggleLocal, style: localStyle }, state.localOnly ? "✓ Local only" : "Local only"),
    h(
      "div",
      { style: { position: "relative", display: "inline-flex", alignItems: "center" } },
      select,
      h("span", { style: { position: "absolute", right: "9px", pointerEvents: "none", color: "#6a6a74", fontSize: "9px" } }, "▼"),
    ),
    h("div", { style: { flex: "1" } }),
    h("span", { style: { fontSize: "12px", color: "#7a7a85", fontFamily: MONO } }, resultCountLabel(state)),
  );
}

function resultCountLabel(state) {
  if (state.query.trim().length === 0) {
    const products = state.overview?.stats?.products ?? 0;
    return `${formatInt(products)} products indexed`;
  }
  if (state.searching) return "searching…";
  const r = state.results;
  if (!r || r.groups.length === 0) return "no matches";
  return `${r.groups.length} ${r.groups.length === 1 ? "product" : "products"} · ${r.totalFiles} files`;
}

export function SearchView(state, actions) {
  const showOverview = state.query.trim().length === 0;
  return h(
    "div",
    { style: { flex: "1", minHeight: 0, display: "flex", flexDirection: "column" } },
    h(
      "div",
      { style: { flexShrink: 0, padding: "16px 22px 14px", background: "#18181c", borderBottom: "1px solid #2a2a31" } },
      searchBar(state, actions),
      filters(state, actions),
    ),
    h(
      "div",
      { style: { flex: "1", minHeight: 0, overflowY: "auto", padding: "16px 22px 30px" } },
      showOverview ? OverviewView(state, actions) : ResultsView(state, actions),
    ),
  );
}
