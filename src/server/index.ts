import type { AddressInfo } from "node:net";
import { AssetLensEngine } from "../engine.js";
import { liveEnv } from "../config/paths.js";
import { openCommand, spawnRunner } from "../actions/actions.js";
import { createGuiServer } from "./server.js";
import { resolveWebRoot } from "./webRoot.js";

/**
 * Boot the local GUI: open (or reuse) the engine, locate the static assets,
 * and start an HTTP server bound to loopback. Returns a handle with the URL and
 * a `close()` that tears down the server (and the engine, if we created it).
 */

export interface GuiServerOptions {
  readonly port?: number;
  readonly host?: string;
  /** Reuse an existing engine instead of opening one (then we won't close it). */
  readonly engine?: AssetLensEngine;
  readonly dbPath?: string;
  readonly cacheRoot?: string;
  readonly webRoot?: string;
  /** Open the URL in the default browser once listening (default true). */
  readonly open?: boolean;
}

export interface GuiServerHandle {
  readonly url: string;
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = "127.0.0.1";

export async function startGuiServer(
  opts: GuiServerOptions = {},
): Promise<GuiServerHandle> {
  const ownsEngine = !opts.engine;
  const engine =
    opts.engine ??
    AssetLensEngine.open({
      ...(opts.dbPath ? { dbPath: opts.dbPath } : {}),
      ...(opts.cacheRoot ? { cacheRoot: opts.cacheRoot } : {}),
    });

  const webRoot = resolveWebRoot(opts.webRoot);
  const server = createGuiServer({ engine, webRoot });
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => {
      server.removeListener("error", fail);
      done();
    });
  });

  const actualPort = (server.address() as AddressInfo).port;
  const url = `http://${host}:${actualPort}/`;

  if (opts.open !== false) {
    try {
      await spawnRunner(openCommand(liveEnv().platform, url));
    } catch {
      // Opening the browser is best-effort; the URL is printed by the caller.
    }
  }

  return {
    url,
    port: actualPort,
    host,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((err) => {
          if (err) return fail(err);
          if (ownsEngine) engine.close();
          done();
        });
      }),
  };
}

export { createGuiServer, type GuiServerDeps } from "./server.js";
export { resolveWebRoot } from "./webRoot.js";
export { buildOverview, type OverviewPayload } from "./overview.js";
