# Unity Asset Library Search — Design Spec

> A search tool for your own Unity Asset Store library. Type a keyword
> (e.g. *"ui click sound"*) and find the exact file across everything you
> own — including the mega bundles with thousands of files — whether or not
> it's downloaded yet.

**Status:** Draft v0.1 · **Audience:** Unity developers · **License intent:** public / open-source
**Working codename:** *AssetLens* (placeholder)

---

## 1. Problem & Goal

People accumulate large Unity Asset Store libraries over years and lose track of
what they own. Mega audio/model bundles contain hundreds to thousands of
individual files, making it impractical to find the right one (a single UI click
sound, a crate model) when building a game.

**Goal:** a fast keyword search over your *entire owned library* at the
individual-file level, matching on file paths/names **and** asset metadata
(titles, descriptions, tags). A hit either points you to the local file or opens
the store page; online-only assets can be downloaded on demand to become locally
searchable.

This is a **filename / metadata text-matching** tool. Semantic search, audio
content tagging, and model/thumbnail analysis are explicitly **out of scope for
v0** (see Non-Goals; revisit later).

---

## 2. Goals / Non-Goals

### Goals (v0)
- Index every file in every owned asset, downloaded or not.
- Keyword search over file paths + asset metadata.
- Result actions: reveal local file, open store link, or download-to-local.
- Downloading performs **one-step recursive unpacking** so render-pipeline
  wrapper packages become fully searchable.
- Run with minimal setup; no heavy infra.

### Non-Goals (v0)
- Semantic / embedding search (phase 2 candidate).
- Audio/model **content** analysis (listening to a wav, classifying an fbx).
- Importing logic beyond pointing at / revealing the package (unless we choose
  the editor route — see §8).
- Mirroring or redistributing asset *contents*. We index metadata and paths the
  user is entitled to; we never rehost asset files.

---

## 3. Verified Findings (knowledge base)

Everything below was confirmed during research, including a live browser test of
the store API. Treat this as the project's factual foundation.

### 3.1 Local asset-package cache
Downloaded `.unitypackage` files live in a per-user cache, organized as
`<root>/<Publisher>/<Category>/<Name>.unitypackage`. Confirmed current for Unity
6.3 LTS:

| OS | Path |
|---|---|
| Windows | `C:\Users\<user>\AppData\Roaming\Unity\Asset Store-5.x` |
| macOS | `~/Library/Unity/Asset Store-5.x` |
| Linux | `~/.local/share/unity3d/Asset Store-5.x` |

Notes:
- The location is overridable by the user, so we must support a configurable
  override and also check Unity's cache-location config.
- Files appear here only **after download** (download ≠ import; we never need to
  import into a project to index).
- Some newer Asset Store content ships as **UPM packages** (stored in the
  *global* package cache, different structure) rather than `.unitypackage`.
  Those are a known blind spot for v0; flag and skip, or handle later.

### 3.2 `.unitypackage` format
A `.unitypackage` is a **gzip-compressed tarball**. Inside, each contained file
is a directory named by a 32-char GUID holding:
- `asset` — the file's raw bytes (absent for folders),
- `asset.meta` — the `.meta` file,
- `pathname` — a small text file with the original project-relative path
  (e.g. `Assets/SFX/UI/UI_Click_01.wav`),
- `preview.png` — sometimes a thumbnail.

**Indexing trick:** stream the tar and read **only the `pathname` members**,
skipping the large `asset` blobs. This lets us index thousands of files across
gigabytes by reading only kilobytes per package — no extraction, no import.

### 3.3 Nested / wrapper packages (important edge case)
Many modern multi-pipeline art/model packs ship as a **wrapper**: the
downloadable package contains only nested `.unitypackage` files (one per render
pipeline) plus a readme. Example observed:

```
Toon Deserted Temples/
  BuiltIn_Toon Deserted Temples_6000.1.0.unitypackage
  URP_Toon Deserted Temples_6000.1.0.unitypackage
  _ReadFirst.txt
```

Consequences:
- The **online** content endpoint (§3.4) shows the nested `.unitypackage` as a
  single opaque `file` leaf and does **not** expand it. So wrapper assets cannot
  be deep-indexed online.
- **Locally**, the nested package's bytes are embedded as the `asset` blob of the
  outer tar. We read the outer tar, find the member whose path ends in
  `.unitypackage`, take its bytes (themselves a complete gzip tarball), and feed
  them into a second tar reader. **Recurse → read inner `pathname` manifest.**
  No second download needed.
