import { h, raw } from "../dom.js";
import { MONO } from "../theme.js";
import { formatInt } from "../format.js";

const LOGO = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.6" stroke="#5b8cff" stroke-width="1.7"/><line x1="10.7" y1="10.7" x2="14" y2="14" stroke="#5b8cff" stroke-width="1.7" stroke-linecap="round"/></svg>`;

const GH_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

const USER_ICON = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.5c-2.67 0-5 1.34-5 3v1.5h10V12.5c0-1.66-2.33-3-5-3Z"/></svg>`;

/**
 * Saved-login indicator + Sign in / Sign out button. "Signing in…" while the
 * setup import step (which IS the sign-in flow) is running.
 */
function Account(state, actions) {
  const session = state.session;
  const loggedIn = !!session?.loggedIn;
  // Only "signing in" until sign-in lands; once logged in we flip to "Sign out"
  // even though import/enrich may still be running in the background.
  const signingIn = state.steps?.import?.status === "running" && !loggedIn;
  const dot = loggedIn ? "#46d9a0" : "#6a6a74";
  const label = loggedIn
    ? session.email || "Signed in"
    : session
      ? "Not signed in"
      : "…";

  const status = h(
    "div",
    {
      title: loggedIn
        ? session.email
          ? `Signed in as ${session.email}`
          : "Signed in"
        : "No saved login session",
      style: {
        display: "flex", alignItems: "center", gap: "6px", maxWidth: "220px",
        fontSize: "11.5px", color: "#9a9aa4", fontFamily: MONO,
      },
    },
    h("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: dot, flexShrink: 0 } }),
    h(
      "span",
      { style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
      label,
    ),
  );

  const btnLabel = signingIn ? "Signing in…" : loggedIn ? "Sign out" : "Sign in";
  const onClick = signingIn
    ? () => {}
    : loggedIn
      ? actions.logout
      : actions.login;

  const button = h(
    "button",
    {
      onClick,
      disabled: signingIn ? "" : null,
      title: btnLabel,
      style: {
        display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px",
        fontSize: "11.5px", fontWeight: 600,
        color: signingIn ? "#6a6a74" : loggedIn ? "#b7b7c1" : "#cdd9ff",
        background: loggedIn ? "transparent" : "rgba(122,162,255,0.13)",
        border: "1px solid " + (loggedIn ? "#33333b" : "rgba(122,162,255,0.28)"),
        borderRadius: "7px", cursor: signingIn ? "default" : "pointer",
      },
      hover: signingIn ? {} : { borderColor: loggedIn ? "#46464f" : "rgba(122,162,255,0.45)" },
    },
    raw(USER_ICON),
    btnLabel,
  );

  return h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: "10px" } },
    status,
    button,
  );
}

export function Header(state, actions) {
  const s = state.overview?.stats;
  const stats = s
    ? `${formatInt(s.products)} products · ${formatInt(s.files)} files indexed`
    : "connecting…";

  return h(
    "div",
    {
      style: {
        height: "40px", flexShrink: 0, display: "flex", alignItems: "center",
        gap: "13px", padding: "0 14px", background: "#1b1b1f",
        borderBottom: "1px solid #2a2a31",
      },
    },
    h(
      "div",
      { style: { display: "flex", gap: "7px" } },
      h("span", { style: { width: "11px", height: "11px", borderRadius: "50%", background: "#ff5f57" } }),
      h("span", { style: { width: "11px", height: "11px", borderRadius: "50%", background: "#febc2e" } }),
      h("span", { style: { width: "11px", height: "11px", borderRadius: "50%", background: "#28c840" } }),
    ),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "8px", marginLeft: "6px" } },
      raw(LOGO),
      h("span", { style: { fontSize: "13.5px", fontWeight: 600, letterSpacing: "-0.1px", color: "#ededf1" } }, "AssetLens"),
    ),
    h("div", { style: { flex: "1" } }),
    Account(state, actions),
    h("div", { style: { width: "1px", height: "18px", background: "#2c2c33", margin: "0 4px" } }),
    h(
      "a",
      {
        href: "https://github.com/Torcheye/unity-asset-lens",
        target: "_blank",
        rel: "noopener noreferrer",
        title: "View source on GitHub",
        style: {
          display: "flex", alignItems: "center", gap: "6px", padding: "4px 9px",
          fontSize: "11.5px", color: "#9a9aa4", textDecoration: "none",
          border: "1px solid #2a2a31", borderRadius: "7px",
        },
        hover: { color: "#ededf1", borderColor: "#3d3d46", background: "#232329" },
      },
      raw(GH_ICON),
      "GitHub",
    ),
    h("div", { style: { width: "1px", height: "18px", background: "#2c2c33", margin: "0 4px" } }),
    h(
      "div",
      {
        style: {
          display: "flex", alignItems: "center", gap: "8px",
          fontSize: "11.5px", color: "#7a7a85", fontFamily: MONO,
        },
      },
      h("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: "#46d9a0" } }),
      stats,
    ),
  );
}
