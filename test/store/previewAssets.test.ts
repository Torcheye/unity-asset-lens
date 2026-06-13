import { describe, it, expect } from "vitest";
import {
  fetchAssetNodes,
  fetchOnlineProductTree,
  reconstructPaths,
  type AssetNode,
} from "../../src/store/previewAssets.js";
import { createStoreClient } from "../../src/store/graphql.js";
import { mockHttp } from "../helpers/mockHttp.js";

const session = { csrfToken: "tok", cookie: "_csrf=tok" };

function node(label: string, level: number, type: string): AssetNode {
  return { label, level, type };
}

describe("reconstructPaths (Appendix A algorithm)", () => {
  it("rebuilds nested paths from the flat level-tagged list", () => {
    const nodes = [
      node("Pack", 0, "folder"),
      node("Scripts", 1, "folder"),
      node("API", 2, "folder"),
      node("HttpClient.cs", 3, "file"),
      node("README.md", 1, "file"),
    ];
    expect(reconstructPaths(nodes)).toEqual([
      { path: "Pack", isFile: false },
      { path: "Pack/Scripts", isFile: false },
      { path: "Pack/Scripts/API", isFile: false },
      { path: "Pack/Scripts/API/HttpClient.cs", isFile: true },
      { path: "Pack/README.md", isFile: true },
    ]);
  });

  it("drops stale deeper labels when the level decreases", () => {
    const nodes = [
      node("Root", 0, "folder"),
      node("A", 1, "folder"),
      node("deep.cs", 2, "file"),
      node("B", 1, "folder"),
      node("shallow.cs", 2, "file"),
    ];
    const paths = reconstructPaths(nodes).filter((r) => r.isFile).map((r) => r.path);
    expect(paths).toEqual(["Root/A/deep.cs", "Root/B/shallow.cs"]);
  });
});

describe("fetchAssetNodes pagination", () => {
  it("loops pages until a short/empty page (spec §10 heuristic)", async () => {
    const full = Array.from({ length: 50 }, (_, i) => node(`f${i}.cs`, 0, "file"));
    const tail = [node("last.cs", 0, "file")];
    const { http, calls } = mockHttp((_url, init) => {
      const sent = JSON.parse(init!.body!) as Array<{ variables: { page: number } }>;
      const page = sent[0]!.variables.page;
      const assets = page === 0 ? full : page === 1 ? tail : [];
      return { body: [{ data: { product: { assets } } }] };
    });
    const client = createStoreClient(http, session);

    const nodes = await fetchAssetNodes(client, "123", { pageSize: 50 });
    expect(nodes).toHaveLength(51);
    // Page 0 full (50) -> fetch page 1 (short, 1) -> stop. Two calls.
    expect(calls).toHaveLength(2);
  });

  it("stops immediately on an empty first page", async () => {
    const { http, calls } = mockHttp([{ body: [{ data: { product: { assets: [] } } }] }]);
    const client = createStoreClient(http, session);
    expect(await fetchAssetNodes(client, "1")).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("fetchOnlineProductTree", () => {
  it("returns online file paths and detects non-wrapper", async () => {
    const nodes = [
      node("Pack", 0, "folder"),
      node("click.wav", 1, "file"),
      node("crate.fbx", 1, "file"),
    ];
    const { http } = mockHttp([{ body: [{ data: { product: { assets: nodes } } }] }]);
    const client = createStoreClient(http, session);

    const tree = await fetchOnlineProductTree(client, "1");
    expect(tree.isWrapper).toBe(false);
    expect(tree.files.map((f) => f.fullPath)).toEqual([
      "Pack/click.wav",
      "Pack/crate.fbx",
    ]);
    expect(tree.files.every((f) => f.source === "online")).toBe(true);
  });

  it("flags a wrapper whose only leaves are nested .unitypackage + readme (spec §3.3)", async () => {
    const nodes = [
      node("Toon Deserted Temples", 0, "folder"),
      node("BuiltIn_Toon.unitypackage", 1, "file"),
      node("URP_Toon.unitypackage", 1, "file"),
      node("_ReadFirst.txt", 1, "file"),
    ];
    const { http } = mockHttp([{ body: [{ data: { product: { assets: nodes } } }] }]);
    const client = createStoreClient(http, session);

    const tree = await fetchOnlineProductTree(client, "1");
    expect(tree.isWrapper).toBe(true);
  });
});
