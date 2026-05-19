#!/usr/bin/env node
// Pulls Buffalo parking summons data from data.buffalony.gov (Socrata SODA API)
// and writes three static JSON artifacts consumed by the /parking-heatmap/ page.
//
// Usage:
//   node parking-heatmap/scripts/build-data.js
//   node parking-heatmap/scripts/build-data.js --since 2023-01-01 --grid 0.0008
//   node parking-heatmap/scripts/build-data.js --raw-id yvvn-sykd --street-id es5y-a4h6
//
// Requires Node 20+ (uses global fetch). No npm install.

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
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

const RAW_ID    = args['raw-id']    || 'yvvn-sykd';
const STREET_ID = args['street-id'] || 'es5y-a4h6';
const SINCE     = args['since']     || '2023-01-01';
const GRID      = parseFloat(args['grid'] || '0.0008');
const PAGE      = parseInt(args['page-size'] || '50000', 10);
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || '';

const BUFFALO_BBOX = {
  minLat: 42.82, maxLat: 42.97,
  minLng: -78.95, maxLng: -78.79,
};

const headers = APP_TOKEN ? { 'X-App-Token': APP_TOKEN } : {};

async function soda(path) {
  const url = `https://data.buffalony.gov/resource/${path}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`SODA ${res.status} ${res.statusText}: ${url}`);
  }
  return res.json();
}

function pickLat(row) {
  if (row.latitude != null) return parseFloat(row.latitude);
  if (row.location?.latitude != null) return parseFloat(row.location.latitude);
  if (row.location?.coordinates?.[1] != null) return row.location.coordinates[1];
  if (row.geocoded_column?.latitude != null) return parseFloat(row.geocoded_column.latitude);
  return null;
}

function pickLng(row) {
  if (row.longitude != null) return parseFloat(row.longitude);
  if (row.location?.longitude != null) return parseFloat(row.location.longitude);
  if (row.location?.coordinates?.[0] != null) return row.location.coordinates[0];
  if (row.geocoded_column?.longitude != null) return parseFloat(row.geocoded_column.longitude);
  return null;
}

function pickStreet(row) {
  return row.street || row.street_name || row.block || row.address || row.location_street || null;
}

function pickViolation(row) {
  return row.violation_description || row.description || row.violation || row.violation_code || 'UNKNOWN';
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
    .replace(/\s+/g, ' ')
    .trim();
}

function inBuffalo(lat, lng) {
  return lat >= BUFFALO_BBOX.minLat && lat <= BUFFALO_BBOX.maxLat
      && lng >= BUFFALO_BBOX.minLng && lng <= BUFFALO_BBOX.maxLng;
}

async function buildHeatmap() {
  console.log(`[heatmap] paginating ${RAW_ID} since ${SINCE} (page=${PAGE})`);
  const bins = new Map();
  let offset = 0;
  let total = 0;
  let kept = 0;

  while (true) {
    const path = `${RAW_ID}.json?$limit=${PAGE}&$offset=${offset}`
      + `&$where=issue_date >= '${SINCE}T00:00:00'`;
    const rows = await soda(path);
    if (!rows.length) break;
    total += rows.length;

    for (const row of rows) {
      const lat = pickLat(row);
      const lng = pickLng(row);
      if (lat == null || lng == null || !inBuffalo(lat, lng)) continue;
      const bLat = Math.round(lat / GRID) * GRID;
      const bLng = Math.round(lng / GRID) * GRID;
      const key = `${bLat.toFixed(5)},${bLng.toFixed(5)}`;
      bins.set(key, (bins.get(key) || 0) + 1);
      kept++;
    }
    console.log(`[heatmap] offset=${offset} fetched=${rows.length} kept=${kept}/${total} bins=${bins.size}`);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  const points = [...bins.entries()].map(([k, w]) => {
    const [lat, lng] = k.split(',').map(parseFloat);
    return [lat, lng, w];
  });
  console.log(`[heatmap] ${points.length} bins from ${kept} geolocated rows (${total} total)`);
  return { points, total, kept };
}

async function buildStreetStats() {
  console.log(`[streets] aggregating ${RAW_ID} by street + violation since ${SINCE}`);
  const path = `${RAW_ID}.json`
    + `?$select=street,violation_description,count(*) as c`
    + `&$where=issue_date >= '${SINCE}T00:00:00' AND street IS NOT NULL`
    + `&$group=street,violation_description`
    + `&$order=c DESC&$limit=200000`;

  let rows;
  try {
    rows = await soda(path);
  } catch (err) {
    console.warn(`[streets] grouped query failed (${err.message}); falling back to ${STREET_ID}`);
    rows = await soda(`${STREET_ID}.json?$limit=200000`);
  }

  const byStreet = new Map();
  for (const r of rows) {
    const display = pickStreet(r);
    if (!display) continue;
    const norm = normalizeStreet(display);
    if (!norm) continue;
    const c = parseInt(r.c || r.count || r.summonses || r.total || '1', 10);
    const violation = pickViolation(r);
    const entry = byStreet.get(norm) || { display, count: 0, violations: new Map() };
    entry.count += c;
    entry.violations.set(violation, (entry.violations.get(violation) || 0) + c);
    if (display.length < entry.display.length) entry.display = display;
    byStreet.set(norm, entry);
  }

  const sorted = [...byStreet.entries()]
    .map(([norm, v]) => ({
      norm,
      display: v.display,
      count: v.count,
      topViolations: [...v.violations.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([desc, count]) => ({ desc, count })),
    }))
    .sort((a, b) => b.count - a.count);

  const out = {};
  sorted.forEach((s, i) => {
    out[s.norm] = {
      display: s.display,
      count: s.count,
      rank: i + 1,
      topViolations: s.topViolations,
    };
  });
  console.log(`[streets] ${sorted.length} unique streets`);
  return { streets: out, streetCount: sorted.length };
}

(async () => {
  const startedAt = new Date().toISOString();

  const [heatmap, streetsRes] = await Promise.all([
    buildHeatmap(),
    buildStreetStats(),
  ]);

  const heatmapPath = resolve(OUT_DIR, 'heatmap.json');
  const streetsPath = resolve(OUT_DIR, 'streets.json');
  const metaPath    = resolve(OUT_DIR, 'meta.json');

  writeFileSync(heatmapPath, JSON.stringify({ grid: GRID, points: heatmap.points }));
  writeFileSync(streetsPath, JSON.stringify(streetsRes.streets));
  writeFileSync(metaPath, JSON.stringify({
    generatedAt: startedAt,
    since: SINCE,
    rowCount: heatmap.total,
    geolocatedRowCount: heatmap.kept,
    streetCount: streetsRes.streetCount,
    rawId: RAW_ID,
    streetId: STREET_ID,
    sample: false,
  }, null, 2));

  const sizes = [heatmapPath, streetsPath, metaPath].map(p => {
    const s = statSync(p).size;
    return `${p.split('/').slice(-2).join('/')}: ${(s / 1024).toFixed(1)} KB`;
  });
  console.log('\nWrote:\n  ' + sizes.join('\n  '));

  const totalBytes = [heatmapPath, streetsPath, metaPath]
    .reduce((sum, p) => sum + statSync(p).size, 0);
  if (totalBytes > 4 * 1024 * 1024) {
    console.error(`\nERROR: artifacts total ${(totalBytes / 1024 / 1024).toFixed(2)} MB (>4MB cap).`);
    console.error('Raise --grid or shorten --since to reduce.');
    process.exit(1);
  }
})().catch(err => {
  console.error('\nBUILD FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
