#!/usr/bin/env node
// Pulls Buffalo parking-summons data + street centerlines from data.buffalony.gov
// and writes the four static artifacts the /parking-heatmap/ page consumes:
//   data/streets.geojson  — Buffalo street centerlines joined to per-street ticket totals
//   data/streets.json     — { [normName]: { display, count, rank, byViolation, topViolations } }
//   data/time.json        — citywide hour×day and monthly aggregates, sliced by violation
//   data/meta.json        — generation timestamp, date range, violation catalog (top 6 + other)
//
// Usage:
//   node scripts/build-data.mjs
//   node scripts/build-data.mjs --since 2024-01-01
//   node scripts/build-data.mjs --raw-id yvvn-sykd --streets-id dbwm-jgtt
//
// Requires Node 20+ (uses global fetch). No npm install.

import { writeFileSync, mkdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'data');
mkdirSync(OUT_DIR, { recursive: true });

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const RAW_ID     = args['raw-id']     || 'yvvn-sykd';
const STREETS_ID = args['streets-id'] || 'dbwm-jgtt';
const SINCE      = args['since']      || '2024-01-01';
const PAGE       = parseInt(args['page-size'] || '50000', 10);
const SIMPLIFY_TOL = parseFloat(args['simplify-tol'] || '0.00008'); // ~9m
const TOP_N_VIOLATIONS = 6;
const BUDGET_BYTES = 6 * 1024 * 1024;
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || '';

const headers = APP_TOKEN ? { 'X-App-Token': APP_TOKEN } : {};

