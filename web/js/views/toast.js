import { h } from "../dom.js";
import { MONO } from "../theme.js";

export function Toast(state) {
  if (!state.toastVisible || !state.toast) return null;
  const { title, cmd, dot } = state.toast;
  return h(
    "div",
    {
      style: {
        position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)",
        minWidth: "340px", maxWidth: "580px", background: "#222229",
        border: "1px solid #36363f", borderRadius: "10px",
        boxShadow: "0 14px 44px rgba(0,0,0,0.55)", padding: "11px 14px",
        animation: "altoast .18s cubic-bezier(.2,.8,.2,1)", zIndex: "50",
      },
    },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "9px" } },
      h("span", { style: { width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: dot || "#5b8cff" } }),
      h("span", { style: { fontSize: "0.8125rem", fontWeight: 600, color: "#ededf1" } }, title),
    ),
    h(
      "div",
      {
        style: {
          marginTop: "7px", fontFamily: MONO, fontSize: "0.7188rem", color: "#8f8f9b",
          wordBreak: "break-all", background: "#16161b", border: "1px solid #2a2a31",
          borderRadius: "6px", padding: "7px 9px",
        },
      },
      cmd,
    ),
  );
}
