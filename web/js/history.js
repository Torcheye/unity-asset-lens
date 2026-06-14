// Recent-search history, persisted to localStorage (client-only — the engine
// is stateless about queries). Capped at the 10 most recent, de-duplicated
// case-insensitively, newest first.

const KEY = "al-history";
const MAX = 10;

export function load() {
  try {
    const h = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(h)) return h.slice(0, MAX);
  } catch {
    /* ignore malformed storage */
  }
  return [];
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage may be unavailable (private mode) — history is best-effort */
  }
}

export function commit(list, query) {
  const q = (query || "").trim();
  if (!q) return list;
  const next = [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
  save(next);
  return next;
}

export function remove(list, query) {
  const next = list.filter((x) => x !== query);
  save(next);
  return next;
}

export function clear() {
  save([]);
  return [];
}
