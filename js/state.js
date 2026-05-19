// Tiny observable store. The whole page subscribes to `filter` (violation key).

const subs = new Set();
const state = {
  filter: '_all', // violation key from meta.violationCatalog, or '_all'
};

export function getFilter() { return state.filter; }

export function setFilter(key) {
  if (state.filter === key) return;
  state.filter = key;
  for (const fn of subs) {
    try { fn(state); } catch (e) { console.error('[state] subscriber error:', e); }
  }
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
