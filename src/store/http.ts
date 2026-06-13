/**
 * Minimal HTTP client interface used by the store layer.
 *
 * Decoupled from global `fetch`/DOM types so the network code is trivially
 * testable with a stub, and so we control exactly which response surface the
 * rest of the engine depends on (notably `setCookies()` for CSRF capture).
 */

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  /** Values of the `Set-Cookie` response header (may be empty). */
  setCookies(): string[];
}

export interface HttpRequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export type HttpClient = (
  url: string,
  init?: HttpRequestInit,
) => Promise<HttpResponse>;

/** Default {@link HttpClient} backed by Node's global `fetch` (Node ≥18). */
export const nodeHttp: HttpClient = async (url, init) => {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
  });
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    json: () => res.json(),
    setCookies: () =>
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [],
  };
};
