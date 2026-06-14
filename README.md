# AssetLens

> Keyword search over your **entire owned Unity Asset Store library**, at the
> individual-file level. Type *"ui click sound"* and find the exact file across
> everything you own — including mega bundles with thousands of files — whether
> or not it's downloaded yet.

AssetLens is the **standalone Node core engine** described in
[`unity-asset-search-spec.md`](./unity-asset-search-spec.md) (Phase 1). It builds
one global SQLite full-text index from two sources and searches across both:

- **Local** — your downloaded `.unitypackage` cache, streamed and indexed at the
  file level (with recursive unpacking of nested render-pipeline *wrapper*
  packages).
- **Online** — the store's public `PreviewAssets` content tree for assets you
  own but haven't downloaded.

It indexes only **metadata and file paths** you're entitled to. It never rehosts
or redistributes asset contents.

---

## Install

```bash
npm install
npm run build      # -> dist/ (also: npm link to get the `assetlens` command)
```

Requires Node ≥ 20. Uses `better-sqlite3` (FTS5) and `tar-stream`.

During development you can run the CLI without building:

```bash
npm run cli -- <command> [args]
```

## Quick start

```bash
# 1. Sign in and import your owned catalog (also collects each product's
#    store-page keywords). Opens a browser window at Unity's own login page;
#    AssetLens never sees your password (see Authentication).
assetlens login

# 2. Index your downloaded .unitypackage cache (auto-detected per OS)
assetlens scan

# 3. (optional) Pull file trees for owned-but-not-downloaded assets
assetlens fetch

# 3b. (optional) Re-pull each product's store-page Related keywords — e.g. after
#     an upgrade changed the extractor. --force refreshes products already tagged.
assetlens enrich --force

# 4. Search
assetlens search ui click sound
assetlens search "sci-fi crate" --type model --local
```

### Web GUI

Prefer a window over the terminal? Launch the local web GUI (spec §8) — it wraps
the same engine with a browser front-end for search, the setup steps, the
library snapshot (asset-type breakdown + keyword cloud), and result actions:

```bash
assetlens serve                 # starts the GUI and opens your browser
assetlens serve --port 8080     # pick the port (default 4317)
assetlens serve --no-open       # don't auto-open the browser
```

The GUI is a dependency-free static front-end served over loopback; nothing is
sent anywhere. The same `--db` / `--cache-root` overrides apply. Embed it from
code with `startGuiServer({ port })` — see [`src/server`](./src/server).

### Result actions

```bash
assetlens reveal <fileId>       # reveal the cached .unitypackage in your file manager
assetlens open <productId>      # open the store product page
assetlens download <productId>  # open Unity Package Manager to download it
assetlens watch                 # auto-index packages as Unity finishes downloading them
```

`reveal`/`open`/`download` ids come from the bracketed numbers and product ids in
`assetlens search` output.

## Authentication (the only setup step)

Listing your owned catalog needs your logged-in Unity session. **AssetLens never
handles your credentials** — the password only ever goes into Unity's own login
page.

```bash
assetlens login                 # opens a browser, you log in, catalog imports automatically
assetlens login --no-remember   # don't persist the session to disk
assetlens logout                # forget the saved session
```

AssetLens opens a real browser window pointed at Unity's sign-in page. You log
in there normally (SSO, 2FA, social login all work). Once you're authenticated
it reads your owned-product list from the same `CurrentUser` request the My
Assets page makes, resolves each product's details, and imports them — no
DevTools, no JSON file. By default the session is remembered locally (in the
data dir, see below) so you usually skip the login screen next time; `logout`
clears it.

This uses [Playwright](https://playwright.dev) driving your **already-installed
default browser** (Chrome or Edge — no separate browser download).
`playwright-core` is an *optional* dependency: install it once with
`npm install playwright-core` if it wasn't installed automatically.

> You can also import a previously captured catalog JSON with
> `assetlens import <file.json>` — it accepts a bare array of product nodes
> (`{ id, name, publisher, … }`).

Fetching public content (`PreviewAssets`) needs **no login** — AssetLens fetches
a `_csrf` cookie anonymously. (For sites/regions that require it, you can pass a
cookie header with `--cookie`.)

## How it works

| Stage | Spec | Notes |
|---|---|---|
| Browser login | §5.1, §9 | Drives your installed default browser to Unity's login page; sniffs the owned IDs from the `CurrentUser` response, then batches `Product` queries for details — no credential handling. Session persisted locally (cleared by `logout`) |
| Catalog import | §5.1 | Tolerant parser for a captured catalog JSON (bare array of product nodes) |
| Store-page keywords | §3.4 | As part of import, one public product-page GET per product adds its **category + related keywords** — the best signal for keyword matching (powers the GUI keyword cloud). No description, no auth |
| Local scan | §3.1–3.3, §5.2/3 | Per-OS cache path; streams tar reading only `pathname` members; recurses nested `.unitypackage` wrapper blobs (tar-in-tar); incremental by mtime/size |
| Online fetch | §3.4, §5.4 | `PreviewAssets` pagination + path reconstruction; wrappers are opaque online → `coverage = shallow` |
| Index & search | §6, §7 | SQLite FTS5; ranking *filename > path > metadata* with a local-product boost; group by product; filters by type/local/publisher; product-level metadata hits for not-yet-indexed assets |
| Actions | §5.7, §7 | Reveal file / open store / `com.unity3d.kharma:` download deep link + cache watcher |

### Configuration

- `--db <path>` / `ASSETLENS_DATA_DIR` — index database location. The remembered
  browser session (`session.json`) lives alongside it in the data dir.
- `--cache-root <path>` / `ASSETLENS_CACHE_ROOT` — Asset Store cache override
  (the location is user-overridable in Unity — spec §3.1).

Default cache roots:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Unity\Asset Store-5.x` |
| macOS | `~/Library/Unity/Asset Store-5.x` |
| Linux | `~/.local/share/unity3d/Asset Store-5.x` |

## Library API

```ts
import { AssetLensEngine } from "assetlens";

const engine = AssetLensEngine.open();
await engine.loginAndImport(); // browser sign-in → owned catalog imported
await engine.scanLocal();
const results = engine.search("ui click sound", { typeBucket: "audio" });
engine.close();
```

The package also exports the lower-level pieces (`parseUnityPackageFile`,
`fetchOnlineProductTree`, `Repository`, `searchFiles`, …) — see
[`src/index.ts`](./src/index.ts).

## Limitations & notes

- AssetLens uses **undocumented** store operations (`CurrentUser`, `Product`,
  `PreviewAssets`) that may change without notice. The operation strings live in
  one place — [`src/store/constants.ts`](./src/store/constants.ts). If they
  break, re-capture them from DevTools → Network (filter `graphql/batch`) and
  update that module.
- **UPM-format** Asset Store content (stored in the global package cache) is out
  of scope for v0 (spec §3.1).
- Be a good citizen: AssetLens throttles online requests and caches aggressively.
  You are responsible for complying with the
  [Unity Asset Store Terms of Service](https://unity.com/legal/as-terms).

## Development

```bash
npm test            # run the unit test suite (vitest)
npm run test:coverage
npm run typecheck
```

## License

MIT — see [LICENSE](./LICENSE).
