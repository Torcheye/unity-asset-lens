// File-type icons. PNGs are Unity's built-in editor icons, vendored under
// web/icons/types/ (one per FileTypeBucket) from
// https://github.com/rythwh/unity-editor-icons (dark "d_" variants).
import { h } from "./dom.js";

const KNOWN = new Set([
  "audio", "model", "prefab", "texture", "script", "animation", "material",
  "scene", "shader", "font", "video", "data", "package", "other",
]);

/** Path to the editor icon PNG for a file-type bucket (falls back to `other`). */
export function iconForBucket(bucket) {
  return `icons/types/${KNOWN.has(bucket) ? bucket : "other"}.png`;
}

/** A small square <img> badge for a file-type bucket. `size` is in px. */
export function bucketIcon(bucket, size = 14) {
  return h("img", {
    src: iconForBucket(bucket),
    alt: "",
    width: String(size),
    height: String(size),
    style: {
      width: `${size}px`,
      height: `${size}px`,
      objectFit: "contain",
      flexShrink: 0,
      display: "inline-block",
      verticalAlign: "middle",
    },
  });
}
