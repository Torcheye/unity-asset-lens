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

/**
 * Run a setup step, streaming progress over SSE. Returns a function that
 * cancels the stream. `handlers` = { onProgress, onAccount, onDone, onError }.
 * `onAccount` fires mid-stream (sign-in step) with the saved-login status.
 */
export function runStep(name, handlers) {
  const es = new EventSource(`/api/steps/${name}`);
  const close = () => es.close();
  es.addEventListener("progress", (e) => {
    handlers.onProgress?.(JSON.parse(e.data).message);
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
