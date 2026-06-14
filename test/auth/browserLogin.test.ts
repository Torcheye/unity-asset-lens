import { describe, it, expect } from "vitest";
import {
  runBrowserLogin,
  type BrowserLauncher,
  type LaunchOptions,
  type LoginBrowser,
  type OwnedIdsResult,
} from "../../src/auth/browserLogin.js";
import type { SessionStore } from "../../src/auth/sessionStore.js";

interface BrowserScript {
  /** OwnedIds probes returned in order, one per poll. */
  readonly probes: OwnedIdsResult[];
  /** Maps a requested ID to its product node (missing → null node). */
  readonly detailFor?: (id: string) => unknown;
  /** IDs (joined) for which fetchProductDetails should throw. */
  readonly failBatch?: (ids: readonly string[]) => boolean;
}

function makeBrowser(script: BrowserScript) {
  const events = {
    goto: [] as string[],
    detailBatches: [] as string[][],
    closed: 0,
    stateRequested: 0,
  };
  let probeIdx = 0;
  const browser: LoginBrowser = {
    async goto(url) {
      events.goto.push(url);
    },
    async getOwnedProductIds() {
      const r = script.probes[Math.min(probeIdx, script.probes.length - 1)];
      probeIdx += 1;
      if (!r) throw new Error("no probe scripted");
      return r;
    },
    async fetchProductDetails(ids) {
      events.detailBatches.push([...ids]);
      if (script.failBatch?.(ids)) throw new Error("batch boom");
      const map = script.detailFor ?? ((id: string) => ({ id }));
      return ids.map((id) => map(id));
    },
    async storageState() {
      events.stateRequested += 1;
      return { kind: "saved-state" };
    },
    async close() {
      events.closed += 1;
    },
  };
  return { browser, events };
}

function makeLauncher(browser: LoginBrowser) {
  const launchOpts: LaunchOptions[] = [];
  const launcher: BrowserLauncher = {
    async launch(opts) {
      launchOpts.push(opts);
      return browser;
    },
  };
  return { launcher, launchOpts };
}

function makeStore(loadValue: unknown = null) {
  const saved: unknown[] = [];
  const store: SessionStore = {
    path: "/mem/session.json",
    async load() {
      return loadValue;
    },
    async save(state) {
      saved.push(state);
    },
    async clear() {},
  };
  return { store, saved };
}

const authed = (ids: string[]): OwnedIdsResult => ({ authenticated: true, ids });
const pending: OwnedIdsResult = { authenticated: false, ids: [] };

describe("runBrowserLogin", () => {
  it("waits for sign-in, batches detail fetches, and remembers the session", async () => {
    const ids = ["1", "2", "3", "4", "5"];
    const { browser, events } = makeBrowser({
      probes: [pending, pending, authed(ids)],
      detailFor: (id) => ({ id, name: `Pack ${id}` }),
    });
    const { launcher, launchOpts } = makeLauncher(browser);
    const { store, saved } = makeStore();
    const progress: string[] = [];

    const result = await runBrowserLogin(launcher, store, {
      batchSize: 2,
      pollIntervalMs: 5,
      loginTimeoutMs: 60_000,
      onProgress: (m) => progress.push(m),
      sleep: async () => {},
      now: () => 1_000, // constant clock — never times out
    });

    expect(result.ownedCount).toBe(5);
    expect(result.products).toHaveLength(5);
    expect(result.remembered).toBe(true);
    expect(saved).toEqual([{ kind: "saved-state" }]);

    // 5 ids in batches of 2 → [2,2,1].
    expect(events.detailBatches).toEqual([["1", "2"], ["3", "4"], ["5"]]);
    expect(launchOpts).toEqual([{}]); // no saved session to restore
    expect(events.goto).toHaveLength(1);
    expect(events.closed).toBe(1);
  });

  it("restores a saved session and skips persistence when remember=false", async () => {
    const { browser, events } = makeBrowser({ probes: [authed([])] });
    const { launcher, launchOpts } = makeLauncher(browser);
    const { store, saved } = makeStore({ kind: "restored" });

    const result = await runBrowserLogin(launcher, store, {
      remember: false,
      sleep: async () => {},
      now: () => 0,
    });

    expect(result.ownedCount).toBe(0);
    expect(result.products).toEqual([]);
    expect(result.remembered).toBe(false);
    expect(saved).toEqual([]);
    expect(events.stateRequested).toBe(0);
    expect(events.detailBatches).toEqual([]); // nothing to fetch
    expect(launchOpts).toEqual([{ storageState: { kind: "restored" } }]);
    expect(events.closed).toBe(1);
  });

  it("times out (and still closes the browser) if the user never signs in", async () => {
    const { browser, events } = makeBrowser({ probes: [pending] });
    const { launcher } = makeLauncher(browser);
    const { store } = makeStore();

    let t = 0;
    await expect(
      runBrowserLogin(launcher, store, {
        pollIntervalMs: 5,
        loginTimeoutMs: 10,
        sleep: async (ms) => {
          t += ms;
        },
        now: () => t,
      }),
    ).rejects.toThrow(/Timed out waiting for Unity sign-in/);

    expect(events.closed).toBe(1);
  });

  it("signInOnly stops after persisting the session, without fetching details", async () => {
    const { browser, events } = makeBrowser({
      probes: [pending, authed(["1", "2", "3"])],
      detailFor: (id) => ({ id }),
    });
    const { launcher } = makeLauncher(browser);
    const { store, saved } = makeStore();

    const result = await runBrowserLogin(launcher, store, {
      signInOnly: true,
      pollIntervalMs: 5,
      sleep: async () => {},
      now: () => 0,
    });

    expect(result.ownedCount).toBe(3);
    expect(result.products).toEqual([]); // sign-in only — no detail fetch
    expect(result.remembered).toBe(true);
    expect(saved).toEqual([{ kind: "saved-state" }]);
    expect(events.detailBatches).toEqual([]);
    expect(events.closed).toBe(1);
  });

  it("continues past a failed batch instead of aborting the whole login", async () => {
    const ids = ["1", "2", "3", "4"];
    const { browser, events } = makeBrowser({
      probes: [authed(ids)],
      detailFor: (id) => ({ id }),
      failBatch: (batch) => batch.includes("3"), // second batch fails
    });
    const { launcher } = makeLauncher(browser);
    const { store } = makeStore();
    const progress: string[] = [];

    const result = await runBrowserLogin(launcher, store, {
      batchSize: 2,
      onProgress: (m) => progress.push(m),
      sleep: async () => {},
      now: () => 0,
    });

    // First batch (1,2) succeeded; second (3,4) failed and was skipped.
    expect(result.products).toHaveLength(2);
    expect(result.ownedCount).toBe(4);
    expect(events.detailBatches).toEqual([["1", "2"], ["3", "4"]]);
    expect(progress.some((m) => m.includes("failed"))).toBe(true);
    expect(events.closed).toBe(1);
  });
});