- Wrapper detection heuristic: a content tree whose leaves are *only*
  `.unitypackage` files (+ readme/txt/md). These get flagged for lazy
  deep-indexing on download.

### 3.4 Asset Store API endpoints
Single endpoint, batched (request body is an array, response is an array):

```
POST https://assetstore.unity.com/api/graphql/batch
Headers: Content-Type: application/json
         x-requested-with: XMLHttpRequest
         x-source: storefront
         operations: <OperationName>
         x-csrf-token: <value of the _csrf cookie>
```

**Catalog — `searchMyAssets`** (which products you own):
- Requires your **logged-in session** + CSRF token.
- Variables: `{ page, pageSize: 100, q, tagging, ids, assignFrom, sortBy: 7 }`.
- Returns `product { id, productId, itemId, name, publisher{name}, downloadSize,
  currentVersion{name, publishedDate}, ... }`.
- Paginate by `page`; pass `tagging: ["#BIN"]` to also get hidden/archived
  assets.

**Content tree — `PreviewAssets`** (the per-asset file tree):
- Requires **only a CSRF token — no login, no ownership.** Verified live: called
  with `sessionLoggedIn: false` → HTTP 200 with the full tree.
- Query:
  ```graphql
  query PreviewAssets($id: ID!, $page: Int) {
    product(id: $id) {
      id
      name
      assets(page: $page) {
        guid
        assetId: asset_id
        label
        level
        type        # "folder" | "file"
      }
    }
  }
  ```
- Returns a **flat** list of nodes with a `level` (depth) field. Reconstruct full
  paths client-side by tracking the level. `page` paginates large packages — loop
  until a page returns empty.

