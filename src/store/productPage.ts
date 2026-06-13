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

/** `<meta name="keywords" content="a, b, c">` → keyword list. */
function keywordsFromMeta(html: string): string[] {
  const m = html.match(
    /<meta[^>]+name=["']keywords["'][^>]*content=["']([^"']*)["']/i,
  );
  if (!m?.[1]) return [];
  return m[1].split(",").map(cleanKeyword).filter(Boolean);
}

/** Collect anchor text for links that point at the store search (related tags). */
function keywordsFromSearchLinks(html: string): string[] {
  const out: string[] = [];
  const re =
    /<a[^>]+href=["'][^"']*\/search\?[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
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
    keywordsFromMeta(html),
    keywordsFromJsonLd(ld),
    keywordsFromSearchLinks(html),
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
