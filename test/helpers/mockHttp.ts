import type {
  HttpClient,
  HttpRequestInit,
  HttpResponse,
} from "../../src/store/http.js";

export interface MockReply {
  readonly ok?: boolean;
  readonly status?: number;
  /** String body, or an object that will be JSON-stringified. */
  readonly body?: string | unknown;
  readonly setCookies?: string[];
}

export interface RecordedCall {
  readonly url: string;
  readonly init?: HttpRequestInit;
}

export type MockHandler = (
  url: string,
  init: HttpRequestInit | undefined,
  callIndex: number,
) => MockReply;

/** Build an injectable {@link HttpClient} that records calls and returns
 * scripted replies. Accepts either a handler fn or an array of replies. */
export function mockHttp(handlerOrReplies: MockHandler | MockReply[]): {
  http: HttpClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const handler: MockHandler = Array.isArray(handlerOrReplies)
    ? (_u, _i, idx) => handlerOrReplies[idx] ?? { status: 500, body: "no reply" }
    : handlerOrReplies;

  const http: HttpClient = async (url, init) => {
    const idx = calls.length;
    calls.push({ url, init });
    const reply = handler(url, init, idx);
    const status = reply.status ?? 200;
    const ok = reply.ok ?? (status >= 200 && status < 300);
    const bodyText =
      typeof reply.body === "string"
        ? reply.body
        : reply.body === undefined
          ? ""
          : JSON.stringify(reply.body);
    const res: HttpResponse = {
      ok,
      status,
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText),
      setCookies: () => reply.setCookies ?? [],
    };
    return res;
  };

  return { http, calls };
}
