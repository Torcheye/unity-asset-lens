import { describe, it, expect } from "vitest";
import { createStoreClient } from "../../src/store/graphql.js";
import { GRAPHQL_BATCH_URL } from "../../src/store/constants.js";
import { mockHttp } from "../helpers/mockHttp.js";

const session = { csrfToken: "tok", cookie: "_csrf=tok" };

describe("createStoreClient.operation", () => {
  it("sends the documented headers and batched body (spec §3.4)", async () => {
    const { http, calls } = mockHttp([{ body: [{ data: { ok: true } }] }]);
    const client = createStoreClient(http, session);

    const result = await client.operation("PreviewAssets", "query {}", {
      id: "42",
      page: 0,
    });

    expect(result.data).toEqual({ ok: true });
    const call = calls[0]!;
    expect(call.url).toBe(GRAPHQL_BATCH_URL);
    expect(call.init?.method).toBe("POST");
    expect(call.init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      "x-source": "storefront",
      operations: "PreviewAssets",
      "x-csrf-token": "tok",
      Cookie: "_csrf=tok",
    });
    const sent = JSON.parse(call.init!.body!);
    expect(sent).toEqual([
      { query: "query {}", variables: { id: "42", page: 0 }, operationName: "PreviewAssets" },
    ]);
  });

  it("throws on a non-ok HTTP status", async () => {
    const { http } = mockHttp([{ status: 400, body: "bad" }]);
    const client = createStoreClient(http, session);
    await expect(client.operation("Op", "q", {})).rejects.toThrow(/HTTP 400/);
  });

  it("throws when the batch response is not a non-empty array", async () => {
    const { http } = mockHttp([{ body: {} }]);
    const client = createStoreClient(http, session);
    await expect(client.operation("Op", "q", {})).rejects.toThrow(/batch array/);
  });

  it("surfaces GraphQL errors", async () => {
    const { http } = mockHttp([
      { body: [{ errors: [{ message: "nope" }] }] },
    ]);
    const client = createStoreClient(http, session);
    await expect(client.operation("Op", "q", {})).rejects.toThrow(/nope/);
  });
});
