// Shared palette + style builders, ported verbatim from the AssetLens design
// (design/AssetLens.dc.html). Keeping these in one place mirrors the design's
// single source of truth for the dark "dev tool" look.

export const MONO = "'IBM Plex Mono', ui-monospace, monospace";

/** Per-type-bucket pill colours [foreground, background]. */
export const PILL = {
  audio: ["#46d9a0", "rgba(70,217,160,0.14)"],
  model: ["#c79bff", "rgba(199,155,255,0.14)"],
  prefab: ["#7aa2ff", "rgba(122,162,255,0.14)"],
  texture: ["#ff8f6b", "rgba(255,143,107,0.14)"],
  script: ["#f2cf66", "rgba(242,207,102,0.14)"],
  material: ["#ff9ecb", "rgba(255,158,203,0.14)"],
  shader: ["#a7e26b", "rgba(167,226,107,0.14)"],
  scene: ["#79d7ff", "rgba(121,215,255,0.14)"],
  animation: ["#79d7ff", "rgba(121,215,255,0.14)"],
  font: ["#cfcfd8", "rgba(207,207,216,0.12)"],
  video: ["#ff8f6b", "rgba(255,143,107,0.14)"],
  data: ["#9a9aa6", "rgba(154,154,166,0.12)"],
  package: ["#ffb05c", "rgba(255,176,92,0.14)"],
  other: ["#9a9aa6", "rgba(154,154,166,0.12)"],
};

export function colorForBucket(bucket) {
  return (PILL[bucket] || PILL.other)[0];
}

export function pillStyle(bucket) {
  const c = PILL[bucket] || PILL.other;
  return {
    display: "inline-block",
    fontFamily: MONO,
    fontSize: "0.625rem",
    fontWeight: 600,
    letterSpacing: "0.3px",
    textTransform: "uppercase",
    color: c[0],
    background: c[1],
    borderRadius: "5px",
    padding: "1px 6px",
    flexShrink: 0,
  };
}

export function badgeStyle(color, bg) {
  return {
    display: "inline-block",
    fontSize: "0.625rem",
    fontWeight: 600,
    letterSpacing: "0.4px",
    textTransform: "uppercase",
    color,
    background: bg,
    border: "1px solid " + bg,
    borderRadius: "5px",
    padding: "1px 6px",
  };
}

export const navBase = {
  display: "flex",
  alignItems: "center",
  gap: "9px",
  width: "100%",
  padding: "8px 9px",
  marginBottom: "3px",
  fontSize: "0.8125rem",
  fontWeight: 500,
  borderRadius: "8px",
  border: "1px solid transparent",
  cursor: "pointer",
  textAlign: "left",
  background: "transparent",
  color: "#9a9aa4",
};

export const navActive = {
  ...navBase,
  background: "rgba(122,162,255,0.12)",
  color: "#cdd9ff",
  border: "1px solid rgba(122,162,255,0.18)",
};

export const chipBase = {
  padding: "4px 10px",
  fontSize: "0.75rem",
  fontWeight: 500,
  borderRadius: "7px",
  cursor: "pointer",
  border: "1px solid #2c2c33",
  background: "transparent",
  color: "#9a9aa4",
};

export const chipActive = {
  ...chipBase,
  background: "rgba(122,162,255,0.14)",
  color: "#bcd0ff",
  border: "1px solid rgba(122,162,255,0.3)",
};

/** Step indicator colours by status: [fg, bg, border]. */
export function stepColors(status) {
  if (status === "done") return ["#46d9a0", "rgba(70,217,160,0.12)", "rgba(70,217,160,0.25)"];
  if (status === "running") return ["#7aa2ff", "rgba(122,162,255,0.12)", "rgba(122,162,255,0.25)"];
  return ["#7c7c86", "rgba(124,124,134,0.10)", "#2e2e36"];
}
