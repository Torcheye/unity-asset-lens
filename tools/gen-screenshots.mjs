// Generate README screenshots of the real AssetLens web app.
//
// Serves the static `web/` front-end and drives an installed Chrome/Edge with
// Playwright, intercepting the `/api/*` routes with realistic mock data so the
// captured pixels are the actual UI — not a reproduction. Output → docs/img/.
//
//   node tools/gen-screenshots.mjs
//
// Requires: playwright-core (already a dependency) + installed Chrome or Edge.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { chromium } from "playwright-core";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB = join(ROOT, "web");
const OUT = join(ROOT, "docs", "img");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

// ── mock data ────────────────────────────────────────────────────────────────
const STATS = {
  products: 137,
  files: 48213,
  localProducts: 41,
  onlineProducts: 96,
  deepProducts: 58,
};

const OVERVIEW = {
  stats: STATS,
  buckets: [
    { bucket: "texture", count: 18650 },
    { bucket: "model", count: 9420 },
    { bucket: "prefab", count: 6110 },
    { bucket: "audio", count: 5980 },
    { bucket: "material", count: 3220 },
    { bucket: "script", count: 2540 },
    { bucket: "shader", count: 1190 },
    { bucket: "scene", count: 1103 },
  ],
  keywords: [
    { keyword: "sci-fi", count: 38 }, { keyword: "low poly", count: 35 },
    { keyword: "fantasy", count: 31 }, { keyword: "stylized", count: 29 },
    { keyword: "environment", count: 26 }, { keyword: "pbr", count: 24 },
    { keyword: "character", count: 22 }, { keyword: "modular", count: 20 },
    { keyword: "ui", count: 19 }, { keyword: "weapon", count: 17 },
    { keyword: "nature", count: 16 }, { keyword: "sound effects", count: 15 },
    { keyword: "medieval", count: 13 }, { keyword: "magic", count: 12 },
    { keyword: "terrain", count: 11 }, { keyword: "vehicle", count: 10 },
    { keyword: "horror", count: 9 }, { keyword: "particle", count: 8 },
    { keyword: "dungeon", count: 7 }, { keyword: "cartoon", count: 7 },
    { keyword: "rpg", count: 6 }, { keyword: "footsteps", count: 5 },
    { keyword: "hdrp", count: 4 }, { keyword: "skybox", count: 4 },
  ],
  publishers: [
    "Synty Studios", "Sound Forge Audio", "Pixel Audio", "BigBlast Audio",
    "Bluebird UX", "Quantum Theory", "Sci-Fi Effects", "Polygon Works",
  ],
  cacheRoot: "C:\\Users\\you\\AppData\\Roaming\\Unity\\Asset Store-5.x",
  ready: true,
};

const SESSION = {
  loggedIn: true,
  email: "you@studio.com",
  ownedCount: 137,
  importedAt: "2026-06-12T18:04:00.000Z",
};

const a = (fileId, fullPath) => ({ fileId, fullPath, typeBucket: "audio" });
const SEARCH = {
  query: "ui click sound",
  totalFiles: 20,
  groups: [
    {
      productId: "10481", productName: "UI Audio Essentials",
      publisher: "Sound Forge Audio", source: "local", coverage: "deep",
      totalHits: 12,
      hits: [
        a(10481, "Assets/UIAudioEssentials/Audio/Clicks/click_soft_01.wav"),
        a(10482, "Assets/UIAudioEssentials/Audio/Clicks/click_soft_02.wav"),
        a(10488, "Assets/UIAudioEssentials/Audio/Buttons/button_press_01.wav"),
        a(10493, "Assets/UIAudioEssentials/Audio/UI/ui_tap_light.wav"),
        a(10495, "Assets/UIAudioEssentials/Audio/Menu/menu_select.wav"),
        a(10501, "Assets/UIAudioEssentials/Audio/Toggle/toggle_on.wav"),
        a(10502, "Assets/UIAudioEssentials/Audio/Toggle/toggle_off.wav"),
        a(10510, "Assets/UIAudioEssentials/Audio/Hover/hover_blip.wav"),
      ],
    },
    {
      productId: "20733", productName: "Casual Game SFX Pack",
      publisher: "Pixel Audio", source: "local", coverage: "deep",
      totalHits: 5,
      hits: [
        a(20733, "Assets/CasualSFX/SFX/UI/ui_click.ogg"),
        a(20740, "Assets/CasualSFX/SFX/UI/click_pop.ogg"),
        a(20741, "Assets/CasualSFX/SFX/UI/soft_click.ogg"),
      ],
    },
    {
      productId: "33910", productName: "Mega Sound Bundle Vol. 2",
      publisher: "BigBlast Audio", source: "online", coverage: "shallow",
      totalHits: 0, hits: [],
    },
    {
      productId: "41205", productName: "Mobile UI Kit",
      publisher: "Bluebird UX", source: "online", coverage: "deep",
      totalHits: 3,
      hits: [
        a(41205, "Audio/UI/click.wav"),
        a(41209, "Audio/UI/tap_click.wav"),
        a(41210, "Audio/UI/button_click_soft.wav"),
      ],
    },
  ],
};

// ── tiny static server for web/ ───────────────────────────────────────────────
function startStatic() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      const file = normalize(join(WEB, p));
      if (!file.startsWith(WEB)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function launchBrowser() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try next channel */
    }
  }
  throw new Error("No installed Chrome or Edge found for Playwright to drive.");
}

async function main() {
  const { server, port } = await startStatic();
  const base = `http://127.0.0.1:${port}/`;
  const browser = await launchBrowser();

  async function newPage(width, height) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
    });
    // Seed recent-search history so the snapshot view shows the chips.
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem(
          "al-history",
          JSON.stringify(["toon water shader", "sci-fi crate", "footstep gravel", "muzzle flash"]),
        );
      } catch {}
    });
    const page = await ctx.newPage();
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const json = (obj) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
      if (url.pathname === "/api/overview") return json(OVERVIEW);
      if (url.pathname === "/api/session") return json(SESSION);
      if (url.pathname === "/api/search") return json(SEARCH);
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    return page;
  }

  async function settle(page) {
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(450);
  }

  // 1. Library snapshot (default landing — empty query → OverviewView)
  {
    const page = await newPage(1200, 880);
    await page.goto(base, { waitUntil: "networkidle" });
    await settle(page);
    await page.screenshot({ path: join(OUT, "snapshot.png") });
    await page.context().close();
  }

  // 2. Search results
  {
    const page = await newPage(1200, 900);
    await page.goto(base, { waitUntil: "networkidle" });
    await settle(page);
    await page.fill("#al-search", "ui click sound");
    await page.press("#al-search", "Enter");
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, "search.png") });
    await page.context().close();
  }

  // 3. Setup flow (navigate back to Setup; steps derive "done" from stats/session)
  {
    const page = await newPage(1200, 1080);
    await page.goto(base, { waitUntil: "networkidle" });
    await settle(page);
    await page.getByRole("button", { name: "Setup" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, "setup.png") });
    await page.context().close();
  }

  await browser.close();
  server.close();
  console.log("Wrote snapshot.png, search.png, setup.png to docs/img/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
