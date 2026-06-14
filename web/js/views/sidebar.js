import { h, s } from "../dom.js";
import { MONO, navBase, navActive } from "../theme.js";

const searchIcon = () =>
  s("svg", { width: "15", height: "15", viewBox: "0 0 16 16", fill: "none" },
    s("circle", { cx: "7", cy: "7", r: "4.5", stroke: "currentColor", "stroke-width": "1.6" }),
    s("line", { x1: "10.5", y1: "10.5", x2: "14", y2: "14", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round" }),
  );

const setupIcon = () =>
  s("svg", { width: "15", height: "15", viewBox: "0 0 16 16" },
    s("rect", { x: "2", y: "3", width: "3", height: "3", rx: "1", fill: "currentColor" }),
    s("rect", { x: "7", y: "3.7", width: "7", height: "1.6", rx: "0.8", fill: "currentColor" }),
    s("rect", { x: "2", y: "10", width: "3", height: "3", rx: "1", fill: "currentColor" }),
    s("rect", { x: "7", y: "10.7", width: "7", height: "1.6", rx: "0.8", fill: "currentColor" }),
  );

function metric(label, value) {
  return h(
    "div",
    {},
    h("div", { style: { fontSize: "0.6875rem", color: "#76767f", marginBottom: "2px" } }, label),
    h("div", { style: { fontFamily: MONO, fontSize: "0.75rem", color: "#b7b7c1" } }, value),
  );
}

export function Sidebar(state, actions) {
  const stats = state.overview?.stats;
  const deep = stats ? stats.deepProducts : 0;
  const shallow = stats ? Math.max(0, stats.products - stats.deepProducts) : 0;
  const local = stats ? stats.localProducts : 0;
  const online = stats ? stats.onlineProducts : 0;
  const needsAttention = !stats || stats.files === 0;

  return h(
    "div",
    {
      style: {
        width: "188px", flexShrink: 0, background: "#18181c",
        borderRight: "1px solid #2a2a31", display: "flex",
        flexDirection: "column", padding: "12px 10px",
      },
    },
    h("div", { style: { fontSize: "0.6563rem", fontWeight: 600, letterSpacing: "0.7px", color: "#5a5a64", padding: "4px 8px 9px" } }, "WORKSPACE"),
    h("button", { onClick: actions.goSearch, style: state.view === "search" ? navActive : navBase }, searchIcon(), "Search"),
    h(
      "button",
      { onClick: actions.goSetup, style: state.view === "setup" ? navActive : navBase },
      setupIcon(),
      "Setup",
      needsAttention
        ? h("span", { style: { marginLeft: "auto", width: "6px", height: "6px", borderRadius: "50%", background: "#ffb05c" } })
        : null,
    ),
    h("div", { style: { flex: "1" } }),
    h(
      "div",
      { style: { borderTop: "1px solid #232329", padding: "13px 8px 4px" } },
      h("div", { style: { fontSize: "0.6563rem", fontWeight: 600, letterSpacing: "0.7px", color: "#5a5a64", marginBottom: "10px" } }, "INDEX"),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "11px" } },
        metric("Coverage", `${deep} deep · ${shallow} shallow`),
        metric("Source", `${local} local · ${online} online`),
      ),
      h(
        "div",
        {
          style: {
            display: "flex", alignItems: "center", gap: "9px", marginTop: "14px",
            padding: "8px 10px", background: "#16161b",
            border: "1px solid #242430", borderRadius: "8px",
          },
        },
        h("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: "#46d9a0", animation: "alpulse 2.4s ease-in-out infinite" } }),
        h("div", { style: { fontSize: "0.7188rem", color: "#9a9aa4" } }, "Watching cache"),
      ),
    ),
  );
}
