import type { HttpClient } from "./http.js";
import { STORE_ORIGIN } from "./constants.js";

/**
 * CSRF (double-submit) handling (spec §3.5).
 *
 * Every visitor — including anonymous — gets a `_csrf` cookie. To call the
 * GraphQL endpoint we send that cookie back *and* echo its value in the
 * `x-csrf-token` header. `PreviewAssets` needs only this; `searchMyAssets`
 * additionally needs the logged-in session cookies (supplied by the user's
 * console export).
 */

export interface StoreSession {
  /** Value echoed in the `x-csrf-token` header (decoded cookie value). */
  readonly csrfToken: string;
  /** Full `Cookie` request header (`_csrf=...` plus any session cookies). */
  readonly cookie: string;
}

/** Extract a cookie value by name from an array of `Set-Cookie` header strings. */
export function findCookieValue(
  setCookies: readonly string[],
  name: string,
): string | undefined {
  const prefix = `${name}=`;
  for (const sc of setCookies) {
    const first = sc.split(";", 1)[0]?.trim() ?? "";
    if (first.startsWith(prefix)) {
      return first.slice(prefix.length);
    }
  }
  return undefined;
}

/**
 * GET the store once to obtain a `_csrf` cookie and build an anonymous session
 * usable for `PreviewAssets` (no login required).
 */
export async function fetchAnonymousSession(
  http: HttpClient,
  origin: string = STORE_ORIGIN,
): Promise<StoreSession> {
  const res = await http(`${origin}/`, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to obtain CSRF cookie: HTTP ${res.status}`);
  }
  const raw = findCookieValue(res.setCookies(), "_csrf");
  if (!raw) {
    throw new Error(
      "Store did not set a `_csrf` cookie; the CSRF flow may have changed (spec §10).",
    );
  }
  return sessionFromCsrfCookie(raw);
}

/** Build a session from a raw `_csrf` cookie value (the `name=value` value). */
export function sessionFromCsrfCookie(rawCsrf: string): StoreSession {
  return {
    csrfToken: decodeURIComponent(rawCsrf),
    cookie: `_csrf=${rawCsrf}`,
  };
}

/**
 * Build an authenticated session from exported cookies (for `searchMyAssets`).
 * `cookieHeader` is the full `Cookie` string the user copied from a logged-in
 * session; the `_csrf` value within it is echoed as the token.
 */
export function sessionFromCookieHeader(cookieHeader: string): StoreSession {
  const pairs = cookieHeader.split(";").map((c) => c.trim());
  const csrf = pairs.find((c) => c.startsWith("_csrf="));
  if (!csrf) {
    throw new Error("Provided cookie header has no `_csrf=` value (spec §3.5).");
  }
  return {
    csrfToken: decodeURIComponent(csrf.slice("_csrf=".length)),
    cookie: cookieHeader,
  };
}
