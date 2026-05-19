// Tiny observable store. The whole page subscribes; subscribers re-read what they need.

const subs = new Set();
const state = {
  filter: '_all',  // violation key from meta.violationCatalog, or '_all'
  range: null,     // null = all months; otherwise { fromIdx, toIdx } (inclusive, into meta.months)
};

export function getFilter() { return state.filter; }
export function getRange()  { return state.range; }
export function getState()  { return state; }

export function setFilter(key) {
  if (state.filter === key) return;
  state.filter = key;
  notify();
}

export function setRange(range) {
  // range: null | { fromIdx, toIdx }
  if (rangeEquals(state.range, range)) return;
  state.range = range;
  notify();
}

function rangeEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.fromIdx === b.fromIdx && a.toIdx === b.toIdx;
}

function notify() {
  for (const fn of subs) {
    try { fn(state); } catch (e) { console.error('[state] subscriber error:', e); }
  }
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
