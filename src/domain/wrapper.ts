import { baseNameOf, extOf } from "./fileType.js";

/**
 * Wrapper-package detection (spec §3.3), shared by the local unpacker and the
 * online `PreviewAssets` path. A wrapper's file-leaves are *only* nested
 * `.unitypackage` files plus a readme — locally it is deep-unpacked, online it
 * is opaque and gets `coverage = shallow`.
 */

const README_EXTS = new Set(["txt", "md", "pdf", "rtf", "doc", "docx"]);

export function isReadmeish(path: string): boolean {
  const base = baseNameOf(path).toLowerCase();
  if (README_EXTS.has(extOf(base))) return true;
  return base.includes("readme") || base.startsWith("_read");
}

/**
 * True when every file-leaf is a `.unitypackage` or a readme, and at least one
 * is a `.unitypackage`.
 */
export function isWrapperByLeaves(leafPaths: readonly string[]): boolean {
  if (leafPaths.length === 0) return false;
  let hasPackage = false;
  for (const p of leafPaths) {
    if (p.toLowerCase().endsWith(".unitypackage")) {
      hasPackage = true;
      continue;
    }
    if (isReadmeish(p)) continue;
    return false;
  }
  return hasPackage;
}
