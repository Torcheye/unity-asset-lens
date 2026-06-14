#!/usr/bin/env node
import { AssetLensEngine } from "../engine.js";
import type { FileTypeBucket } from "../domain/types.js";
import type { SearchOptions } from "../index/search.js";
import { sessionFromCookieHeader } from "../store/csrf.js";
import { parseArgs, flagStr, flagBool, flagInt } from "./args.js";
import { formatResults } from "./format.js";
import { startGuiServer } from "../server/index.js";

/**
 * AssetLens CLI (spec §5.7 / Phase 1): catalog import → local scan → online
 * fetch → search → result actions, over the global index.
 */

const HELP = `assetlens — search your owned Unity Asset Store library

Usage:
  assetlens login [--no-remember] [--timeout SECONDS] [--delay MS]
                                        Sign in via a browser, import your owned catalog + store-page keywords (spec §5.1)
  assetlens logout                      Forget the saved browser login session
  assetlens import <file.json> [--delay MS]
                                        Import owned catalog + store-page keywords from a captured JSON file (spec §5.1)
  assetlens scan [--force] [--no-recurse]
                                        Index downloaded .unitypackage cache (spec §5.2/3)
  assetlens fetch [--cookie <hdr>] [--limit N] [--delay MS]
                                        Fetch online file trees via PreviewAssets (spec §5.4)
  assetlens enrich [--force] [--limit N] [--delay MS]
                                        Fetch store-page Related keywords (--force re-pulls all; spec §3.4)
  assetlens search <query...> [--type T] [--local] [--publisher P] [--limit N] [--json]
                                        Search files by name + path (spec §7)
  assetlens reveal <fileId>             Reveal a downloaded file in the file manager
  assetlens open <productId>            Open the store product page
  assetlens download <productId>        Open Unity Package Manager to download (spec §5.7)
  assetlens watch                       Auto-index newly downloaded packages
  assetlens serve [--port N] [--host H] [--no-open]
                                        Launch the local web GUI (spec §8 local-web UI)
  assetlens stats                       Show index statistics
  assetlens publishers                  List indexed publishers

Global flags:
  --db <path>           Override the index database location
  --cache-root <path>   Override the Asset Store cache root (spec §3.1)

Types: audio model prefab texture script animation material scene shader font video data package other`;

