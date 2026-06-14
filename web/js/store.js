// Tiny observable state container. `setState` accepts a patch object or an
// updater fn (prev) => patch, then notifies subscribers. Immutable updates: a
// new state object is always produced, never mutated in place.

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    setState(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