async function soda(path) {
  const url = `https://data.buffalony.gov/resource/${path}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SODA ${res.status} ${res.statusText}: ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function normalizeStreet(s) {
  if (!s) return null;
  return String(s)
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bCOURT\b/g, 'CT')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bCIRCLE\b/g, 'CIR')
    .replace(/\bHIGHWAY\b/g, 'HWY')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bWEST\b/g, 'W')
    .replace(/\s+/g, ' ')
    .trim();
}

// "10:09:00AM" -> 10; "12:30:00AM" -> 0; "12:30:00PM" -> 12; "11:45:00PM" -> 23
function parseHour(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const am = m[3].toUpperCase() === 'AM';
  if (h === 12) h = am ? 0 : 12;
  else if (!am) h += 12;
  return h >= 0 && h < 24 ? h : null;
}

// Squared perpendicular distance from point p to segment a-b.
function sqSegDist(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

// Ramer–Douglas–Peucker on a LineString (array of [lng,lat]).
function simplify(points, tol) {
  if (points.length < 3) return points;
  const sqTol = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let i = s + 1; i < e; i++) {
      const d = sqSegDist(points[i], points[s], points[e]);
      if (d > maxDist) { index = i; maxDist = d; }
    }
    if (maxDist > sqTol && index !== -1) {
      keep[index] = 1;
      stack.push([s, index], [index, e]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function simplifyGeometry(g, tol) {
  if (g.type === 'LineString') return { type: 'LineString', coordinates: simplify(g.coordinates, tol) };
  if (g.type === 'MultiLineString') {
    return {
      type: 'MultiLineString',
      coordinates: g.coordinates.map(line => simplify(line, tol)).filter(l => l.length >= 2),
    };
  }
  return g;
}

async function fetchTickets() {
  console.log(`[tickets] paginating ${RAW_ID} since ${SINCE} (page=${PAGE})`);
  const select = 'summdt,viotime,viodesc,violation_street';
  const where  = `summdt >= '${SINCE}T00:00:00'`;
  const out = [];
  let offset = 0;
  while (true) {
    const url = `${RAW_ID}.json`
      + `?$select=${encodeURIComponent(select)}`
      + `&$where=${encodeURIComponent(where)}`
      + `&$order=${encodeURIComponent(':id')}`
      + `&$limit=${PAGE}&$offset=${offset}`;
    const rows = await soda(url);
    if (!rows.length) break;
    out.push(...rows);
    console.log(`[tickets] offset=${offset} fetched=${rows.length} total=${out.length}`);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function fetchStreetsGeoJSON() {
  console.log(`[streets] fetching ${STREETS_ID} (Buffalo + drivable)`);
  // Filter server-side to Buffalo + non-null streetname; exclude parking lots (label="Parking Lot").
  const where = `(leftcitytownname='Buffalo' OR rightcitytownname='Buffalo') AND streetname IS NOT NULL AND label != 'Parking Lot'`;
  const url = `${STREETS_ID}.geojson?$where=${encodeURIComponent(where)}&$limit=20000`;
  const fc = await soda(url);
  console.log(`[streets] fetched ${fc.features.length} street segments`);
  return fc;
}

function streetDisplayFromFeature(props) {
  // Prefer `label` ("N Ogden St"); fall back to streetname.
  return props.label || props.completestreetname || props.streetname || null;
}

function aggregate(rows) {
  const violationTotals = new Map();      // raw desc -> count
  const streetTotals    = new Map();      // norm -> { display, count, byRawViolation: Map }
  const hourByDay       = new Map();      // raw desc -> int[7][24]
  const monthly         = new Map();      // raw desc -> Map<ym, n>
  const hourByDayAll    = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const monthlyAll      = new Map();
  // New: per-street per-month per-rawDesc counts (sparse)
  const streetMonthly   = new Map();      // norm -> Map<ym, Map<rawDesc, n>>
  // New: per-month per-rawDesc hour×day matrices
  const hourByDayByMonth = new Map();     // ym -> Map<rawDesc, int[7][24]>
  let dateMin = null, dateMax = null;
  let kept = 0, withTime = 0;

  for (const r of rows) {
    const desc = (r.viodesc || 'UNKNOWN').trim().toUpperCase();
    const streetRaw = r.violation_street;
    const norm = normalizeStreet(streetRaw);
    if (!norm) continue;
    kept++;
    violationTotals.set(desc, (violationTotals.get(desc) || 0) + 1);

    const entry = streetTotals.get(norm) || {
      display: streetRaw,
      count: 0,
      byRawViolation: new Map(),
    };
    entry.count += 1;
    entry.byRawViolation.set(desc, (entry.byRawViolation.get(desc) || 0) + 1);
    if (String(streetRaw).length < String(entry.display).length) entry.display = streetRaw;
    streetTotals.set(norm, entry);

    if (r.summdt) {
      const d = new Date(r.summdt);
      if (!Number.isNaN(d.getTime())) {
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        monthlyAll.set(ym, (monthlyAll.get(ym) || 0) + 1);
        if (!monthly.has(desc)) monthly.set(desc, new Map());
        const m = monthly.get(desc);
        m.set(ym, (m.get(ym) || 0) + 1);

        // Accumulate per-street per-month per-rawDesc
        if (!streetMonthly.has(norm)) streetMonthly.set(norm, new Map());
        const smNorm = streetMonthly.get(norm);
        if (!smNorm.has(ym)) smNorm.set(ym, new Map());
        const smYm = smNorm.get(ym);
        smYm.set(desc, (smYm.get(desc) || 0) + 1);

        const dow = d.getUTCDay();
        const hour = parseHour(r.viotime);
        if (hour != null) {
          withTime++;
          hourByDayAll[dow][hour] += 1;
          if (!hourByDay.has(desc)) hourByDay.set(desc, Array.from({ length: 7 }, () => new Array(24).fill(0)));
          hourByDay.get(desc)[dow][hour] += 1;

          // Accumulate per-month per-rawDesc hour×day
          if (!hourByDayByMonth.has(ym)) hourByDayByMonth.set(ym, new Map());
          const ymMap = hourByDayByMonth.get(ym);
          if (!ymMap.has(desc)) ymMap.set(desc, Array.from({ length: 7 }, () => new Array(24).fill(0)));
          ymMap.get(desc)[dow][hour] += 1;
        }
        if (dateMin == null || d < dateMin) dateMin = d;
        if (dateMax == null || d > dateMax) dateMax = d;
      }
    }
  }

  return { violationTotals, streetTotals, hourByDay, monthly, hourByDayAll, monthlyAll, streetMonthly, hourByDayByMonth, dateMin, dateMax, kept, withTime };
}

function buildCatalog(violationTotals) {
  // Top N by count; everything else lumped under 'other'.
  const total = [...violationTotals.values()].reduce((s, n) => s + n, 0);
  const sorted = [...violationTotals.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, TOP_N_VIOLATIONS);
  const tail = sorted.slice(TOP_N_VIOLATIONS);
  const tailCount = tail.reduce((s, [, n]) => s + n, 0);

  // Color ramp (perceptual, accessible against bg/surface). Last is 'other' = grey.
  const palette = ['#1a6b4a', '#0b7ab1', '#b48a00', '#8a4a8a', '#c2453a', '#5a8a3a', '#8a8a8a'];
  const catalog = top.map(([desc, n], i) => ({
    key: slug(desc),
    label: titleCase(desc),
    rawDesc: desc,
    color: palette[i],
    count: n,
    shareOfTotal: total ? n / total : 0,
  }));
  catalog.push({
    key: 'other',
    label: 'Other',
    rawDesc: null,
    color: palette[6],
    count: tailCount,
    shareOfTotal: total ? tailCount / total : 0,
  });
  const descToKey = new Map();
  for (const c of catalog) if (c.rawDesc) descToKey.set(c.rawDesc, c.key);
  return { catalog, descToKey };
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b([a-z])([a-z0-9']*)/g, (_, a, b) => a.toUpperCase() + b);
}

function bucketByViolation(rawMap, descToKey) {
  // Map a raw-desc -> count map to a key (top6+other) -> count map. Sparse: omit zeros.
  const out = {};
  for (const [desc, n] of rawMap) {
    const key = descToKey.get(desc) || 'other';
    out[key] = (out[key] || 0) + n;
  }
  return out;
}

function buildStreetIndex(streetTotals, descToKey) {
  const sorted = [...streetTotals.entries()]
    .map(([norm, v]) => ({ norm, ...v }))
    .sort((a, b) => b.count - a.count);
  const out = {};
  sorted.forEach((s, i) => {
    const byViolation = bucketByViolation(s.byRawViolation, descToKey);
    const topRaw = [...s.byRawViolation.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    out[s.norm] = {
      display: String(s.display),
      count: s.count,
      rank: i + 1,
      byViolation,
      topViolations: topRaw.map(([desc, count]) => ({ desc: titleCase(desc), count })),
    };
  });
  return { streets: out, ranked: sorted };
}

function buildStreetsTime(streetMonthly, catalog, descToKey) {
  // Build sparse per-street × per-month × per-violation output.
  const violationKeys = catalog.map(c => c.key); // length 7 (top6 + other)
  const violationKeyIndex = new Map(violationKeys.map((k, i) => [k, i]));

  // Collect all months seen across all streets, sorted ascending.
  const monthSet = new Set();
  for (const ymMap of streetMonthly.values()) {
    for (const ym of ymMap.keys()) monthSet.add(ym);
  }
  const months = [...monthSet].sort();
  const monthIndex = new Map(months.map((ym, i) => [ym, i]));

  const byStreet = {};
  for (const [norm, ymMap] of streetMonthly) {
    const tuples = [];
    for (const [ym, rawDescMap] of ymMap) {
      const idx = monthIndex.get(ym);
      const vec = new Array(violationKeys.length).fill(0);
      let total = 0;
      for (const [desc, n] of rawDescMap) {
        const key = descToKey.get(desc) || 'other';
        const vi = violationKeyIndex.get(key);
        if (vi !== undefined) { vec[vi] += n; total += n; }
      }
      if (total > 0) tuples.push([idx, vec]);
    }
    if (tuples.length > 0) {
      tuples.sort((a, b) => a[0] - b[0]);
      byStreet[norm] = tuples;
    }
  }

  return { months, violations: violationKeys, byStreet };
}

function buildStreetsGeoJSON(streetFc, streetIndex, descToKey) {
  // For each street feature, simplify geometry + attach aggregate properties keyed by normalized name.
  // Drop features that don't simplify to a usable line.
  const features = [];
  let matched = 0;
  for (const f of streetFc.features) {
    const display = streetDisplayFromFeature(f.properties || {});
    if (!display) continue;
    const norm = normalizeStreet(display);
    const stat = streetIndex.streets[norm];
    const geom = simplifyGeometry(f.geometry, SIMPLIFY_TOL);
    const hasGeom = geom && (
      (geom.type === 'LineString' && geom.coordinates.length >= 2) ||
      (geom.type === 'MultiLineString' && geom.coordinates.some(l => l.length >= 2))
    );
    if (!hasGeom) continue;
    if (stat) matched++;
    features.push({
      type: 'Feature',
      geometry: geom,
      properties: {
        name: norm,
        display: stat ? stat.display : display,
        count: stat ? stat.count : 0,
        rank: stat ? stat.rank : null,
        byViolation: stat ? stat.byViolation : {},
      },
    });
  }
  console.log(`[streets] matched ${matched} / ${features.length} segments to ticket data`);
  return { type: 'FeatureCollection', features };
}

function buildTimeJson(hourByDay, monthly, hourByDayAll, monthlyAll, hourByDayByMonthRaw, catalog, descToKey) {
  const hourByDayByViolation = {
    _all: hourByDayAll,
  };
  const monthlyByViolation = {
    _all: [...monthlyAll.entries()].sort().map(([ym, n]) => ({ ym, n })),
  };

  // Bucket per-violation arrays into top6+other.
  const hBucket = new Map(); // key -> int[7][24]
  for (const [desc, mat] of hourByDay) {
    const key = descToKey.get(desc) || 'other';
    if (!hBucket.has(key)) hBucket.set(key, Array.from({ length: 7 }, () => new Array(24).fill(0)));
    const dst = hBucket.get(key);
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) dst[d][h] += mat[d][h];
  }
  for (const [key, mat] of hBucket) hourByDayByViolation[key] = mat;

  const mBucket = new Map(); // key -> Map<ym,n>
  for (const [desc, m] of monthly) {
    const key = descToKey.get(desc) || 'other';
    if (!mBucket.has(key)) mBucket.set(key, new Map());
    const dst = mBucket.get(key);
    for (const [ym, n] of m) dst.set(ym, (dst.get(ym) || 0) + n);
  }
  for (const [key, m] of mBucket) {
    monthlyByViolation[key] = [...m.entries()].sort().map(([ym, n]) => ({ ym, n }));
  }

  // Build per-month hour×day-by-violation (_all + top6 + other).
  const violationKeys = catalog.map(c => c.key); // top6 + other
  const allMonths = [...hourByDayByMonthRaw.keys()].sort();
  const zeroMat = () => Array.from({ length: 7 }, () => new Array(24).fill(0));

  const hourByDayByMonth = {};
  for (const ym of allMonths) {
    const rawDescMap = hourByDayByMonthRaw.get(ym); // Map<rawDesc, int[7][24]>
    // Bucket by violation key.
    const keyMats = new Map(); // key -> int[7][24]
    const allMat = zeroMat();
    for (const [desc, mat] of rawDescMap) {
      const key = descToKey.get(desc) || 'other';
      if (!keyMats.has(key)) keyMats.set(key, zeroMat());
      const dst = keyMats.get(key);
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
        dst[d][h] += mat[d][h];
        allMat[d][h] += mat[d][h];
      }
    }
    const entry = { _all: allMat };
    for (const vk of violationKeys) entry[vk] = keyMats.get(vk) || zeroMat();
    hourByDayByMonth[ym] = entry;
  }

  return { hourByDayByViolation, monthlyByViolation, hourByDayByMonth };
}

(async () => {
  const startedAt = new Date().toISOString();
  const [ticketRows, streetFc] = await Promise.all([
    fetchTickets(),
    fetchStreetsGeoJSON(),
  ]);

  console.log(`[aggregate] ${ticketRows.length} ticket rows`);
  const agg = aggregate(ticketRows);
  console.log(`[aggregate] kept=${agg.kept} withTime=${agg.withTime} uniqueStreets=${agg.streetTotals.size} uniqueViolations=${agg.violationTotals.size}`);

  const { catalog, descToKey } = buildCatalog(agg.violationTotals);
  console.log(`[catalog] top-${TOP_N_VIOLATIONS}+other:`, catalog.map(c => `${c.key}=${c.count}`).join(', '));

  const streetIndex = buildStreetIndex(agg.streetTotals, descToKey);
  const streetsGeoJSON = buildStreetsGeoJSON(streetFc, streetIndex, descToKey);
  const timeJson = buildTimeJson(agg.hourByDay, agg.monthly, agg.hourByDayAll, agg.monthlyAll, agg.hourByDayByMonth, catalog, descToKey);
  const streetsTime = buildStreetsTime(agg.streetMonthly, catalog, descToKey);

  // Strip rawDesc from catalog before writing meta (internal mapping only).
  const publicCatalog = catalog.map(({ rawDesc, ...rest }) => rest);

  const meta = {
    generatedAt: startedAt,
    since: SINCE,
    rowCount: ticketRows.length,
    keptRowCount: agg.kept,
    withTimeRowCount: agg.withTime,
    streetCount: Object.keys(streetIndex.streets).length,
    rawId: RAW_ID,
    streetsId: STREETS_ID,
    dateRange: agg.dateMin && agg.dateMax ? {
      from: agg.dateMin.toISOString().slice(0, 10),
      to:   agg.dateMax.toISOString().slice(0, 10),
    } : null,
    violationCatalog: publicCatalog,
    months: streetsTime.months,
    sample: false,
  };

  const streetsGeoPath  = resolve(OUT_DIR, 'streets.geojson');
  const streetsPath     = resolve(OUT_DIR, 'streets.json');
  const timePath        = resolve(OUT_DIR, 'time.json');
  const metaPath        = resolve(OUT_DIR, 'meta.json');
  const streetsTimePath = resolve(OUT_DIR, 'streets-time.json');
  const obsoleteHeatmap = resolve(OUT_DIR, 'heatmap.json');

  writeFileSync(streetsGeoPath,  JSON.stringify(streetsGeoJSON));
  writeFileSync(streetsPath,     JSON.stringify(streetIndex.streets));
  writeFileSync(timePath,        JSON.stringify(timeJson));
  writeFileSync(metaPath,        JSON.stringify(meta, null, 2));
  writeFileSync(streetsTimePath, JSON.stringify(streetsTime));
  if (existsSync(obsoleteHeatmap)) unlinkSync(obsoleteHeatmap);

  const paths = [streetsGeoPath, streetsPath, timePath, metaPath, streetsTimePath];
  let totalBytes = 0;
  console.log('\nWrote:');
  for (const p of paths) {
    const s = statSync(p).size;
    totalBytes += s;
    console.log(`  ${p.split('/').slice(-2).join('/')}: ${(s / 1024).toFixed(1)} KB`);
  }
  console.log(`  TOTAL: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  if (totalBytes > BUDGET_BYTES) {
    console.error(`\nERROR: artifacts total ${(totalBytes / 1024 / 1024).toFixed(2)} MB (>${BUDGET_BYTES / 1024 / 1024} MB cap).`);
    console.error('Raise --simplify-tol or shorten --since to reduce.');
    process.exit(1);
  }
})().catch(err => {
  console.error('\nBUILD FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