**Metadata — resolved (no new endpoint required for v0):**
- `searchMyAssets` already gives `name`, `publisher`, `downloadSize`, version.
- The **public product-page HTML** (a plain GET, verified) additionally carries
  the most search-relevant metadata as static markup — no JS render needed:
  - **Related keywords / tags** (curated search keywords, e.g. *"Unity HTTP
    request"*, *"Unity networking plugin"*) — the single best metadata field for
    keyword matching.
  - **Category** (breadcrumb, e.g. Tools → Network), publisher, file size,
    version, license type.
  - The long **Description** body is client-rendered and *not* in the static
    HTML.
- **Decision:** index `name` + `publisher` + `category` + **related keywords**
  for v0 metadata matching — all obtainable from `searchMyAssets` + one product
  page GET, with zero new GraphQL ops. The long description is optional polish;
  if wanted later, capture the product-detail GraphQL op (carries `description`)
  via the same XHR-patch recipe used for `PreviewAssets`, triggering it with a
  client-side product navigation so it fires after the patch is installed.

### 3.5 Auth model summary
- **CSRF (double-submit):** send the `_csrf` cookie's value as the
  `x-csrf-token` header. Stripping cookies entirely (`credentials: omit`) → HTTP
  400. Every visitor, including anonymous, gets a `_csrf` cookie.
- **`PreviewAssets`:** CSRF-only. A standalone client just GETs the store once to
  obtain a `_csrf` cookie, then replays it (cookie + header). No login.
- **`searchMyAssets`:** needs the logged-in session cookies *and* CSRF.

---

## 4. Architecture Overview

```
                         ┌──────────────────────────┐
        (auth'd, once)   │   Catalog: owned IDs      │
        searchMyAssets ──▶  product id, name,        │
                         │   publisher, size, hidden │
                         └────────────┬─────────────┘
                                      │ for each owned product
               ┌──────────────────────┴──────────────────────┐
   ROUTE 1 (local, downloaded)                 ROUTE 2 (online, not downloaded)
   ┌───────────────────────────┐              ┌───────────────────────────┐
   │ walk Asset Store-5.x cache │              │ PreviewAssets(id, page)   │
   │ stream tar → pathname[]    │              │ flat assets[] → paths     │
   │ recurse nested .unitypkg   │              │ detect wrapper (opaque)   │
   └────────────┬──────────────┘              └────────────┬──────────────┘
                └───────────────┬───────────────────────────┘
                                ▼
                    ┌────────────────────────┐
                    │  Unified index (SQLite  │
                    │  FTS5): paths + metadata │
                    └────────────┬────────────┘
                                 ▼
                 keyword query → ranked file/asset hits
                                 ▼
        local? → reveal/ping file   |   online? → open store link
                                 └── optional: download → recursive unpack → local
```

Two routes feed **one** index. A product is "deep-indexed" if we have its real
file paths (local always; online except wrappers); otherwise it sits in the index
at product level (name/metadata only) and is upgraded on download.

---

## 5. Pipeline / Components

1. **Auth & catalog fetch**
   - Obtain the owned product list via `searchMyAssets` (visible + hidden).
   - Standalone: get the session via a one-time browser-console exporter snippet
     (à la the community GCR scanner) that dumps `myassets.json`, *or* a
     cookie-import step. Editor route: read Package Manager "My Assets" directly
     (no web auth — see §8).
   - CSRF helper: fetch a `_csrf` cookie, expose token for subsequent calls.

2. **Local cache discovery**
   - Resolve `Asset Store-5.x` per-OS path; honor user override + Unity's
     cache-location config. Walk `Publisher/Category/*.unitypackage`.

3. **Local indexer**
   - For each `.unitypackage`: gunzip + tar-stream, collect `pathname` members.
   - Recurse into nested `.unitypackage` `asset` blobs (tar-in-tar) for wrappers.
   - Emit `(productKey, publisher, fullPath, fileType, source=local)`.
   - Cache parse results keyed by file mtime/size so re-scans are incremental.

4. **Online content fetch**
   - For owned-but-not-downloaded products: `PreviewAssets(id, page)`, page until
     empty, reconstruct full paths from `level`.
   - Detect wrapper (leaves are only `.unitypackage`/readme) → mark
     `coverage=shallow`, queue for lazy deep-index.

5. **Metadata enrichment**
   - Index `name`, `publisher`, `downloadSize` from `searchMyAssets`; add
     `category` + **related keywords** from a single product-page GET (§3.4).
     Long description optional/deferred.

6. **Index store & search**
   - SQLite with FTS5. Global index (one DB in a user data dir) shared across all
     projects. Last-write-wins on re-index.

7. **Query & result actions**
   - Tokenized FTS query over paths + metadata; rank by match quality + group by
     product; show preview/type.
   - **Local hit:** reveal in file manager / (editor route) ping in Project.
   - **Online hit:** open the store product URL.
   - **Download action — resolved:** do **not** replicate Unity's authenticated
     download in v0. Modern downloads are handled by the Package Manager under the
     logged-in Unity ID (there is no clean public `.unitypackage` URL; standalone
     replication would mean handling Unity credentials — bad UX/security for a
     public tool). Instead:
     1. Emit the deep link `com.unity3d.kharma:content/<productId>` (the same
        scheme the store's *"Open in Unity"* button uses). This opens the Unity
        Package Manager focused on that asset.
     2. The user clicks **Download** once in Package Manager; Unity downloads it
        (authenticated) into the `Asset Store-5.x` cache.
     3. A **cache file-watcher** detects the new `.unitypackage`, runs the
        recursive unpack (§3.2–3.3), and flips the product to
        `source=local, coverage=deep`.
     This delivers "download → locally searchable" with no credential handling,
     reusing Unity's own auth. (Phase-2 options: a tiny optional Unity editor
     companion that batch-downloads — cf. *UnityAssetRetriever* — or headless
     authenticated download once that flow is captured from a logged-in session.)

---

## 6. Index Schema (sketch)

```sql
-- products: one row per owned asset
products(
  product_id   TEXT PRIMARY KEY,   -- store id
  name         TEXT,
  publisher    TEXT,
  category     TEXT,
  description  TEXT,
  tags         TEXT,
  download_size INTEGER,
  is_hidden    INTEGER,
  is_wrapper   INTEGER,            -- nested-package asset
  coverage     TEXT,               -- 'deep' | 'shallow'
  source       TEXT,               -- 'local' | 'online'
  store_url    TEXT,
  local_path   TEXT,               -- path to .unitypackage if downloaded
  indexed_at   INTEGER
)

-- files: one row per file inside a product
files(
  id           INTEGER PRIMARY KEY,
  product_id   TEXT REFERENCES products(product_id),
  full_path    TEXT,               -- reconstructed, e.g. Pack/UI/click_01.wav
  file_name    TEXT,
  ext          TEXT,               -- inferred type bucket: audio/model/prefab/...
  nested_pkg   TEXT,               -- which inner .unitypackage it came from, if any
  source       TEXT                -- 'local' | 'online'
)

-- FTS5 virtual table over the searchable text
files_fts USING fts5(
  full_path, file_name, product_name, publisher, description, tags,
  content='...'   -- external-content table mapping to files+products
)
```

---

## 7. Search behavior

- Match on file path/name **and** product metadata (name, publisher,
  description, tags) so *"sci-fi crate"* hits an fbx whose path is generic but
  whose pack description says "sci-fi."
- Default ranking: exact filename > path segment > metadata; boost files whose
  product is already local (actionable now).
- Group results by product; collapse mega bundles; show file type + preview when
  available.
- Filters: type bucket (audio/model/prefab/texture/script), local-only,
  publisher.

---

## 8. Key Decision — Unity Editor Tool vs Standalone App

This is the main open architectural choice. Both are viable; they trade auth and
import convenience against build velocity and reach.

| Dimension | Unity Editor tool (C#) | Standalone app (Node/Python + web UI) |
|---|---|---|
| Catalog auth | **Free** — read Package Manager "My Assets" in-editor, no CSRF/cookies | Friction — needs logged-in session via console-exporter or cookie import |
| Content (not-downloaded) | Same web endpoints (`PreviewAssets`) anyway | Same web endpoints |
| Local cache parse (tar, recurse) | Doable (SharpZipLib + gzip), more friction | **Easy** — native gzip/tar/SQLite in Node/Python |
| Search index (SQLite FTS5) | Workable but fiddly in Unity's runtime | **First-class** |
| Result → use asset | **Native one-click import + Project ping** | Reveal file / open package (Unity imports on double-click) |
| Cross-project reuse | Per-project unless packaged as UPM w/ global index | **Global by nature** — runs once for all projects |
| Runs without opening Unity | No | **Yes** |
| Build velocity (for King) | C# professional, but heavier for this stack | **High** — matches recent React+Vite+Express experience |
| OSS distribution / contribution | UPM/.unitypackage; Unity-only audience | npm/binary; broader audience, easier PRs |
| UI effort | IMGUI or UI Toolkit | Web UI, fastest to make nice |

**The editor tool's two genuine wins:** auth-free catalog (Package Manager API)
and native one-click import. **The standalone's wins:** build velocity, a global
cross-project index, runs without Unity, and broader open-source reach — and the
heavy lifting (tar parsing, recursive unpack, FTS) is markedly easier outside
Unity's runtime.

### Decision: **Standalone core engine** (chosen) — optional editor companion later

Standalone Node engine is the chosen path. Rationale:
- The hard, differentiated work (cache discovery, tar streaming, recursive
  nested unpack, FTS index, endpoint fetching with pagination) is fastest and
  cleanest as a standalone Node (or Python) engine — and plays to current
  strengths.
- A **global, cross-project** index fits the actual use case (and the broader
  "reusable across projects" mindset) better than a per-project editor tool.
- Auth friction is a *one-time* console-export step, not an ongoing cost.
  `PreviewAssets` needs no login at all.
- The lost "one-click import" is acceptable for v0: revealing the cached
  `.unitypackage` is enough — Unity's Package Manager picks it up. Import
  convenience is the right reason to add a **thin editor companion in phase 2**
  (an `EditorWindow` that queries the standalone engine's local API/index and
  adds in-editor search + native import), without rewriting the engine in C#.

**Revisit a pure editor tool only if** priorities later shift to strictly Unity
devs who value zero-setup auth + native import above reach/velocity — at higher
build cost and narrower audience. For now: standalone.

---

## 9. Roadmap / Phases

- **Phase 0 — Spike (done):** verify endpoints + format. ✅ `PreviewAssets` and
  the `.unitypackage` path-flatten pipeline confirmed working end to end.
- **Phase 1 — Standalone core:**
  catalog import → local cache scan + tar parse → online `PreviewAssets` fetch →
  SQLite FTS over paths → CLI/local-web search → reveal/open actions.
- **Phase 2 — Convenience:**
  capture + index the metadata/description query; download-to-local with
  recursive unpack; wrapper lazy deep-indexing; nicer UI.
- **Phase 3 — Editor companion (optional):**
  `EditorWindow` with in-editor search + one-click import, backed by the engine.
- **Later / stretch:** semantic search (embeddings), audio content tagging,
  thumbnail/vision tagging, UPM-package coverage.

---

## 10. Risks & Open Questions

**Resolved**
- ~~Download URL~~ → **Resolved (§5.7):** don't replicate auth'd download; emit
  `com.unity3d.kharma:content/<id>` to Package Manager + watch the cache.
- ~~Metadata query~~ → **Resolved (§3.4):** index keywords/category/publisher/name
  from catalog + product-page GET; description deferred.
- **Catalog auth UX** → decided: **console-export snippet** (transparent,
  inspectable, à la the GCR scanner) dumps the owned list; no credential handling.

**Remaining / to watch**
- **Undocumented endpoints** (`searchMyAssets`, `PreviewAssets`) can change. Keep
  operation strings in one module; document the DevTools/XHR-patch re-capture
  recipe in the README.
- **Rate limiting / ToS:** throttle and cache aggressively; personal-library
  scale only. Don't hammer the store.
- **`PreviewAssets` page size:** confirm exact size so the paging loop stops
  correctly (current heuristic: "page shorter than N ⇒ last").
- **UPM-format Asset Store content:** out of scope for v0; revisit.
- **`kharma` scheme robustness:** confirm the exact scheme on current Unity
  (`com.unity3d.kharma:content/<id>`; a `com.unity.kharma` variant also appears in
  the wild) and that Package Manager focuses the asset reliably.

---

## 11. Legal / ToS notes (for a public repo)

- The tool indexes only metadata and file *paths*: locally for packages the user
  has downloaded, and online via the store's own public content preview. It does
  **not** redistribute or rehost asset contents.
- It uses **undocumented** store endpoints that may change without notice; state
  this clearly in the README.
- Add throttling + a clear notice that users are responsible for complying with
  the Unity Asset Store Terms of Service.

---

## Appendix A — Endpoint quick reference

Reusable browser snippet that fetches and flattens one product's tree
(`PreviewAssets`, CSRF-only, no login). Run in the console on any store page, or
port to Node by supplying a `_csrf` cookie:

```js
async function getTree(id) {
  const csrf = decodeURIComponent(
    (document.cookie.split(';').map(c=>c.trim())
      .find(c=>c.startsWith('_csrf='))||'').split('=')[1]||'');
  const q = "query PreviewAssets($id: ID!, $page: Int){ product(id:$id){ id name assets(page:$page){ guid assetId: asset_id label level type } } }";
  let all = [], page = 0;
  while (true) {
    const r = await fetch("https://assetstore.unity.com/api/graphql/batch", {
      method:"POST", credentials:"include",
      headers:{ "Content-Type":"application/json", "x-requested-with":"XMLHttpRequest",
                "x-source":"storefront", "operations":"PreviewAssets", "x-csrf-token":csrf },
      body: JSON.stringify([{ query:q, variables:{id, page}, operationName:"PreviewAssets" }])
    });
    const a = (await r.json())[0]?.data?.product?.assets || [];
    if (!a.length) break;
    all = all.concat(a);
    if (a.length < 50) break;   // tune to real page size
    page++;
  }
  const stack = [], files = [];
  for (const n of all) {
    stack[n.level] = n.label; stack.length = n.level + 1;
    if (n.type === "file") files.push(stack.join("/"));
  }
  return files;   // e.g. ["Pack/Scripts/API/HTTP/HttpClient.cs", ...]
}
```

**Decisions log (condensed):**
1. v0 = filename/path + metadata text search; no semantic/content analysis.
2. Two path sources feed one index: local cache + `PreviewAssets`. Download not
   required to search.
3. Catalog via `searchMyAssets` (auth'd, once); content via `PreviewAssets`
   (CSRF-only, public).
4. Local parse streams tar `pathname` members; recurse nested `.unitypackage`
   blobs for wrappers.
5. Wrapper assets are opaque online → shallow-indexed, deep-indexed lazily on
   download (one-step recursive unpack).
6. SQLite FTS5; single global index across projects.
7. Result actions: reveal local / open store link / download-to-local.
8. **Standalone Node core engine (decided).** Thin Unity editor companion only
   later, if native import is wanted.
9. Catalog auth via a transparent **browser console-export** snippet; no
   credential handling in the tool. `PreviewAssets` needs no login.
10. Metadata search uses **name + publisher + category + related keywords**
    (catalog + product-page GET); long description deferred.
11. **Download-to-local via `com.unity3d.kharma:content/<id>`** (opens Package
    Manager) + a **cache file-watcher** that auto-deep-indexes the new package.
    No standalone auth'd download in v0.

**Prior art / references:**
- *GCR Asset Scanner* (iyedbhd) — console export of `searchMyAssets` (catalog
  pattern reused here).
- *UnityAssetRetriever* (Renge-Games) — editor tool for batch download+import
  (model for a possible phase-3 companion).
- `kl0tl` / `mukaschultze` `unity-asset-store-api`, `se0kjun/UnityAssetstoreAPI`
  — older store API wrappers (auth patterns, run-time download precedent).
