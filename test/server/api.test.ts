import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { AssetLensEngine } from "../../src/engine.js";
import { createGuiServer } from "../../src/server/server.js";
import { resolveWebRoot } from "../../src/server/webRoot.js";
import { catalogProduct, indexedProduct } from "../helpers/db.js";

/**
 * End-to-end tests of the GUI HTTP API against a live loopback server backed by
 * an in-memory engine (no network, no spawned OS commands).
 */

const ENV = { platform: "linux" as NodeJS.Platform, home: "/tmp/al", env: {} };

let engine: AssetLensEngine;
let server: Server;
let base: string;

beforeAll(async () => {
  engine = AssetLensEngine.open({ dbPath: ":memory:", env: ENV });
  // A downloaded local product with files + keywords...
  engine.repo.writeIndexedProduct(
    indexedProduct({
      product: catalogProduct({ id: "sfx", name: "UI SFX Pack", publisher: "Cyberwave" }),
      source: "local",
      localPath: "/cache/Cyberwave/Audio/UI SFX Pack.unitypackage",
      tags: ["ui", "click", "sound"],
      paths: ["Assets/UI/Click_01.wav", "Assets/UI/Hover.wav", "Assets/UI/Icon.png"],
    }),
    1,
  );
  // ...and an owned-but-not-downloaded online product (metadata only).
  engine.repo.importCatalog(
    [catalogProduct({ id: "temple", name: "Toon Temples", publisher: "Polytope" })],
    1,
  );

  server = createGuiServer({ engine, webRoot: resolveWebRoot() });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  engine.close();
});

describe("GET /api/overview", () => {
  it("reports stats, buckets, keywords and publishers", async () => {
    const res = await fetch(`${base}/api/overview`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.stats.products).toBe(2);
    expect(body.stats.files).toBe(3);
    expect(body.ready).toBe(true);
    const buckets = Object.fromEntries(body.buckets.map((b: { bucket: string; count: number }) => [b.bucket, b.count]));
    expect(buckets.audio).toBe(2);
    expect(buckets.texture).toBe(1);
    expect(body.keywords.map((k: { keyword: string }) => k.keyword)).toContain("ui");
    expect(body.publishers).toContain("Cyberwave");
    expect(body.publishers).toContain("Polytope");
  });
});

describe("GET /api/search", () => {
  it("returns grouped file hits for a query", async () => {
    const res = await fetch(`${base}/api/search?q=click`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.query).toBe("click");
    expect(body.groups.length).toBeGreaterThan(0);
    expect(body.groups[0].productName).toBe("UI SFX Pack");
    expect(body.totalFiles).toBeGreaterThan(0);
  });

  it("honours the type filter", async () => {
    const res = await fetch(`${base}/api/search?q=ui&type=texture`);
    const body = await res.json() as any;
    const buckets = body.groups.flatMap((g: { hits: { typeBucket: string }[] }) => g.hits.map((h) => h.typeBucket));
    expect(buckets.every((b: string) => b === "texture")).toBe(true);
  });

  it("returns an empty result for a blank query", async () => {
    const body = await (await fetch(`${base}/api/search?q=`)).json() as any;
    expect(body.groups).toEqual([]);
    expect(body.totalFiles).toBe(0);
  });

  it("rejects an invalid type filter", async () => {
    const res = await fetch(`${base}/api/search?q=ui&type=bogus`);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/action", () => {
  it("rejects a malformed action", async () => {
    const res = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses to reveal a not-downloaded product", async () => {
    const res = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "reveal", productId: "temple" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not downloaded/i);
  });
});

describe("session status", () => {
  it("reports logged-out when no session is saved", async () => {
    const res = await fetch(`${base}/api/session`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.loggedIn).toBe(false);
    expect(body.email).toBeNull();
  });

  it("logout returns a logged-out status", async () => {
    const res = await fetch(`${base}/api/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.loggedIn).toBe(false);
  });
});

describe("static + SPA fallback", () => {
  it("serves the app shell at /", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("AssetLens");
  });

  it("serves module assets with a JS content type", async () => {
    const res = await fetch(`${base}/js/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("falls back to the shell for extension-less routes", async () => {
    const res = await fetch(`${base}/some/spa/route`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("404s an unknown API route", async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
  });
});
