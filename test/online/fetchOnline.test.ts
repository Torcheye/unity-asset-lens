import { describe, it, expect } from "vitest";
import { fetchOnlineProducts } from "../../src/online/fetchOnline.js";
import { createStoreClient } from "../../src/store/graphql.js";
import { searchFiles } from "../../src/index/search.js";
import { catalogProduct, memoryRepo } from "../helpers/db.js";
import { mockHttp } from "../helpers/mockHttp.js";

const session = { csrfToken: "t", cookie: "_csrf=t" };

function assetsFor(id: string, page: number) {
  if (id === "1") {
    // Non-wrapper product with a real file.
    return page === 0
      ? [
          { label: "PackA", level: 0, type: "folder" },
          { label: "ui_click.wav", level: 1, type: "file" },
        ]
      : [];
  }
  if (id === "2") {
    // Wrapper: only nested .unitypackage leaves -> opaque online.
    return page === 0
      ? [{ label: "URP_PackB.unitypackage", level: 0, type: "file" }]
      : [];
  }
  return [];
}

describe("fetchOnlineProducts (spec §5.4)", () => {
  it("deep-indexes normal products and flags wrappers shallow", async () => {
    const repo = memoryRepo();
    repo.importCatalog(
      [
        catalogProduct({ id: "1", name: "Pack A" }),
        catalogProduct({ id: "2", name: "Pack B" }),
      ],
      1,
    );

    const { http } = mockHttp((_url, init) => {
      const sent = JSON.parse(init!.body!) as Array<{
        variables: { id: string; page: number };
      }>;
      const { id, page } = sent[0]!.variables;
      return { body: [{ data: { product: { assets: assetsFor(id, page) } } }] };
    });
    const client = createStoreClient(http, session);

    const result = await fetchOnlineProducts(repo, client, { now: 2 });
    expect(result.attempted).toBe(2);
    expect(result.deepIndexed).toBe(1);
    expect(result.wrappers).toBe(1);
    expect(result.errors).toEqual([]);

    // Product 1 file is now searchable as an online hit.
    const hits = searchFiles(repo.db, "click");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.productId).toBe("1");
    expect(hits[0]!.source).toBe("online");

    // Product 2 recorded as a shallow wrapper.
    const b = repo.getProduct("2")!;
    expect(b.coverage).toBe("shallow");
    expect(b.is_wrapper).toBe(1);
  });

  it("respects --limit and records per-product errors", async () => {
    const repo = memoryRepo();
    repo.importCatalog(
      [catalogProduct({ id: "1", name: "A" }), catalogProduct({ id: "2", name: "B" })],
      1,
    );
    const { http, calls } = mockHttp([{ status: 500, body: "boom" }]);
    const client = createStoreClient(http, session);

    const result = await fetchOnlineProducts(repo, client, { limit: 1, now: 2 });
    expect(result.attempted).toBe(1);
    expect(calls).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("does not re-fetch already deep-indexed products", async () => {
    const repo = memoryRepo();
    repo.importCatalog([catalogProduct({ id: "1", name: "A" })], 1);
    const { http } = mockHttp((_u, init) => {
      const sent = JSON.parse(init!.body!) as Array<{ variables: { id: string; page: number } }>;
      return { body: [{ data: { product: { assets: assetsFor(sent[0]!.variables.id, sent[0]!.variables.page) } } }] };
    });
    const client = createStoreClient(http, session);

    await fetchOnlineProducts(repo, client, { now: 2 });
    const again = await fetchOnlineProducts(repo, client, { now: 3 });
    expect(again.attempted).toBe(0); // product 1 is now deep; nothing left to fetch
  });
});
