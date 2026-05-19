// Shared cache: turn (filter, range) into per-street counts.
// Backed by streets-time.json (sparse per-street × per-month × per-violation).
// Falls back to the all-time aggregates in streets.json when range is null.
//
// API:
//   init({ streetsTime, streets })            — call once at boot.
//   getStreetCount(norm, state)               — number for a single street.
//   getStreetCounts(state)                    — Map<norm, number> for all streets with > 0.
//   getMaxCount(state)                        — max over getStreetCounts (for the map ramp).
//   getStreetSlice(norm, state)               — { total, byViolation, topViolations } scoped to range.
//   getMonthTotals(state)                     — { total } across active scope (for hero stat).

let streetsTime = null;     // { months, violations, byStreet }
let streets = null;         // { [norm]: { count, byViolation, topViolations, ... } }
let violationIdxByKey = null;

let cacheKey = null;
let cachedCounts = null;
let cachedMax = 0;
let cachedTotal = 0;

export function initTimeIndex({ streetsTime: st, streets: s }) {
  streetsTime = st;
  streets = s;
  violationIdxByKey = new Map(streetsTime.violations.map((k, i) => [k, i]));
  invalidate();
}

export function invalidate() {
  cacheKey = null;
  cachedCounts = null;
  cachedMax = 0;
  cachedTotal = 0;
}

function keyFor(state) {
  const r = state.range;
  return `${state.filter}|${r ? `${r.fromIdx}-${r.toIdx}` : 'all'}`;
}

function ensureCache(state) {
  const k = keyFor(state);
  if (cacheKey === k && cachedCounts) return;
  cacheKey = k;
  cachedCounts = new Map();
  cachedMax = 0;
  cachedTotal = 0;

  const filter = state.filter;
  const range = state.range;

  // Fast path: no range → use precomputed all-time aggregates from streets.json.
  if (!range) {
    for (const norm in streets) {
      const s = streets[norm];
      const c = filter === '_all' ? s.count : (s.byViolation?.[filter] || 0);
      if (c > 0) {
        cachedCounts.set(norm, c);
        cachedTotal += c;
        if (c > cachedMax) cachedMax = c;
      }
    }
    return;
  }

  // Range path: sum from streets-time.
  const vIdx = filter === '_all' ? -1 : violationIdxByKey.get(filter);
  if (filter !== '_all' && vIdx == null) return; // unknown filter key
  const from = range.fromIdx, to = range.toIdx;

  for (const norm in streetsTime.byStreet) {
    const entries = streetsTime.byStreet[norm];
    let sum = 0;
    for (const [mIdx, vec] of entries) {
      if (mIdx < from || mIdx > to) continue;
      if (vIdx === -1) {
        for (let i = 0; i < vec.length; i++) sum += vec[i];
      } else {
        sum += vec[vIdx];
      }
    }
    if (sum > 0) {
      cachedCounts.set(norm, sum);
      cachedTotal += sum;
      if (sum > cachedMax) cachedMax = sum;
    }
  }
}

export function getStreetCounts(state) {
  ensureCache(state);
  return cachedCounts;
}

export function getStreetCount(norm, state) {
  ensureCache(state);
  return cachedCounts.get(norm) || 0;
}

export function getMaxCount(state) {
  ensureCache(state);
  return cachedMax || 1;
}

export function getTotalCount(state) {
  ensureCache(state);
  return cachedTotal;
}

// Detailed slice for the stats card — total + per-violation breakdown + top 3 raw violations.
// When range is null, returns the precomputed structure from streets.json.
export function getStreetSlice(norm, state) {
  const s = streets[norm];
  if (!s) return null;
  if (!state.range) {
    return {
      total: s.count,
      byViolation: s.byViolation || {},
      topViolations: s.topViolations || [],
      ranked: true,
    };
  }
  const entries = streetsTime.byStreet[norm] || [];
  const from = state.range.fromIdx, to = state.range.toIdx;
  const byViolation = {};
  let total = 0;
  for (let i = 0; i < streetsTime.violations.length; i++) byViolation[streetsTime.violations[i]] = 0;
  for (const [mIdx, vec] of entries) {
    if (mIdx < from || mIdx > to) continue;
    for (let i = 0; i < vec.length; i++) {
      const k = streetsTime.violations[i];
      byViolation[k] += vec[i];
      total += vec[i];
    }
  }
  // Drop zero buckets.
  for (const k in byViolation) if (!byViolation[k]) delete byViolation[k];
  // Top 3 by key — we don't have raw-desc breakdown per month, so use the catalog labels here.
  const top = Object.entries(byViolation)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => ({ key, count }));
  return { total, byViolation, topViolations: top, ranked: false };
}
