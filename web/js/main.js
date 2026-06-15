import { h, mount } from "./dom.js";
import { createStore } from "./store.js";
import * as api from "./api.js";
import * as history from "./history.js";
import { formatInt } from "./format.js";
import { Header } from "./views/header.js";
import { Sidebar } from "./views/sidebar.js";
import { SetupView } from "./views/setup.js";
import { SearchView } from "./views/search.js";
import { Toast } from "./views/toast.js";

const root = document.getElementById("root");
const DEBOUNCE_MS = 180;

const store = createStore({
  view: "setup",
  overview: null,
  session: null,
  query: "",
  type: "all",
  localOnly: false,
  publisher: "all",
  results: null,
  searching: false,
  searchError: null,
  history: history.load(),
  importHelp: false,
  steps: {
    signin: { status: "todo" },
    import: { status: "todo" },
    scan: { status: "todo" },
    fetch: { status: "todo" },
  },
  folders: [],
  folderScan: null,
  folderError: null,
  toast: null,
  toastVisible: false,
});

const { getState, setState } = store;

// ── search (debounced) ──────────────────────────────────────────────────────
let searchTimer = null;
let searchSeq = 0;

function runSearchNow() {
  const { query, type, localOnly, publisher } = getState();
  if (query.trim().length === 0) {
    setState({ results: null, searching: false, searchError: null });
    return;
  }
  const seq = ++searchSeq;
  setState({ searching: true, searchError: null });
  api
    .search({ query, type, local: localOnly, publisher })
    .then((res) => {
      if (seq !== searchSeq) return; // a newer search superseded this one
      setState({ results: res, searching: false });
    })
    .catch((err) => {
      if (seq !== searchSeq) return;
      setState({ searching: false, searchError: err.message });
    });
}

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearchNow, DEBOUNCE_MS);
}

// ── toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(title, cmd, dot) {
  if (toastTimer) clearTimeout(toastTimer);
  setState({ toast: { title, cmd, dot }, toastVisible: true });
  toastTimer = setTimeout(() => setState({ toastVisible: false }), 2900);
}

const ACTION_TOAST = {
  reveal: { title: "Revealing in file manager", dot: "#46d9a0" },
  open: { title: "Opening store page", dot: "#7aa2ff" },
  download: { title: "Opening Unity Package Manager", dot: "#5b8cff" },
};

// ── overview / steps ──────────────────────────────────────────────────────────
// Steps reflect persisted facts: sign-in from the saved session, import from the
// product count, scan from the indexed-file count. A step mid-run is left alone.
function deriveSteps(state) {
  const prev = state.steps;
  const next = { ...prev };
  const session = state.session;
  if (prev.signin.status !== "running") {
    next.signin = session?.loggedIn
      ? { status: "done", detail: session.email ? `Signed in as ${session.email}` : "Signed in" }
      : { status: "todo" };
  }
  const stats = state.overview?.stats;
  if (stats) {
    if (prev.import.status !== "running") {
      next.import = stats.products > 0
        ? { status: "done", detail: `${stats.products.toLocaleString()} owned products imported` }
        : { status: "todo" };
    }
    if (prev.scan.status !== "running") {
      next.scan = stats.files > 0
        ? { status: "done", detail: `${stats.files.toLocaleString()} files indexed across ${stats.localProducts} packages` }
        : { status: "todo" };
    }
  }
  return next;
}

function loadOverview(navigateIfReady) {
  return api
    .getOverview()
    .then((overview) => {
      setState((prev) => {
        const merged = { ...prev, overview };
        const patch = { overview, steps: deriveSteps(merged) };
        if (navigateIfReady && overview.ready && prev.view === "setup" && !prev.query) {
          patch.view = "search";
        }
        return patch;
      });
    })
    .catch((err) => setState({ searchError: `Could not reach the engine: ${err.message}` }));
}

function loadSession() {
  return api
    .getSession()
    .then((session) =>
      setState((prev) => ({ session, steps: deriveSteps({ ...prev, session }) })),
    )
    .catch(() => {}); // status is a non-critical adornment; ignore transient errors
}

function loadFolders() {
  return api
    .getFolders()
    .then(({ folders }) => setState({ folders }))
    .catch(() => {}); // optional feature; ignore transient errors
}

// Scan (add or rescan) a folder, streaming progress into `folderScan`. On done,
// refresh the folder list and the library snapshot so the new files show up.
function startFolderScan(path, mode) {
  setState({
    folderScan: { path, message: "Scanning…", current: 0, total: 0 },
    folderError: null,
  });
  api.scanFolder(path, mode, {
    onProgress: (p) =>
      setState({
        folderScan: { path, message: p.message, current: p.current ?? 0, total: p.total ?? 0 },
      }),
    onDone: (folder) => {
      setState({ folderScan: null });
      void loadFolders();
      void loadOverview(false);
      showToast(
        mode === "rescan" ? "Folder re-scanned" : "Folder added",
        `${folder.name} · ${formatInt(folder.fileCount)} files`,
        "#46d9a0",
      );
    },
    onError: (message) => {
      setState({ folderScan: null, folderError: message });
      // The server may have committed the index just before the stream dropped
      // (e.g. a transient connection error after writeIndexedProduct). Refresh
      // so a folder that actually got added isn't hidden until a manual reload.
      void loadFolders();
      void loadOverview(false);
    },
  });
}

// ── actions ───────────────────────────────────────────────────────────────────
function focusSearch() {
  const el = document.getElementById("al-search");
  if (el) el.focus();
}

