import { h } from "../dom.js";
import { MONO, stepColors, badgeStyle } from "../theme.js";
import { formatInt, formatBytes } from "../format.js";
import { libraryStatCards } from "./stats.js";

const ACTION_LABELS = {
  signin: { todo: "Sign in", running: "Signing in…", done: "Re-sign in" },
  import: { todo: "Import", running: "Importing…", done: "Re-import" },
  scan: { todo: "Scan now", running: "Scanning…", done: "Re-scan" },
  fetch: { todo: "Fetch trees", running: "Fetching…", done: "Re-fetch" },
};

const STATUS_LABELS = { todo: "Not started", running: "Running", done: "Done" };

function primaryActionStyle() {
  return {
    flexShrink: 0, padding: "7px 14px", fontSize: "0.7813rem", fontWeight: 600,
    color: "#cdd9ff", background: "rgba(122,162,255,0.13)",
    border: "1px solid rgba(122,162,255,0.28)", borderRadius: "8px", cursor: "pointer",
  };
}

function secondaryActionStyle() {
  return {
    flexShrink: 0, padding: "7px 14px", fontSize: "0.7813rem", fontWeight: 600,
    color: "#b7b7c1", background: "transparent", border: "1px solid #33333b",
    borderRadius: "8px", cursor: "pointer",
  };
}

function disabledActionStyle() {
  return {
    flexShrink: 0, padding: "7px 14px", fontSize: "0.7813rem", fontWeight: 600,
    color: "#5a5a64", background: "#202028", border: "1px solid #2a2a31",
    borderRadius: "8px", cursor: "not-allowed",
  };
}

function runningBar(step) {
  const total = step.total || 0;
  // A known total → a real percentage fill; otherwise the looping animation
  // (used by the silent catalog-parse / sign-in phases that have no count).
  if (total > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((step.current / total) * 100)));
    return h(
      "div",
      { style: { position: "relative", height: "6px", background: "#15151a", borderRadius: "4px", overflow: "hidden" } },
      h("div", {
        style: {
          position: "absolute", top: 0, left: 0, height: "100%", width: pct + "%",
          background: "linear-gradient(90deg, #3a63d6, #5b8cff)",
          borderRadius: "4px", transition: "width 0.2s ease",
        },
      }),
    );
  }
  return h(
    "div",
    { style: { position: "relative", height: "6px", background: "#15151a", borderRadius: "4px", overflow: "hidden" } },
    h("div", { class: "al-bar-indeterminate" }),
  );
}

function runningLabel(step) {
  const total = step.total || 0;
  const base = step.progressText || "Working…";
  if (total <= 0) return base;
  const pct = Math.max(0, Math.min(100, Math.round((step.current / total) * 100)));
  return `${base}  ·  ${formatInt(step.current)}/${formatInt(total)} (${pct}%)`;
}

