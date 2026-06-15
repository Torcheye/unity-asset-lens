import type { IncomingMessage, ServerResponse } from "node:http";
import type { AssetLensEngine } from "../engine.js";
import type { FileTypeBucket } from "../domain/types.js";
import type { SearchOptions } from "../index/search.js";
import type { OsCommand } from "../actions/actions.js";
import { sendJson, sendError, readJsonBody } from "./http.js";
import { buildOverview } from "./overview.js";
import { isStepName, runStep } from "./steps.js";
import { runFolderScan } from "./folders.js";

/**
 * JSON + SSE API backing the GUI. Every engine capability the browser needs is
 * exposed here as a small route; the browser holds no SQLite and runs no OS
 * commands itself (those stay server-side via the engine actions).
 */

const TYPE_BUCKETS: ReadonlySet<string> = new Set<FileTypeBucket>([
  "audio", "model", "prefab", "texture", "script", "animation",
  "material", "scene", "shader", "font", "video", "data", "package", "other",
]);

const ACTION_KINDS = new Set(["reveal", "open", "download"]);

/**
 * Handle an `/api/...` request. Returns true if the route was recognised (a
 * response was sent or is streaming); false to let the caller serve statics.
 */
export async function handleApi(
  engine: AssetLensEngine,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;
  const method = req.method ?? "GET";

  if (path === "/api/overview" && method === "GET") {
    sendJson(res, 200, buildOverview(engine));
    return true;
  }

  if (path === "/api/session" && method === "GET") {
    sendJson(res, 200, await engine.sessionStatus());
    return true;
  }

  if (path === "/api/logout" && method === "POST") {
    await engine.logout();
    sendJson(res, 200, await engine.sessionStatus());
    return true;
  }

  if (path === "/api/search" && method === "GET") {
    handleSearch(engine, res, url);
    return true;
  }

  if (path === "/api/action" && method === "POST") {
    await handleAction(engine, req, res);
    return true;
  }

  if (path === "/api/folders" && method === "GET") {
    sendJson(res, 200, { folders: await engine.listLocalFolders() });
    return true;
  }

  if (path === "/api/folders/pick" && method === "POST") {
    try {
      sendJson(res, 200, { path: await engine.pickFolder() });
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
    return true;
  }

  if (path === "/api/folders/remove" && method === "POST") {
    await handleFolderRemove(engine, req, res);
    return true;
  }

  if (path === "/api/folders/scan" && method === "GET") {
    const folderPath = url.searchParams.get("path") ?? "";
    if (!folderPath) {
      sendError(res, 400, "Missing ?path=");
      return true;
    }
    const mode = url.searchParams.get("mode") === "rescan" ? "rescan" : "add";
    await runFolderScan(engine, folderPath, mode, res);
    return true;
  }

  const stepMatch = /^\/api\/steps\/([a-z]+)$/.exec(path);
  if (stepMatch && method === "GET") {
    const name = stepMatch[1]!;
    if (!isStepName(name)) {
      sendError(res, 404, `Unknown step: ${name}`);
      return true;
    }
    await runStep(engine, name, res);
    return true;
  }

  sendError(res, 404, `No such API route: ${method} ${path}`);
  return true;
}

function handleSearch(
  engine: AssetLensEngine,
  res: ServerResponse,
  url: URL,
): void {
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!query) {
    sendJson(res, 200, { query: "", groups: [], totalFiles: 0 });
    return;
  }

  const opts: SearchOptions = {};
  const type = url.searchParams.get("type");
  if (type && type !== "all") {
    if (!TYPE_BUCKETS.has(type)) {
      sendError(res, 400, `Invalid type filter: ${type}`);
      return;
    }
    (opts as { typeBucket?: FileTypeBucket }).typeBucket = type as FileTypeBucket;
  }
  if (url.searchParams.get("local") === "true") {
    (opts as { localOnly?: boolean }).localOnly = true;
  }
  const publisher = url.searchParams.get("publisher");
  if (publisher && publisher !== "all") {
    (opts as { publisher?: string }).publisher = publisher;
  }
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  if (Number.isFinite(limit) && limit > 0) {
    (opts as { limit?: number }).limit = limit;
  }

  const groups = engine.search(query, opts);
  const totalFiles = groups.reduce((sum, g) => sum + g.totalHits, 0);
  sendJson(res, 200, { query, groups, totalFiles });
}

async function handleAction(
  engine: AssetLensEngine,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: { kind?: unknown; productId?: unknown; fileId?: unknown };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch (err) {
    sendError(res, 400, (err as Error).message);
    return;
  }
  const kind = typeof body.kind === "string" ? body.kind : "";
  const productId = typeof body.productId === "string" ? body.productId : "";
  const fileId = typeof body.fileId === "number" ? body.fileId : undefined;
  if (!ACTION_KINDS.has(kind)) {
    sendError(res, 400, "Expected { kind: reveal|open|download, productId | fileId }");
    return;
  }
  // `reveal` may target a single file (folder hits open the exact file) or a
  // whole product (open the downloaded package / folder root).
  if (kind === "reveal" && fileId !== undefined) {
    await runAction(res, () => engine.revealFile(fileId));
    return;
  }
  if (!productId) {
    sendError(res, 400, "Expected { kind, productId }");
    return;
  }
  await runAction(res, () => {
    if (kind === "reveal") return engine.revealProduct(productId);
    if (kind === "download") return engine.download(productId);
    return engine.openStoreForProduct(productId);
  });
}

/** Run an action that yields an OsCommand and report it (or its error). */
async function runAction(
  res: ServerResponse,
  act: () => Promise<OsCommand>,
): Promise<void> {
  try {
    const command = await act();
    sendJson(res, 200, {
      command,
      display: `${command.cmd} ${command.args.join(" ")}`.trim(),
    });
  } catch (err) {
    sendError(res, 409, (err as Error).message);
  }
}

async function handleFolderRemove(
  engine: AssetLensEngine,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: { path?: unknown };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch (err) {
    sendError(res, 400, (err as Error).message);
    return;
  }
  const folderPath = typeof body.path === "string" ? body.path : "";
  if (!folderPath) {
    sendError(res, 400, "Expected { path }");
    return;
  }
  engine.removeLocalFolder(folderPath);
  sendJson(res, 200, { folders: await engine.listLocalFolders() });
}
