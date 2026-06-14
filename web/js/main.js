import { h, mount } from "./dom.js";
import { createStore } from "./store.js";
import * as api from "./api.js";
import * as history from "./history.js";
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
    import: { status: "todo" },
    scan: { status: "todo" },
    fetch: { status: "todo" },
  },
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
function deriveSteps(overview, prev) {
  const stats = overview.stats;
  const next = { ...prev };
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
  return next;
}

function loadOverview(navigateIfReady) {
  return api
    .getOverview()
    .then((overview) => {
      const prev = getState();
      const patch = { overview, steps: deriveSteps(overview, prev.steps) };
      if (navigateIfReady && overview.ready && prev.view === "setup" && !prev.query) {
        patch.view = "search";
      }
      setState(patch);
    })
    .catch((err) => setState({ searchError: `Could not reach the engine: ${err.message}` }));
}

function loadSession() {
  return api
    .getSession()
    .then((session) => setState({ session }))
    .catch(() => {}); // status is a non-critical adornment; ignore transient errors
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
  // Sign in lives in the setup view's import step (it streams browser
  // progress); the header button routes there and kicks it off.
  login() {
    setState({ view: "setup" });
    actions.runStep("import");
  },
  async logout() {
    try {
      const session = await api.logout();
      setState({ session });
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
  runStep(name) {
    if (getState().steps[name]?.status === "running") return;
    setStep(name, { status: "running", progressText: "Starting…" });
    api.runStep(name, {
      onProgress: (message) => setStep(name, { status: "running", progressText: message }),
      // Sign-in completes well before import/enrich finish — reflect it at once.
      onAccount: (session) => setState({ session }),
      onDone: (detail) => {
        setStep(name, { status: "done", detail });
        void loadOverview(false);
        if (name === "import") void loadSession();
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
