import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname } from "node:path";
import type { AssetLensEngine } from "../engine.js";
import { handleApi } from "./api.js";
import { serveStatic } from "./static.js";
import { sendError } from "./http.js";

/**
 * Compose the GUI HTTP server: `/api/*` routes go to the JSON/SSE API, every
 * other path is served from the static web root, with an SPA fallback to
 * `index.html` for extension-less paths.
 */

export interface GuiServerDeps {
  readonly engine: AssetLensEngine;
  readonly webRoot: string;
}

export function createGuiServer(deps: GuiServerDeps): Server {
  return createServer((req, res) => {
    void route(deps, req, res).catch((err: unknown) => {
      if (res.headersSent) res.end();
      else sendError(res, 500, (err as Error).message);
    });
  }).on("clientError", (_err, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
}

async function route(
  deps: GuiServerDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (await handleApi(deps.engine, req, res, url)) return;
  if (await serveStatic(deps.webRoot, url.pathname, res)) return;

  // SPA fallback: extension-less GET paths resolve to the app shell.
  if ((req.method ?? "GET") === "GET" && extname(url.pathname) === "") {
    if (await serveStatic(deps.webRoot, "/index.html", res)) return;
  }
  sendError(res, 404, `Not found: ${url.pathname}`);
}