function progress(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function run(argv: string[]): Promise<number> {
  const { command, positionals, flags } = parseArgs(argv);
  if (!command || command === "help" || flagBool(flags, "help")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const engine = AssetLensEngine.open({
    ...(flagStr(flags, "db") ? { dbPath: flagStr(flags, "db") } : {}),
    ...(flagStr(flags, "cache-root")
      ? { cacheRoot: flagStr(flags, "cache-root") }
      : {}),
  });

  try {
    switch (command) {
      case "login": {
        const timeoutSec = flagInt(flags, "timeout");
        process.stdout.write(
          "Opening a browser window for Unity sign-in. Log in there — " +
            "AssetLens never sees your password.\n",
        );
        const result = await engine.loginAndImport({
          remember: !flagBool(flags, "no-remember"),
          onProgress: progress,
          delayMs: flagInt(flags, "delay") ?? 250,
          ...(timeoutSec !== undefined
            ? { loginTimeoutMs: timeoutSec * 1000 }
            : {}),
        });
        process.stdout.write(
          `${result.email ? `Signed in as ${result.email}. ` : ""}` +
            `Imported ${result.imported} of ${result.owned} owned products ` +
            `(store-page keywords for ${result.keywords})` +
            `${result.remembered ? "; session saved for next time" : ""}.\n`,
        );
        return 0;
      }

      case "logout": {
        await engine.logout();
        process.stdout.write(
          `Cleared saved login session (${engine.sessionStatePath}).\n`,
        );
        return 0;
      }

      case "import": {
        const file = positionals[0];
        if (!file) throw new Error("Usage: assetlens import <file.json>");
        const { imported, skipped, keywords } = await engine.importCatalogFile(
          file,
          { onProgress: progress, delayMs: flagInt(flags, "delay") ?? 250 },
        );
        process.stdout.write(
          `Imported ${imported} products${skipped ? ` (skipped ${skipped} malformed)` : ""}` +
            `; fetched store-page keywords for ${keywords}.\n`,
        );
        return 0;
      }

      case "scan": {
        const result = await engine.scanLocal({
          force: flagBool(flags, "force"),
          recurse: flagBool(flags, "recurse", true),
          onProgress: progress,
        });
        process.stdout.write(
          `Local scan: ${result.indexed} indexed, ${result.skipped} unchanged, ` +
            `${result.matched} matched to catalog, ` +
            `${result.pruned} duplicate local entries removed, ${result.errors.length} errors ` +
            `(of ${result.scanned} packages in ${engine.cacheRoot}).\n`,
        );
        for (const e of result.errors) progress(`  ! ${e.filePath}: ${e.error}`);
        return 0;
      }

      case "fetch": {
        const cookie = flagStr(flags, "cookie");
        const session = cookie
          ? sessionFromCookieHeader(cookie)
          : await engine.anonymousSession();
        const result = await engine.fetchOnline(session, {
          ...(flagInt(flags, "limit") !== undefined
            ? { limit: flagInt(flags, "limit") }
            : {}),
          delayMs: flagInt(flags, "delay") ?? 250,
          onProgress: progress,
        });
        process.stdout.write(
          `Online fetch: ${result.deepIndexed} deep-indexed, ${result.wrappers} wrappers ` +
            `(shallow), ${result.errors.length} errors of ${result.attempted} attempted.\n`,
        );
        return 0;
      }

      case "enrich": {
        const result = await engine.enrichKeywords({
          force: flagBool(flags, "force"),
          ...(flagInt(flags, "limit") !== undefined
            ? { limit: flagInt(flags, "limit") }
            : {}),
          delayMs: flagInt(flags, "delay") ?? 250,
          onProgress: progress,
        });
        process.stdout.write(
          `Enriched Related keywords for ${result.enriched} of ${result.attempted} products` +
            `${result.errors.length ? `; ${result.errors.length} errors` : ""}.\n`,
        );
        for (const e of result.errors) progress(`  ! ${e.productId}: ${e.error}`);
        return 0;
      }

      case "search": {
        const query = positionals.join(" ");
        if (!query.trim()) throw new Error("Usage: assetlens search <query...>");
        const opts: SearchOptions = {
          ...(flagStr(flags, "type")
            ? { typeBucket: flagStr(flags, "type") as FileTypeBucket }
            : {}),
          ...(flagBool(flags, "local") ? { localOnly: true } : {}),
          ...(flagStr(flags, "publisher")
            ? { publisher: flagStr(flags, "publisher") }
            : {}),
          ...(flagInt(flags, "limit") !== undefined
            ? { limit: flagInt(flags, "limit") }
            : {}),
        };
        const groups = engine.search(query, opts);
        if (flagBool(flags, "json")) {
          process.stdout.write(`${JSON.stringify(groups, null, 2)}\n`);
        } else {
          process.stdout.write(`${formatResults(query, groups)}\n`);
        }
        return 0;
      }

      case "reveal": {
        const id = flagInt({ id: positionals[0] ?? "" }, "id");
        if (id === undefined) throw new Error("Usage: assetlens reveal <fileId>");
        const cmd = await engine.revealFile(id);
        process.stdout.write(`Revealing: ${cmd.cmd} ${cmd.args.join(" ")}\n`);
        return 0;
      }

      case "open": {
        const productId = positionals[0];
        if (!productId) throw new Error("Usage: assetlens open <productId>");
        const cmd = await engine.openStoreForProduct(productId);
        process.stdout.write(`Opening: ${cmd.args.join(" ")}\n`);
        return 0;
      }

      case "download": {
        const productId = positionals[0];
        if (!productId) throw new Error("Usage: assetlens download <productId>");
        const cmd = await engine.download(productId);
        process.stdout.write(
          `Opening Unity Package Manager: ${cmd.args.join(" ")}\n`,
        );
        return 0;
      }

      case "watch": {
        process.stdout.write(
          `Watching ${engine.cacheRoot} for new downloads. Press Ctrl+C to stop.\n`,
        );
        engine.watch(
          (productId, filePath) =>
            progress(`  + indexed ${productId} from ${filePath}`),
          (err) => progress(`  ! watch error: ${err.message}`),
        );
        // Keep the process alive until interrupted.
        await new Promise<void>((resolve) => {
          process.on("SIGINT", () => resolve());
        });
        return 0;
      }

      case "serve":
      case "gui": {
        const handle = await startGuiServer({
          engine,
          ...(flagInt(flags, "port") !== undefined
            ? { port: flagInt(flags, "port") }
            : {}),
          ...(flagStr(flags, "host") ? { host: flagStr(flags, "host") } : {}),
          open: flagBool(flags, "open", true),
        });
        process.stdout.write(
          `AssetLens GUI running at ${handle.url}\nPress Ctrl+C to stop.\n`,
        );
        await new Promise<void>((resolve) => {
          process.on("SIGINT", () => {
            void handle.close().finally(() => resolve());
          });
        });
        return 0;
      }

      case "stats": {
        const s = engine.stats();
        process.stdout.write(
          `Products: ${s.products} (local ${s.localProducts}, online ${s.onlineProducts}, ` +
            `deep ${s.deepProducts})\nIndexed files: ${s.files}\nCache root: ${engine.cacheRoot}\n`,
        );
        return 0;
      }

      case "publishers": {
        for (const p of engine.listPublishers()) process.stdout.write(`${p}\n`);
        return 0;
      }

      default:
        process.stderr.write(`Unknown command: ${command}\n\n${HELP}\n`);
        return 1;
    }
  } finally {
    // `watch`/`serve`/`gui` own the engine for their whole (long-lived) run.
    if (command !== "watch" && command !== "serve" && command !== "gui") {
      engine.close();
    }
  }
}

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  });
