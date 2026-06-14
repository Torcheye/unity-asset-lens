import { h } from "../dom.js";
import { MONO, stepColors } from "../theme.js";
import { formatInt } from "../format.js";

const ACTION_LABELS = {
  import: { todo: "Sign in", running: "Signing in…", done: "Re-sign in" },
  scan: { todo: "Scan now", running: "Scanning…", done: "Re-scan" },
  fetch: { todo: "Fetch trees", running: "Fetching…", done: "Re-fetch" },
  enrich: { todo: "Enrich", running: "Enriching…", done: "Re-run" },
};

const STATUS_LABELS = { todo: "Not started", running: "Running", done: "Done" };

function statTiles(stats) {
  const s = stats || { products: 0, files: 0, localProducts: 0, onlineProducts: 0 };
  return [
    { value: formatInt(s.products), label: "Products owned" },
    { value: formatInt(s.files), label: "Files indexed" },
    { value: formatInt(s.localProducts), label: "Local packages" },
    { value: formatInt(s.onlineProducts), label: "Online-only" },
  ];
}

function statGrid(stats) {
  return h(
    "div",
    { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px", marginTop: "22px" } },
    ...statTiles(stats).map((t) =>
      h(
        "div",
        { style: { background: "#1c1c21", border: "1px solid #2a2a31", borderRadius: "10px", padding: "13px 15px" } },
        h("div", { style: { fontSize: "22px", fontWeight: 700, color: "#ededf1", letterSpacing: "-0.5px" } }, t.value),
        h("div", { style: { fontSize: "11.5px", color: "#83838f", marginTop: "2px" } }, t.label),
      ),
    ),
  );
}

function primaryActionStyle() {
  return {
    flexShrink: 0, padding: "7px 14px", fontSize: "12.5px", fontWeight: 600,
    color: "#cdd9ff", background: "rgba(122,162,255,0.13)",
    border: "1px solid rgba(122,162,255,0.28)", borderRadius: "8px", cursor: "pointer",
  };
}

function secondaryActionStyle() {
  return {
    flexShrink: 0, padding: "7px 14px", fontSize: "12.5px", fontWeight: 600,
    color: "#b7b7c1", background: "transparent", border: "1px solid #33333b",
    borderRadius: "8px", cursor: "pointer",
  };
}

function progressBlock(step) {
  if (step.status === "running") {
    return h(
      "div",
      { style: { marginTop: "14px" } },
      h(
        "div",
        { style: { position: "relative", height: "6px", background: "#15151a", borderRadius: "4px", overflow: "hidden" } },
        h("div", { class: "al-bar-indeterminate" }),
      ),
      h("div", { style: { marginTop: "6px", fontSize: "11.5px", color: "#7e7e8a", fontFamily: MONO } }, step.progressText || "Working…"),
    );
  }
  if (step.status === "done") {
    return h(
      "div",
      { style: { marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "#46d9a0", fontFamily: MONO } },
      `✓ ${step.detail || "Done"}`,
    );
  }
  if (step.status === "error") {
    return h(
      "div",
      { style: { marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "#ff8f6b", fontFamily: MONO } },
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
            fontSize: "12.5px", fontWeight: 600, color: fg, background: bg, border: "1px solid " + border,
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
          h("span", { style: { fontSize: "14.5px", fontWeight: 600, color: "#ededf1" } }, cfg.title),
          h(
            "span",
            {
              style: {
                display: "inline-block", whiteSpace: "nowrap", fontSize: "10.5px",
                fontWeight: 600, letterSpacing: "0.3px", color: badgeColors[0],
                background: badgeColors[1], border: "1px solid " + badgeColors[2],
                borderRadius: "5px", padding: "1px 7px",
              },
            },
            step.status === "error" ? "Error" : STATUS_LABELS[status],
          ),
          h(
            "span",
            { style: { fontSize: "10.5px", color: cfg.required ? "#5a5a64" : "#6a6a74", border: "1px solid #2e2e36", borderRadius: "5px", padding: "1px 6px" } },
            cfg.required ? "required" : "optional",
          ),
        ),
        h("div", { style: { marginTop: "5px", fontSize: "12.5px", color: "#86868f", lineHeight: "1.55" } }, ...cfg.desc),
        cfg.extra ? cfg.extra(state, actions) : null,
      ),
      h(
        "button",
        { onClick: () => actions.runStep(cfg.key), disabled: running ? "" : null, style: cfg.primary ? primaryActionStyle() : secondaryActionStyle() },
        actionLabel,
      ),
    ),
    progressBlock(step),
  );
}

