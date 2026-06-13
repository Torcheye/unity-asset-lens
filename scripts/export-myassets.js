/*
 * AssetLens — owned-catalog exporter (spec §5.1, §9 Phase 1).
 *
 * Transparent, inspectable browser-console snippet (à la the GCR Asset Scanner)
 * that dumps your owned Unity Asset Store library to `myassets.json`. It uses
 * YOUR already-logged-in session in the browser — no credentials are handled by
 * AssetLens, and nothing is sent anywhere except to Unity's own API.
 *
 * HOW TO RUN
 *   1. Log in at https://assetstore.unity.com in your browser.
 *   2. Open DevTools → Console (F12).
 *   3. Paste this whole file and press Enter.
 *   4. A `myassets.json` download will start. Then run:
 *        assetlens import path/to/myassets.json
 *
 * NOTE: `searchMyAssets` is an undocumented endpoint and may change (spec §10).
 * If the shape changes, re-capture the operation via the DevTools Network tab
 * (filter: graphql/batch) and update the query below.
 */
(async () => {
  const ENDPOINT = "https://assetstore.unity.com/api/graphql/batch";
  const PAGE_SIZE = 100;

  const csrf = decodeURIComponent(
    (document.cookie.split(";").map((c) => c.trim())
      .find((c) => c.startsWith("_csrf=")) || "").split("=")[1] || "",
  );
  if (!csrf) {
    console.error("No _csrf cookie found. Are you logged in at assetstore.unity.com?");
    return;
  }

  const QUERY = `query searchMyAssets($page: Int, $pageSize: Int, $sortBy: Int, $tagging: [String]) {
    searchMyAssets(page: $page, pageSize: $pageSize, sortBy: $sortBy, tagging: $tagging) {
      total
      results {
        id
        productId
        itemId
        name
        publisher { name }
        downloadSize
        currentVersion { name publishedDate }
      }
    }
  }`;

  async function fetchPage(page, tagging) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        "x-source": "storefront",
        operations: "searchMyAssets",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify([
        {
          query: QUERY,
          operationName: "searchMyAssets",
          variables: { page, pageSize: PAGE_SIZE, sortBy: 7, tagging },
        },
      ]),
    });
    if (!res.ok) throw new Error("searchMyAssets HTTP " + res.status);
    const json = await res.json();
    return json[0]?.data?.searchMyAssets?.results || [];
  }

  // `tagging: ["#BIN"]` also pulls hidden/archived assets (spec §3.4).
  async function fetchAll(tagging) {
    const out = [];
    for (let page = 0; ; page++) {
      const results = await fetchPage(page, tagging);
      if (!results.length) break;
      out.push(...results);
      if (results.length < PAGE_SIZE) break;
      await new Promise((r) => setTimeout(r, 200)); // be polite (spec §10)
    }
    return out;
  }

  console.log("Fetching owned assets…");
  const visible = await fetchAll(null);
  const hidden = await fetchAll(["#BIN"]);

  // De-dupe by id; flatten any `{ product }` nesting just in case.
  const byId = new Map();
  for (const r of [...visible, ...hidden]) {
    const node = r.product || r;
    const id = node.id || node.productId || node.itemId;
    if (id && !byId.has(id)) byId.set(id, node);
  }
  const products = [...byId.values()];
  console.log(`Found ${products.length} owned products (${hidden.length} hidden).`);

  const blob = new Blob([JSON.stringify(products, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "myassets.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log("Saved myassets.json — now run: assetlens import myassets.json");
})();
