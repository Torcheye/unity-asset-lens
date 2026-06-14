import type { IncomingMessage, ServerResponse } from "node:http";
import type { AssetLensEngine } from "../engine.js";
import type { FileTypeBucket } from "../domain/types.js";
import type { SearchOptions } from "../index/search.js";
import type { OsCommand } from "../actions/actions.js";
import { sendJson, sendError, readJsonBody } from "./http.js";
import { buildOverview } from "./overview.js";
import { isStepName, runStep } from "./steps.js";

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
  let body: { kind?: unknown; productId?: unknown };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch (err) {
    sendError(res, 400, (err as Error).message);
    return;
  }
  const kind = typeof body.kind === "string" ? body.kind : "";
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!ACTION_KINDS.has(kind) || !productId) {
    sendError(res, 400, "Expected { kind: reveal|open|download, productId }");
    return;
  }

  try {
    let command: OsCommand;
    if (kind === "reveal") command = await engine.revealProduct(productId);
    else if (kind === "download") command = await engine.download(productId);
    else command = await engine.openStoreForProduct(productId);
    sendJson(res, 200, {
      command,
      display: `${command.cmd} ${command.args.join(" ")}`.trim(),
    });
  } catch (err) {
    sendError(res, 409, (err as Error).message);
  }
}
