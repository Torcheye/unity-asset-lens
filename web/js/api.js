// Thin client for the AssetLens GUI API (see src/server/api.ts). Every call
// fails loudly with the server's `{ error }` message so the UI can surface it.

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function getOverview() {
  return getJson("/api/overview");
}

/** Saved-login status: { loggedIn, email, ownedCount, importedAt }. */
export function getSession() {
  return getJson("/api/session");
}

/** Forget the saved login session. Returns the new (logged-out) status. */
export async function logout() {
  const res = await fetch("/api/logout", {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Logout failed (${res.status})`);
  return data;
}

export function search({ query, type, local, publisher }) {
  const params = new URLSearchParams({ q: query });
  if (type && type !== "all") params.set("type", type);
  if (local) params.set("local", "true");
  if (publisher && publisher !== "all") params.set("publisher", publisher);
  return getJson("/api/search?" + params.toString());
}

export async function runAction(kind, productId) {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, productId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Action failed (${res.status})`);
  return data;
}

/** Reveal a single indexed file (folder hits open the exact file). */
export async function revealFile(fileId) {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "reveal", fileId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Action failed (${res.status})`);
  return data;
}

// ── registered local folders ───────────────────────────────────────────────

/** List registered folders: { folders: [{ path, name, fileCount, totalSize, status, … }] }. */
export function getFolders() {
  return getJson("/api/folders");
}

/** Open the native OS folder picker. Returns the chosen path, or null if cancelled. */
export async function pickFolder() {
  const res = await fetch("/api/folders/pick", {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Folder picker failed (${res.status})`);
  return data.path;
}

/** Unregister a folder. Returns the updated { folders }. */
export async function removeFolder(path) {
  const res = await fetch("/api/folders/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Remove failed (${res.status})`);
  return data;
}

/**
 * Scan + index a folder, streaming progress over SSE. `mode` is "add" (new) or
 * "rescan" (existing). `handlers` = { onProgress, onDone(folder), onError }.
 * Returns a function that cancels the stream.
 */
export function scanFolder(path, mode, handlers) {
  const params = new URLSearchParams({ path });
  if (mode === "rescan") params.set("mode", "rescan");
  const es = new EventSource("/api/folders/scan?" + params.toString());
  const close = () => es.close();
  es.addEventListener("progress", (e) => {
    handlers.onProgress?.(JSON.parse(e.data));
  });
  es.addEventListener("done", (e) => {
    close();
    handlers.onDone?.(JSON.parse(e.data).folder);
  });
  es.addEventListener("error", (e) => {
    close();
    const msg = e.data ? JSON.parse(e.data).message : "Connection lost";
    handlers.onError?.(msg);
  });
  return close;
}

/**
 * Run a setup step, streaming progress over SSE. Returns a function that
 * cancels the stream. `handlers` = { onProgress, onAccount, onDone, onError }.
 * `onAccount` fires mid-stream (sign-in step) with the saved-login status.
 */
export function runStep(name, handlers) {
  const es = new EventSource(`/api/steps/${name}`);
  const close = () => es.close();
  es.addEventListener("progress", (e) => {
    // Payload is { message, current, total } — current/total drive the bar,
    // message is the human-readable line (older steps may omit the counts).
    handlers.onProgress?.(JSON.parse(e.data));
  });
  es.addEventListener("account", (e) => {
    handlers.onAccount?.(JSON.parse(e.data));
  });
  es.addEventListener("done", (e) => {
    close();
    handlers.onDone?.(JSON.parse(e.data).detail);
  });
  es.addEventListener("error", (e) => {
    close();
    const msg = e.data ? JSON.parse(e.data).message : "Connection lost";
    handlers.onError?.(msg);
  });
  return close;
}
