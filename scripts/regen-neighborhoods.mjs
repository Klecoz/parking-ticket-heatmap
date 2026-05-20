#!/usr/bin/env node
// Regenerates data/neighborhoods.json from existing data/ files without Socrata.
// Requires: data/streets.geojson, data/meta.json, data/neighborhoods.geojson
// Output: data/neighborhoods.json (new shape: { neighborhoods, streetNeighborhood })
//         data/neighborhoods.geojson (updated with ticketCount)

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'data');

function segmentCentroid(geometry) {
  let sumLng = 0, sumLat = 0, n = 0;
  const addCoords = coords => { for (const [lng, lat] of coords) { sumLng += lng; sumLat += lat; n++; } };
  if (geometry.type === 'LineString') addCoords(geometry.coordinates);
  else if (geometry.type === 'MultiLineString') geometry.coordinates.forEach(addCoords);
  return n > 0 ? [sumLng / n, sumLat / n] : null;
}

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lng, lat, geometry) {
  if (geometry.type === 'Polygon') return pointInRing(lng, lat, geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(poly => pointInRing(lng, lat, poly[0]));
  return false;
}

const streetsGeoJSON = JSON.parse(readFileSync(resolve(OUT_DIR, 'streets.geojson'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(OUT_DIR, 'meta.json'), 'utf8'));
const neighborhoodsGeoPath = resolve(OUT_DIR, 'neighborhoods.geojson');

if (!existsSync(neighborhoodsGeoPath)) {
  console.error('data/neighborhoods.geojson not found');
  process.exit(1);
}

const neighborhoodsFc = JSON.parse(readFileSync(neighborhoodsGeoPath, 'utf8'));
const catalog = meta.violationCatalog || [];
const violationKeys = catalog.map(c => c.key);

const neighborhoods = neighborhoodsFc.features.map(f => ({
  key: f.properties.key,
  name: f.properties.name,
  geometry: f.geometry,
  ticketCount: 0,
  streetCount: 0,
  byViolation: {},
  _streetCounts: [],
}));

const streetNeighborhood = {};

for (const seg of streetsGeoJSON.features) {
  const { count, byViolation, name: streetName, display } = seg.properties;
  const centroid = segmentCentroid(seg.geometry);
  if (!centroid) continue;
  const [lng, lat] = centroid;

  for (const nbr of neighborhoods) {
    if (!pointInPolygon(lng, lat, nbr.geometry)) continue;
    nbr.ticketCount += count || 0;
    if (count > 0) nbr.streetCount++;
    if (count > 0) nbr._streetCounts.push({ name: display || streetName, count });
    if (byViolation) {
      for (const vk of violationKeys) {
        if (byViolation[vk]) nbr.byViolation[vk] = (nbr.byViolation[vk] || 0) + byViolation[vk];
      }
    }
    const normKey = streetName;
    if (normKey && !(normKey in streetNeighborhood)) {
      streetNeighborhood[normKey] = nbr.key;
    }
    break;
  }
}

const result = neighborhoods
  .map(nbr => {
    const merged = new Map();
    for (const { name, count } of nbr._streetCounts) {
      merged.set(name, (merged.get(name) || 0) + count);
    }
    const topStreets = [...merged.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    return {
      key: nbr.key,
      name: nbr.name,
      ticketCount: nbr.ticketCount,
      streetCount: nbr.streetCount,
      topStreets,
      byViolation: nbr.byViolation,
    };
  })
  .sort((a, b) => b.ticketCount - a.ticketCount);

const ticketByKey = new Map(result.map(r => [r.key, r.ticketCount]));
const augmentedFc = {
  ...neighborhoodsFc,
  features: neighborhoodsFc.features.map(f => ({
    ...f,
    properties: { ...f.properties, ticketCount: ticketByKey.get(f.properties.key) || 0 },
  })),
};

const neighborhoodsJsonPath = resolve(OUT_DIR, 'neighborhoods.json');
writeFileSync(neighborhoodsJsonPath, JSON.stringify({ neighborhoods: result, streetNeighborhood }));
writeFileSync(neighborhoodsGeoPath, JSON.stringify(augmentedFc));
console.log(`Wrote ${result.length} neighborhoods + ${Object.keys(streetNeighborhood).length} street mappings → neighborhoods.json`);
