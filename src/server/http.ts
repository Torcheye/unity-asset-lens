import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Tiny dependency-free HTTP helpers for the local GUI server (spec §8: a
 * standalone "local-web" UI). No framework — just JSON/text/SSE responses and a
 * bounded request-body reader.
 */

/** Map a file extension to a static content type for the GUI assets. */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  map: "application/json; charset=utf-8",
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

export function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

export function sendText(
  res: ServerResponse,
  status: number,
  text: string,
  contentType = "text/plain; charset=utf-8",
): void {
  res.writeHead(status, { "content-type": contentType });
  res.end(text);
}

/** Send a `{ error }` JSON envelope (consistent error shape across the API). */
export function sendError(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  sendJson(res, status, { error: message });
}

/** Open a Server-Sent Events stream and return a typed `emit` helper. */
export function openSse(res: ServerResponse): (event: string, data: unknown) => void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  return (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

const MAX_BODY_BYTES = 1_000_000;

/** Read and JSON-parse a request body, bounded to guard against abuse. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buf);
  }
  if (total === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Invalid JSON body");
  }
}
