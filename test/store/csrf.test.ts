import { describe, it, expect } from "vitest";
import {
  fetchAnonymousSession,
  findCookieValue,
  sessionFromCookieHeader,
  sessionFromCsrfCookie,
} from "../../src/store/csrf.js";
import { mockHttp } from "../helpers/mockHttp.js";

describe("findCookieValue", () => {
  it("extracts a cookie value from Set-Cookie strings", () => {
    const cookies = [
      "other=1; Path=/",
      "_csrf=abc%3D%3D; Path=/; HttpOnly; SameSite=Lax",
    ];
    expect(findCookieValue(cookies, "_csrf")).toBe("abc%3D%3D");
    expect(findCookieValue(cookies, "missing")).toBeUndefined();
  });
});

describe("fetchAnonymousSession", () => {
  it("GETs the store and builds a CSRF session (spec §3.5)", async () => {
    const { http, calls } = mockHttp([
      { setCookies: ["_csrf=tok123; Path=/; HttpOnly"] },
    ]);
    const session = await fetchAnonymousSession(http, "https://store.test");
    expect(calls[0]!.url).toBe("https://store.test/");
    expect(session.csrfToken).toBe("tok123");
    expect(session.cookie).toBe("_csrf=tok123");
  });

  it("decodes url-encoded token values", async () => {
    const { http } = mockHttp([{ setCookies: ["_csrf=a%2Bb%3D; Path=/"] }]);
    const session = await fetchAnonymousSession(http, "https://store.test");
    expect(session.csrfToken).toBe("a+b=");
    expect(session.cookie).toBe("_csrf=a%2Bb%3D");
  });

  it("throws when no _csrf cookie is returned", async () => {
    const { http } = mockHttp([{ setCookies: ["session=x; Path=/"] }]);
    await expect(
      fetchAnonymousSession(http, "https://store.test"),
    ).rejects.toThrow(/_csrf/);
  });

  it("throws on a non-ok status", async () => {
    const { http } = mockHttp([{ status: 503 }]);
    await expect(
      fetchAnonymousSession(http, "https://store.test"),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("session builders", () => {
  it("sessionFromCsrfCookie keeps raw cookie, decodes token", () => {
    expect(sessionFromCsrfCookie("a%3Db")).toEqual({
      csrfToken: "a=b",
      cookie: "_csrf=a%3Db",
    });
  });

  it("sessionFromCookieHeader extracts _csrf from a full cookie header", () => {
    const s = sessionFromCookieHeader("foo=1; _csrf=tok%3D; sid=abc");
    expect(s.csrfToken).toBe("tok=");
    expect(s.cookie).toBe("foo=1; _csrf=tok%3D; sid=abc");
  });

  it("sessionFromCookieHeader throws without a _csrf value", () => {
    expect(() => sessionFromCookieHeader("foo=1; sid=abc")).toThrow(/_csrf/);
  });
});