function progressBlock(step) {
  if (step.status === "running") {
    return h(
      "div",
      { style: { marginTop: "14px" } },
      runningBar(step),
      h("div", { style: { marginTop: "6px", fontSize: "0.7188rem", color: "#7e7e8a", fontFamily: MONO } }, runningLabel(step)),
    );
  }
  if (step.status === "done") {
    return h(
      "div",
      { style: { marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.7813rem", color: "#46d9a0", fontFamily: MONO } },
      `✓ ${step.detail || "Done"}`,
    );
  }
  if (step.status === "error") {
    return h(
      "div",
      { style: { marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.7813rem", color: "#ff8f6b", fontFamily: MONO } },
      `! ${step.detail || "Failed"}`,
    );
  }
  return null;
}

function stepCard(state, actions, cfg) {
  const step = state.steps[cfg.key];
  const status = step.status === "error" ? "todo" : step.status;
  const [fg, bg, border] = stepColors(status);
  const badgeColors = step.status === "error" ? ["#ff8f6b", "rgba(255,143,107,0.12)", "rgba(255,143,107,0.25)"] : [fg, bg, border];

  const actionLabel = ACTION_LABELS[cfg.key][status] || ACTION_LABELS[cfg.key].todo;
  const running = step.status === "running";
  // A gated step (e.g. Import before sign-in) is shown but its action is locked.
  const gatedOff = cfg.gate ? !cfg.gate(state) : false;
  const disabled = running || gatedOff;
  const actionStyle = gatedOff
    ? disabledActionStyle()
    : cfg.primary
      ? primaryActionStyle()
      : secondaryActionStyle();

  return h(
    "div",
    { style: { background: "#1d1d22", border: "1px solid #2a2a31", borderRadius: "11px", padding: "15px 17px" } },
    h(
      "div",
      { style: { display: "flex", alignItems: "flex-start", gap: "13px" } },
      h(
        "div",
        {
          style: {
            width: "26px", height: "26px", flexShrink: 0, display: "flex",
            alignItems: "center", justifyContent: "center", borderRadius: "50%",
            fontSize: "0.7813rem", fontWeight: 600, color: fg, background: bg, border: "1px solid " + border,
          },
        },
        String(cfg.num),
      ),
      h(
        "div",
        { style: { flex: "1", minWidth: 0 } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" } },
          h("span", { style: { fontSize: "0.9063rem", fontWeight: 600, color: "#ededf1" } }, cfg.title),
          h(
            "span",
            {
              style: {
                display: "inline-block", whiteSpace: "nowrap", fontSize: "0.6563rem",
                fontWeight: 600, letterSpacing: "0.3px", color: badgeColors[0],
                background: badgeColors[1], border: "1px solid " + badgeColors[2],
                borderRadius: "5px", padding: "1px 7px",
              },
            },
            step.status === "error" ? "Error" : STATUS_LABELS[status],
          ),
          h(
            "span",
            { style: { fontSize: "0.6563rem", color: cfg.required ? "#5a5a64" : "#6a6a74", border: "1px solid #2e2e36", borderRadius: "5px", padding: "1px 6px" } },
            cfg.required ? "required" : "optional",
          ),
        ),
        h("div", { style: { marginTop: "5px", fontSize: "0.7813rem", color: "#86868f", lineHeight: "1.55" } }, ...cfg.desc),
        cfg.extra ? cfg.extra(state, actions) : null,
      ),
      h(
        "button",
        {
          onClick: () => { if (!disabled) actions.runStep(cfg.key); },
          disabled: disabled ? "" : null,
          title: gatedOff ? "Sign in first" : actionLabel,
          style: actionStyle,
        },
        actionLabel,
      ),
    ),
    progressBlock(step),
  );
}

function mono(text) {
  return h("span", { style: { fontFamily: MONO, color: "#b7b7c1" } }, text);
}

function signInExtra(state, actions) {
  const nodes = [
    h(
      "button",
      { onClick: actions.toggleImportHelp, style: { marginTop: "7px", padding: 0, background: "none", border: "none", color: "#7aa2ff", fontSize: "0.75rem", cursor: "pointer" } },
      state.importHelp ? "Hide details" : "How does browser sign-in work?",
    ),
  ];
  if (state.importHelp) {
    nodes.push(
      h(
        "ol",
        { style: { margin: "9px 0 2px", paddingLeft: "18px", fontSize: "0.7813rem", color: "#9a9aa4", lineHeight: "1.85" } },
        h("li", {}, "AssetLens opens your default browser (Chrome or Edge) at ", mono("assetstore.unity.com")),
        h("li", {}, "You sign in there normally — SSO, 2FA, social login all work"),
        h("li", {}, "It reads your owned IDs from the same ", mono("CurrentUser"), " request the My Assets page makes"),
        h("li", {}, "Session remembered locally (clear with ", mono("logout"), ") — then run Import to pull your catalog"),
      ),
    );
  }
  return h("div", {}, ...nodes);
}

function scanExtra(state) {
  const cacheRoot = state.overview?.cacheRoot || "the per-OS Asset Store cache";
  return h(
    "div",
    {
      style: {
        marginTop: "8px", display: "inline-flex", alignItems: "center", gap: "7px",
        fontFamily: MONO, fontSize: "0.7188rem", color: "#8a8a96", background: "#16161b",
        border: "1px solid #242430", borderRadius: "6px", padding: "4px 9px",
      },
    },
    h("span", { style: { color: "#5a5a64" } }, "cache"),
    cacheRoot,
  );
}

const STEP_CONFIG = [
  {
    key: "signin", num: 1, title: "Sign in", required: true, primary: true,
    desc: ["Opens a real browser window at Unity's own sign-in page. Log in normally — SSO, 2FA and social login all work — and AssetLens reuses the resulting session. No DevTools, no JSON file, and your password never touches AssetLens."],
    extra: signInExtra,
  },
  {
    key: "import", num: 2, title: "Import & enrich", required: true, primary: true,
    gate: (state) => !!state.session?.loggedIn,
    desc: ["Reads your owned-product list and collects each product's store-page keywords so they're searchable right away. Reuses your saved sign-in — a browser window may reopen briefly to read your library."],
  },
  {
    key: "scan", num: 3, title: "Scan local cache", required: true, primary: true,
    desc: ["Stream every downloaded ", mono(".unitypackage"), " and index file paths — recursing into nested render-pipeline wrappers."],
    extra: scanExtra,
  },
  {
    key: "fetch", num: 4, title: "Fetch online file trees", required: false, primary: false,
    desc: ["Pull file trees for owned-but-not-downloaded assets via the public preview endpoint — no login needed."],
  },
];

// ── local folders (optional) ──────────────────────────────────────────────
function iconButtonStyle(disabled) {
  return {
    flexShrink: 0, width: "28px", height: "28px", display: "flex",
    alignItems: "center", justifyContent: "center", fontSize: "0.8125rem",
    color: disabled ? "#5a5a64" : "#b7b7c1", background: "transparent",
    border: "1px solid #33333b", borderRadius: "7px",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function folderBusyLine(scan) {
  return h(
    "div",
    { style: { marginTop: "13px" } },
    h(
      "div",
      { style: { position: "relative", height: "6px", background: "#15151a", borderRadius: "4px", overflow: "hidden" } },
      h("div", { class: "al-bar-indeterminate" }),
    ),
    h(
      "div",
      { style: { marginTop: "6px", fontSize: "0.7188rem", color: "#7e7e8a", fontFamily: MONO } },
      scan.current > 0 ? `${scan.message}  ·  ${formatInt(scan.current)} files` : scan.message,
    ),
  );
}

function folderRow(folder, actions, busy) {
  const missing = folder.status === "missing";
  return h(
    "div",
    {
      style: {
        display: "flex", alignItems: "center", gap: "11px", padding: "10px 12px",
        background: "#191920", borderRadius: "9px",
        border: "1px solid " + (missing ? "rgba(255,176,92,0.3)" : "#26262d"),
      },
    },
    h(
      "div",
      { style: { minWidth: 0, flex: "1" } },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
        h("span", { style: { fontSize: "0.8125rem", fontWeight: 600, color: "#ededf1" } }, folder.name),
        missing ? h("span", { style: badgeStyle("#ffb05c", "rgba(255,176,92,0.14)") }, "missing") : null,
      ),
      h(
        "div",
        { style: { marginTop: "2px", fontFamily: MONO, fontSize: "0.6875rem", color: "#7a7a85", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        folder.path,
      ),
      missing
        ? h("div", { style: { marginTop: "4px", fontSize: "0.7188rem", color: "#ffb05c", lineHeight: "1.45" } }, "Folder not found — its files are still searchable. Re-scan if it's back, or remove it.")
        : null,
    ),
    h(
      "div",
      { style: { flexShrink: 0, fontSize: "0.7188rem", color: "#83838f", textAlign: "right", whiteSpace: "nowrap" } },
      `${formatBytes(folder.totalSize)} · ${formatInt(folder.fileCount)} files`,
    ),
    h("button", { onClick: () => { if (!busy) actions.rescanFolder(folder.path); }, disabled: busy ? "" : null, title: "Re-scan", style: iconButtonStyle(busy) }, "↻"),
    h("button", { onClick: () => { if (!busy) actions.removeFolder(folder.path); }, disabled: busy ? "" : null, title: "Remove", style: iconButtonStyle(busy) }, "✕"),
  );
}

function FoldersCard(state, actions) {
  const busy = !!state.folderScan;
  const folders = state.folders || [];
  return h(
    "div",
    { style: { background: "#1d1d22", border: "1px solid #2a2a31", borderRadius: "11px", padding: "15px 17px", marginTop: "11px" } },
    h(
      "div",
      { style: { display: "flex", alignItems: "flex-start", gap: "13px" } },
      h(
        "div",
        { style: { flex: "1", minWidth: 0 } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" } },
          h("span", { style: { fontSize: "0.9063rem", fontWeight: 600, color: "#ededf1" } }, "Local folders"),
          h("span", { style: { fontSize: "0.6563rem", color: "#6a6a74", border: "1px solid #2e2e36", borderRadius: "5px", padding: "1px 6px" } }, "optional"),
        ),
        h("div", { style: { marginTop: "5px", fontSize: "0.7813rem", color: "#86868f", lineHeight: "1.55" } }, "Add folders outside the Asset Store cache. Their files are scanned and included in search, matched by path and name."),
      ),
      h(
        "button",
        { onClick: () => { if (!busy) actions.addFolder(); }, disabled: busy ? "" : null, title: "Add folder", style: busy ? disabledActionStyle() : primaryActionStyle() },
        busy ? "Working…" : "Add folder",
      ),
    ),
    busy ? folderBusyLine(state.folderScan) : null,
    state.folderError ? h("div", { style: { marginTop: "12px", fontSize: "0.7813rem", color: "#ff8f6b", fontFamily: MONO } }, `! ${state.folderError}`) : null,
    folders.length > 0
      ? h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "14px" } }, ...folders.map((f) => folderRow(f, actions, busy)))
      : busy
        ? null
        : h("div", { style: { marginTop: "12px", fontSize: "0.7813rem", color: "#6b6b76" } }, "No folders added yet."),
  );
}

export function SetupView(state, actions) {
  const openEnabled = state.steps.import.status === "done" && state.steps.scan.status === "done";
  const openStyle = openEnabled
    ? { padding: "9px 16px", fontSize: "0.8125rem", fontWeight: 600, color: "#fff", background: "#3a63d6", border: "1px solid #3a63d6", borderRadius: "9px", cursor: "pointer", flexShrink: 0 }
    : { padding: "9px 16px", fontSize: "0.8125rem", fontWeight: 600, color: "#5a5a64", background: "#202028", border: "1px solid #2a2a31", borderRadius: "9px", cursor: "not-allowed", flexShrink: 0 };

  return h(
    "div",
    { style: { flex: "1", minHeight: 0, overflowY: "auto", padding: "28px 32px 40px" } },
    h(
      "div",
      { style: { width: "100%" } },
      h("h1", { style: { margin: 0, fontSize: "1.3125rem", fontWeight: 700, letterSpacing: "-0.4px", color: "#f1f1f4" } }, "Set up your library index"),
      h("p", { style: { margin: "7px 0 0", fontSize: "0.8438rem", color: "#86868f", lineHeight: "1.55" } }, "AssetLens builds one searchable index of every file you own across the Unity Asset Store — downloaded or not — and searches paths and metadata together."),
      h("div", { style: { marginTop: "22px" } }, libraryStatCards(state.overview?.stats)),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "11px", marginTop: "18px" } },
        ...STEP_CONFIG.map((cfg) => stepCard(state, actions, cfg)),
      ),
      FoldersCard(state, actions),
      h(
        "div",
        {
          style: {
            marginTop: "18px", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: "16px", padding: "16px 18px",
            background: "#1c1c21", border: "1px solid #2a2a31", borderRadius: "11px",
          },
        },
        h(
          "div",
          {},
          h("div", { style: { fontWeight: 600, fontSize: "0.875rem", color: "#ededf1" } }, "Ready to search"),
          h("div", { style: { fontSize: "0.7813rem", color: "#86868f", marginTop: "3px" } }, openEnabled ? "Index built — search across your whole library now." : "Finish Import and Scan to build the search index."),
        ),
        h("button", { onClick: openEnabled ? actions.goSearch : () => {}, style: openStyle }, "Open search →"),
      ),
    ),
  );
}