function mono(text) {
  return h("span", { style: { fontFamily: MONO, color: "#b7b7c1" } }, text);
}

function importExtra(state, actions) {
  const nodes = [
    h(
      "button",
      { onClick: actions.toggleImportHelp, style: { marginTop: "7px", padding: 0, background: "none", border: "none", color: "#7aa2ff", fontSize: "12px", cursor: "pointer" } },
      state.importHelp ? "Hide details" : "How does browser sign-in work?",
    ),
  ];
  if (state.importHelp) {
    nodes.push(
      h(
        "ol",
        { style: { margin: "9px 0 2px", paddingLeft: "18px", fontSize: "12.5px", color: "#9a9aa4", lineHeight: "1.85" } },
        h("li", {}, "AssetLens opens your default browser (Chrome or Edge) at ", mono("assetstore.unity.com")),
        h("li", {}, "You sign in there normally — SSO, 2FA, social login all work"),
        h("li", {}, "It reads your owned IDs from the same ", mono("CurrentUser"), " request the My Assets page makes"),
        h("li", {}, "Catalog imports automatically · session remembered locally (clear with ", mono("logout"), ")"),
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
        fontFamily: MONO, fontSize: "11.5px", color: "#8a8a96", background: "#16161b",
        border: "1px solid #242430", borderRadius: "6px", padding: "4px 9px",
      },
    },
    h("span", { style: { color: "#5a5a64" } }, "cache"),
    cacheRoot,
  );
}

const STEP_CONFIG = [
  {
    key: "import", num: 1, title: "Sign in & import", required: true, primary: true,
    desc: ["Opens a real browser window at Unity's own sign-in page. Log in normally — SSO, 2FA and social login all work — and AssetLens reads your owned-product list directly. No DevTools, no JSON file, and your password never touches AssetLens."],
    extra: importExtra,
  },
  {
    key: "scan", num: 2, title: "Scan local cache", required: true, primary: true,
    desc: ["Stream every downloaded ", mono(".unitypackage"), " and index file paths — recursing into nested render-pipeline wrappers."],
    extra: scanExtra,
  },
  {
    key: "fetch", num: 3, title: "Fetch online file trees", required: false, primary: false,
    desc: ["Pull file trees for owned-but-not-downloaded assets via the public preview endpoint — no login needed."],
  },
  {
    key: "enrich", num: 4, title: "Enrich metadata", required: false, primary: false,
    desc: ["Add category and curated related keywords from each product page — the best signal for keyword matching."],
  },
];

export function SetupView(state, actions) {
  const openEnabled = state.steps.import.status === "done" && state.steps.scan.status === "done";
  const openStyle = openEnabled
    ? { padding: "9px 16px", fontSize: "13px", fontWeight: 600, color: "#fff", background: "#3a63d6", border: "1px solid #3a63d6", borderRadius: "9px", cursor: "pointer", flexShrink: 0 }
    : { padding: "9px 16px", fontSize: "13px", fontWeight: 600, color: "#5a5a64", background: "#202028", border: "1px solid #2a2a31", borderRadius: "9px", cursor: "not-allowed", flexShrink: 0 };

  return h(
    "div",
    { style: { flex: "1", minHeight: 0, overflowY: "auto", padding: "28px 32px 40px" } },
    h(
      "div",
      { style: { maxWidth: "820px" } },
      h("h1", { style: { margin: 0, fontSize: "21px", fontWeight: 700, letterSpacing: "-0.4px", color: "#f1f1f4" } }, "Set up your library index"),
      h("p", { style: { margin: "7px 0 0", fontSize: "13.5px", color: "#86868f", lineHeight: "1.55", maxWidth: "620px" } }, "AssetLens builds one searchable index of every file you own across the Unity Asset Store — downloaded or not — and searches paths and metadata together."),
      statGrid(state.overview?.stats),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "11px", marginTop: "18px" } },
        ...STEP_CONFIG.map((cfg) => stepCard(state, actions, cfg)),
      ),
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
          h("div", { style: { fontWeight: 600, fontSize: "14px", color: "#ededf1" } }, "Ready to search"),
          h("div", { style: { fontSize: "12.5px", color: "#86868f", marginTop: "3px" } }, openEnabled ? "Index built — search across your whole library now." : "Finish Sign-in and Scan to build the search index."),
        ),
        h("button", { onClick: openEnabled ? actions.goSearch : () => {}, style: openStyle }, "Open search →"),
      ),
    ),
  );
}