const actions = {
  goSearch() {
    setState({ view: "search" });
    requestAnimationFrame(focusSearch);
  },
  goSetup() {
    setState({ view: "setup" });
  },
  // Sign in is setup step 1 (it streams browser progress); the header button
  // routes to setup and kicks it off.
  login() {
    setState({ view: "setup" });
    actions.runStep("signin");
  },
  async logout() {
    try {
      const session = await api.logout();
      // Clearing the session re-derives the Sign-in card back to "to do".
      setState((s) => ({ session, steps: deriveSteps({ ...s, session }) }));
      showToast("Signed out", "Saved login session cleared", "#ff8f6b");
    } catch (err) {
      showToast("Couldn't sign out", err.message, "#ff8f6b");
    }
  },
  onQueryInput(e) {
    setState({ query: e.target.value });
    scheduleSearch();
  },
  onQueryKey(e) {
    if (e.key === "Enter") {
      const q = e.target.value;
      setState((s) => ({ history: history.commit(s.history, q) }));
      if (searchTimer) clearTimeout(searchTimer);
      runSearchNow();
    }
  },
  clearQuery() {
    setState({ query: "", results: null, searchError: null });
    requestAnimationFrame(focusSearch);
  },
  setQuery(q) {
    setState((s) => ({ query: q, view: "search", history: history.commit(s.history, q) }));
    if (searchTimer) clearTimeout(searchTimer);
    runSearchNow();
    requestAnimationFrame(focusSearch);
  },
  setType(t) {
    setState({ type: t });
    if (getState().query.trim()) runSearchNow();
  },
  toggleLocal() {
    setState((s) => ({ localOnly: !s.localOnly }));
    if (getState().query.trim()) runSearchNow();
  },
  setPublisher(e) {
    setState({ publisher: e.target.value });
    if (getState().query.trim()) runSearchNow();
  },
  toggleImportHelp() {
    setState((s) => ({ importHelp: !s.importHelp }));
  },
  removeHistory(q) {
    setState((s) => ({ history: history.remove(s.history, q) }));
  },
  clearHistory() {
    history.clear();
    setState({ history: [] });
  },
  async runAction(kind, productId) {
    try {
      const res = await api.runAction(kind, productId);
      const meta = ACTION_TOAST[kind];
      showToast(meta.title, res.display, meta.dot);
    } catch (err) {
      showToast("Couldn't complete action", err.message, "#ff8f6b");
    }
  },
  async revealFile(fileId) {
    try {
      const res = await api.revealFile(fileId);
      showToast("Revealing in file manager", res.display, "#46d9a0");
    } catch (err) {
      showToast("Couldn't reveal file", err.message, "#ff8f6b");
    }
  },
  // ── registered local folders ──────────────────────────────────────────────
  async addFolder() {
    if (getState().folderScan) return; // a scan is already in flight
    setState({ folderScan: { path: null, message: "Choose a folder…", current: 0, total: 0 }, folderError: null });
    let path;
    try {
      path = await api.pickFolder();
    } catch (err) {
      setState({ folderScan: null, folderError: err.message });
      return;
    }
    if (!path) {
      setState({ folderScan: null }); // cancelled
      return;
    }
    startFolderScan(path, "add");
  },
  rescanFolder(path) {
    if (getState().folderScan) return;
    startFolderScan(path, "rescan");
  },
  async removeFolder(path) {
    // Don't remove while a scan is in flight: an in-flight (re)scan of the same
    // folder would re-create the product + registry row after the delete,
    // silently resurrecting the folder the user just removed.
    if (getState().folderScan) return;
    try {
      const { folders } = await api.removeFolder(path);
      setState({ folders, folderError: null });
      void loadOverview(false);
    } catch (err) {
      setState({ folderError: err.message });
    }
  },
  runStep(name) {
    if (getState().steps[name]?.status === "running") return;
    setStep(name, { status: "running", progressText: "Starting…", current: 0, total: 0 });
    api.runStep(name, {
      onProgress: (p) =>
        setStep(name, {
          status: "running",
          progressText: p.message,
          current: p.current ?? 0,
          total: p.total ?? 0,
        }),
      // The sign-in step emits this the instant sign-in lands — reflect the
      // signed-in status (header + Import gate) at once, before `done` arrives.
      onAccount: (session) => setState((s) => ({ session, steps: deriveSteps({ ...s, session }) })),
      onDone: (detail) => {
        setStep(name, { status: "done", detail });
        void loadOverview(false);
        if (name === "signin") void loadSession();
      },
      onError: (message) => setStep(name, { status: "error", detail: message }),
    });
  },
};

function setStep(name, patch) {
  setState((s) => ({ steps: { ...s.steps, [name]: { ...s.steps[name], ...patch } } }));
}

// ── render ────────────────────────────────────────────────────────────────────
function App(state) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "#161619", color: "#e7e7ea", fontSize: "1rem", overflow: "hidden" } },
    Header(state, actions),
    h(
      "div",
      { style: { display: "flex", flex: "1", minHeight: 0 } },
      Sidebar(state, actions),
      h(
        "div",
        { style: { flex: "1", minWidth: 0, display: "flex", flexDirection: "column" } },
        state.view === "setup" ? SetupView(state, actions) : SearchView(state, actions),
      ),
    ),
    Toast(state),
  );
}

store.subscribe((state) => mount(root, App(state)));
mount(root, App(getState()));
void loadOverview(true);
void loadSession();
void loadFolders();
