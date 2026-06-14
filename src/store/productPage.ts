import type { ProductPageMetadata } from "../domain/types.js";
import type { HttpClient } from "./http.js";
import { storeUrl } from "./constants.js";

/**
 * Best-effort extraction of search-relevant metadata from the *public* product
 * page HTML (spec §3.4): the **category** (breadcrumb) and the curated
 * **related keywords** — the single best field for keyword matching.
 *
 * The store is a client-rendered app, but these fields ship as static markup.
 * Because the exact markup is undocumented and may change (spec §10), this
 * reads several independent signals and merges them; update the selectors here
 * if the page structure changes.
 */

const MAX_KEYWORDS = 40;

/**
 * Safety cap (chars) for the Related-keywords scan when the section is not
 * followed by another `<h2>` to bound it. Comfortably larger than any observed
 * section (~5 KB) but small enough to never run away on a malformed page.
 */
const RELATED_SCAN_CAP = 8000;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function cleanKeyword(raw: string): string {
  return decodeEntities(raw.replace(/\s+/g, " ")).trim();
}

/**
 * The product page's curated **Related keywords** — the single-word-ish tags
 * the publisher chose (e.g. "cityscape", "lowpoly", "city builder"). This is the
 * single best field for the keyword cloud and keyword search.
 *
 * They render as a list of search-link anchors (`<a href="/?q=cityscape">…</a>`)
 * under a "Related keywords" heading. Extraction is scoped to that section
 * (heading → the next `<h2>`) so unrelated `/?q=` links elsewhere on the page
 * are not swept in. NOTE: the store's `<meta name="keywords">` is deliberately
 * *not* read — Unity populates it with just "<title>,<category-path>", which is
 * title noise plus a duplicate of the breadcrumb category. Update the heading
 * text or anchor shape here if Unity changes the markup (spec §10).
 */
function keywordsFromRelated(html: string): string[] {
  const start = html.search(/related\s+keywords/i);
  if (start < 0) return [];
  const rest = html.slice(start);
  const nextH2 = rest.search(/<h2[\s>]/i);
  const section = rest.slice(0, nextH2 > 0 ? nextH2 : RELATED_SCAN_CAP);
  const out: string[] = [];
  const re = /<a[^>]+href=["']\/\?q=[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    const text = cleanKeyword(m[1]!.replace(/<[^>]+>/g, ""));
    if (text) out.push(text);
  }
  return out;
}

interface JsonLdNode {
  "@type"?: string | string[];
  itemListElement?: Array<{ name?: string; item?: { name?: string } }>;
  keywords?: string | string[];
}

function jsonLdNodes(html: string): JsonLdNode[] {
  const out: JsonLdNode[] = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]!.trim()) as unknown;
      if (Array.isArray(parsed)) out.push(...(parsed as JsonLdNode[]));
      else out.push(parsed as JsonLdNode);
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return out;
}

function typeOf(node: JsonLdNode): string[] {
  const t = node["@type"];
  return Array.isArray(t) ? t : t ? [t] : [];
}

/** Derive a category string from a JSON-LD BreadcrumbList (drop root + leaf). */
function categoryFromBreadcrumb(nodes: readonly JsonLdNode[]): string | undefined {
  const crumb = nodes.find((n) => typeOf(n).includes("BreadcrumbList"));
  const items = crumb?.itemListElement;
  if (!items || items.length < 2) return undefined;
  const names = items
    .map((it) => cleanKeyword(it.name ?? it.item?.name ?? ""))
    .filter(Boolean);
  if (names.length < 2) return undefined;
  // Drop a leading "Home"/root and the trailing product-name leaf.
  const trail = names.slice(0, -1).filter((n) => n.toLowerCase() !== "home");
  return trail.length > 0 ? trail.join("/") : undefined;
}

function keywordsFromJsonLd(nodes: readonly JsonLdNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (typeof n.keywords === "string") {
      out.push(...n.keywords.split(",").map(cleanKeyword));
    } else if (Array.isArray(n.keywords)) {
      out.push(...n.keywords.map(cleanKeyword));
    }
  }
  return out.filter(Boolean);
}

function dedupeKeywords(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const kw of list) {
      const key = kw.toLowerCase();
      if (kw.length === 0 || seen.has(key)) continue;
      seen.add(key);
      out.push(kw);
      if (out.length >= MAX_KEYWORDS) return out;
    }
  }
  return out;
}

/** Parse a product-page HTML string into {@link ProductPageMetadata}. */
export function parseProductPage(html: string): ProductPageMetadata {
  const ld = jsonLdNodes(html);
  const keywords = dedupeKeywords([
    keywordsFromRelated(html),
    keywordsFromJsonLd(ld),
  ]);
  const category = categoryFromBreadcrumb(ld);
  return category !== undefined ? { category, keywords } : { keywords };
}

/** GET and parse a product page for enrichment. Returns empty metadata on 404. */
export async function fetchProductMetadata(
  http: HttpClient,
  productId: string,
): Promise<ProductPageMetadata> {
  const res = await http(storeUrl(productId), { method: "GET" });
  if (!res.ok) {
    return { keywords: [] };
  }
  return parseProductPage(await res.text());
}
