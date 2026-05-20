// Tiny observable store. The whole page subscribes; subscribers re-read what they need.
//
// State is also serialized to the URL hash so any view is a copy-pasteable link.
// Hash format: #v=<filter>&from=<idx>&to=<idx>&s=<norm>&tv=<timeView>&duel=<a,b>&play=1&pin=<lat,lng>
// All keys optional; absence means the default value.

const subs = new Set();
const state = {
  filter: "_all", // violation key from meta.violationCatalog, or '_all'
  range: null, // null = all months; otherwise { fromIdx, toIdx } (inclusive, into meta.months)
  street: null, // norm name of selected street, or null
  timeView: "all", // 'all' | 'byType' — heatstrip mode
  duel: null, // null | { a: norm, b: norm }
  play: false, // boolean — animated timelapse playing
  pin: null, // null | { lat, lng } — "park here" pin
  layers: new Set(), // active overlay layer keys: 'neighborhoods', 'meter', 'permit', 'venues'
};

let monthsRef = []; // injected via configureState({ months }) at boot
let streetsRef = null; // injected via configureState({ streets }) — used to validate hydrated street keys
let hashWriteSuspended = true; // suspended until hydrate completes

export function configureState({ months, streets }) {
  monthsRef = Array.isArray(months) ? months : [];
  if (streets) streetsRef = streets;
}

export function getFilter() {
  return state.filter;
}
export function getRange() {
  return state.range;
}
export function getStreet() {
  return state.street;
}
export function getTimeView() {
  return state.timeView;
}
export function getDuel() {
  return state.duel;
}
export function getPlay() {
  return state.play;
}
export function getPin() {
  return state.pin;
}
export function getLayers() {
  return state.layers;
}
export function getState() {
  return state;
}

export function setFilter(key) {
  if (state.filter === key) return;
  state.filter = key;
  notify();
}

export function setRange(range) {
  if (rangeEquals(state.range, range)) return;
  state.range = range;
  notify();
}

export function setStreet(norm) {
  if (state.street === norm) return;
  state.street = norm || null;
  notify();
}

export function setTimeView(mode) {
  const next = mode === "byType" ? "byType" : "all";
  if (state.timeView === next) return;
  state.timeView = next;
  notify();
}

export function setDuel(duel) {
  // duel: null | { a, b }
  if (duelEquals(state.duel, duel)) return;
  state.duel = duel ? { a: duel.a, b: duel.b } : null;
  notify();
}

export function setPlay(on) {
  const next = !!on;
  if (state.play === next) return;
  state.play = next;
  notify();
}

export function toggleLayer(key, on) {
  const has = state.layers.has(key);
  const next = on === undefined ? !has : !!on;
  if (next === has) return;
  if (next) state.layers.add(key);
  else state.layers.delete(key);
  notify();
}

export function setPin(pin) {
  if (pinEquals(state.pin, pin)) return;
  state.pin = pin ? { lat: pin.lat, lng: pin.lng } : null;
  notify();
}

function rangeEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.fromIdx === b.fromIdx && a.toIdx === b.toIdx;
}
function duelEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.a === b.a && a.b === b.b;
}
function pinEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.lat === b.lat && a.lng === b.lng;
}

function notify() {
  for (const fn of subs) {
    try {
      fn(state);
    } catch (e) {
      console.error("[state] subscriber error:", e);
    }
  }
  if (!hashWriteSuspended) writeHashDebounced();
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// --- URL hash sync -------------------------------------------------------

let writeTimer = null;
function writeHashDebounced() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(writeHash, 80);
}

function writeHash() {
  writeTimer = null;
  const params = new URLSearchParams();
  if (state.filter && state.filter !== "_all") params.set("v", state.filter);
  if (state.range) {
    const fromYM = monthsRef[state.range.fromIdx];
    const toYM = monthsRef[state.range.toIdx];
    if (fromYM) params.set("from", fromYM);
    if (toYM) params.set("to", toYM);
  }
  if (state.street) params.set("s", state.street);
  if (state.timeView && state.timeView !== "all")
    params.set("tv", state.timeView);
  if (state.duel) params.set("duel", `${state.duel.a}|${state.duel.b}`);
  if (state.play) params.set("play", "1");
  if (state.pin)
    params.set(
      "pin",
      `${state.pin.lat.toFixed(5)},${state.pin.lng.toFixed(5)}`,
    );
  if (state.layers?.size) {
    // Sort for canonical share links — Set is insertion-ordered, so the
    // same state would otherwise serialize differently depending on toggle order.
    params.set("layers", [...state.layers].sort().join(","));
  }
  const next = params.toString();
  const url = next
    ? `#${next}`
    : window.location.pathname + window.location.search;
  // Avoid scroll jumps and history spam: replaceState, not assign.
  history.replaceState(null, "", next ? `#${next}` : url);
}

export function hydrateFromHash() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  if (!raw) {
    hashWriteSuspended = false;
    return;
  }
  const params = new URLSearchParams(raw);

  const v = params.get("v");
  if (v) state.filter = v;

  const fromYM = params.get("from");
  const toYM = params.get("to");
  if (fromYM || toYM) {
    const fromIdx = fromYM ? monthsRef.indexOf(fromYM) : 0;
    const toIdx = toYM ? monthsRef.indexOf(toYM) : monthsRef.length - 1;
    if (fromIdx >= 0 && toIdx >= 0 && toIdx >= fromIdx) {
      state.range = { fromIdx, toIdx };
    }
  }

  const s = params.get("s");
  if (s && (!streetsRef || streetsRef[s])) state.street = s;

  const tv = params.get("tv");
  if (tv === "byType" || tv === "all") state.timeView = tv;

  const duel = params.get("duel");
  if (duel?.includes("|")) {
    const [a, b] = duel.split("|");
    if (a && b) state.duel = { a, b };
  }

  if (params.get("play") === "1") state.play = true;

  const pin = params.get("pin");
  if (pin?.includes(",")) {
    const [latS, lngS] = pin.split(",");
    const lat = parseFloat(latS),
      lng = parseFloat(lngS);
    if (Number.isFinite(lat) && Number.isFinite(lng)) state.pin = { lat, lng };
  }

  const layers = params.get("layers");
  if (layers) {
    state.layers = new Set(
      layers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  hashWriteSuspended = false;
}

window.addEventListener("hashchange", () => {
  // External hash change (back/forward, manual edit): re-hydrate and notify.
  // Cancel any in-flight debounced write so we don't echo the just-arrived hash.
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  hashWriteSuspended = true;
  // Reset to defaults, then hydrate.
  state.filter = "_all";
  state.range = null;
  state.street = null;
  state.timeView = "all";
  state.duel = null;
  state.play = false;
  state.pin = null;
  state.layers = new Set();
  hydrateFromHash();
  for (const fn of subs) {
    try {
      fn(state);
    } catch (e) {
      console.error(e);
    }
  }
});
