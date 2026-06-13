import { describe, it, expect } from "vitest";
import {
  runBrowserLogin,
  type BrowserLauncher,
  type FetchPageInput,
  type LaunchOptions,
  type LoginBrowser,
  type MyAssetsPage,
} from "../../src/auth/browserLogin.js";
import type { SessionStore } from "../../src/auth/sessionStore.js";

/** A scripted {@link LoginBrowser} that returns pre-baked pages per call. */
function makeBrowser(script: MyAssetsPage[]) {
  const events = {
    goto: [] as string[],
    fetches: [] as FetchPageInput[],
    closed: 0,
    stateRequested: 0,
  };
  let idx = 0;
  const browser: LoginBrowser = {
    async goto(url) {
      events.goto.push(url);
    },
    async fetchMyAssetsPage(input) {
      events.fetches.push(input);
      const page = script[idx++];
      if (!page) throw new Error(`no scripted page for call ${idx - 1}`);
      return page;
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
  let cleared = 0;
  const store: SessionStore = {
    path: "/mem/session.json",
    async load() {
      return loadValue;
    },
    async save(state) {
      saved.push(state);
    },
    async clear() {
      cleared += 1;
    },
  };
  return { store, saved, clearedCount: () => cleared };
}

const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };
const d = { id: "d" };
const e = { id: "e" };
const h = { id: "h" };

const PAGE = 3;

describe("runBrowserLogin", () => {
  it("waits for sign-in, paginates visible + hidden, and remembers the session", async () => {
    const script: MyAssetsPage[] = [
      // waitForAuth: two logged-out probes, then authenticated.
      { authenticated: false, results: [], total: null },
      { authenticated: false, results: [], total: null },
      { authenticated: true, results: [], total: 6 },
      // visible: full page (==PAGE) then short page → stop.
      { authenticated: true, results: [a, b, c], total: 6 },
      { authenticated: true, results: [d, e], total: 6 },
      // hidden (#BIN): short page → stop.
      { authenticated: true, results: [h], total: 1 },
    ];
    const { browser, events } = makeBrowser(script);
    const { launcher, launchOpts } = makeLauncher(browser);
    const { store, saved } = makeStore();
    const progress: string[] = [];

    const result = await runBrowserLogin(launcher, store, {
      pageSize: PAGE,
      pollIntervalMs: 5,
      loginTimeoutMs: 60_000,
      onProgress: (m) => progress.push(m),
      sleep: async () => {},
      now: () => 1_000, // constant clock — never times out
    });

    expect(result.products).toEqual([a, b, c, d, e, h]);
    expect(result.hidden).toBe(1);
    expect(result.remembered).toBe(true);

    // Session was persisted (the browser's storageState snapshot).
    expect(saved).toEqual([{ kind: "saved-state" }]);
    expect(events.stateRequested).toBe(1);

    // No saved session to restore → launched with empty options.
    expect(launchOpts).toEqual([{}]);

    // Visible scan used tagging:null; hidden scan used #BIN.
    expect(events.fetches.at(3)?.tagging).toBeNull();
    expect(events.fetches.at(5)?.tagging).toEqual(["#BIN"]);
    expect(events.goto).toHaveLength(1);
    expect(events.closed).toBe(1);
  });

  it("restores a saved session and skips persistence when remember=false", async () => {
    const script: MyAssetsPage[] = [
      { authenticated: true, results: [], total: 0 }, // already signed in
      { authenticated: true, results: [], total: 0 }, // visible: empty → stop
      { authenticated: true, results: [], total: 0 }, // hidden: empty → stop
    ];
    const { browser, events } = makeBrowser(script);
    const { launcher, launchOpts } = makeLauncher(browser);
    const { store, saved } = makeStore({ kind: "restored" });

    const result = await runBrowserLogin(launcher, store, {
      pageSize: PAGE,
      remember: false,
      sleep: async () => {},
      now: () => 0,
    });

    expect(result.products).toEqual([]);
    expect(result.remembered).toBe(false);
    expect(saved).toEqual([]); // not persisted
    expect(events.stateRequested).toBe(0);
    // The saved session was handed to the launcher.
    expect(launchOpts).toEqual([{ storageState: { kind: "restored" } }]);
    expect(events.closed).toBe(1);
  });

  it("times out (and still closes the browser) if the user never signs in", async () => {
    const script: MyAssetsPage[] = Array.from({ length: 10 }, () => ({
      authenticated: false,
      results: [],
      total: null,
    }));
    const { browser, events } = makeBrowser(script);
    const { launcher } = makeLauncher(browser);
    const { store } = makeStore();

    // A clock that advances only when we sleep.
    let t = 0;
    await expect(
      runBrowserLogin(launcher, store, {
        pageSize: PAGE,
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

  it("aborts cleanly if the session drops mid-export", async () => {
    const script: MyAssetsPage[] = [
      { authenticated: true, results: [], total: 6 }, // auth probe
      { authenticated: true, results: [a, b, c], total: 6 }, // visible page 0
      { authenticated: false, results: [], total: null }, // dropped session
    ];
    const { browser, events } = makeBrowser(script);
    const { launcher } = makeLauncher(browser);
    const { store } = makeStore();

    await expect(
      runBrowserLogin(launcher, store, {
        pageSize: PAGE,
        sleep: async () => {},
        now: () => 0,
      }),
    ).rejects.toThrow(/Lost the authenticated session/);

    expect(events.closed).toBe(1);
  });
});
