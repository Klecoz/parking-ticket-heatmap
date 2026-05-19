// Renders Buffalo street centerlines as a Leaflet GeoJSON layer.
// Per-feature stroke color reflects the active violation filter.

import { getFilter, subscribe } from './state.js';
import { fmt, rampColor, rampValue } from './util.js';

const BUFFALO_CENTER = [42.886, -78.878];
const DEFAULT_ZOOM   = 12;

let map, layer, allFeatures = [], onPickStreet = null;
let maxForFilter = new Map(); // filter key -> max street count

export function mountMap({ streetsFc, onStreetSelected }) {
  onPickStreet = onStreetSelected;

  map = L.map('map', { preferCanvas: true, zoomControl: true }).setView(BUFFALO_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  allFeatures = streetsFc.features || [];
  precomputeMaxes(allFeatures);

  layer = L.geoJSON(streetsFc, {
    style: (f) => styleFor(f),
    onEachFeature: (f, lyr) => bindFeature(f, lyr),
  }).addTo(map);

  subscribe(() => layer.setStyle((f) => styleFor(f)));

  // Fit to Buffalo bbox once data is on.
  try {
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] });
  } catch (_) { /* fall through */ }
}

function precomputeMaxes(features) {
  // Compute max per filter key, including '_all'.
  const accAll = new Map();
  for (const f of features) {
    const c = f.properties?.count || 0;
    if (c > (accAll.get('_all') || 0)) accAll.set('_all', c);
    const bv = f.properties?.byViolation || {};
    for (const k in bv) {
      if (bv[k] > (accAll.get(k) || 0)) accAll.set(k, bv[k]);
    }
  }
  maxForFilter = accAll;
}

function valueFor(props, filter) {
  if (filter === '_all') return props.count || 0;
  return (props.byViolation && props.byViolation[filter]) || 0;
}

function styleFor(feature) {
  const f = getFilter();
  const v = valueFor(feature.properties || {}, f);
  const max = maxForFilter.get(f) || 1;
  const t = rampValue(v, max);
  const isHot = v > 0;
  return {
    color: isHot ? rampColor(Math.max(0.18, t)) : 'rgba(180, 175, 168, 0.45)',
    weight: isHot ? (t > 0.6 ? 3 : t > 0.25 ? 2.2 : 1.6) : 1,
    opacity: isHot ? 0.95 : 0.5,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

function bindFeature(feature, layerObj) {
  layerObj.on('mouseover', () => {
    layerObj.setStyle({ weight: Math.max(4, (layerObj.options.weight || 2) + 2) });
    layerObj.bringToFront();
  });
  layerObj.on('mouseout', () => layerObj.setStyle(styleFor(feature)));
  layerObj.on('click', () => {
    const props = feature.properties || {};
    const f = getFilter();
    const v = valueFor(props, f);
    const html = `<strong>${escapeHtml(props.display || props.name)}</strong>`
      + `${fmt(v)} ${f === '_all' ? 'tickets' : 'tickets (filtered)'} since 2024`
      + (props.rank ? `<br>citywide rank #${fmt(props.rank)}` : '');
    layerObj.bindPopup(html, { closeButton: true, autoPan: true }).openPopup();
    if (onPickStreet && props.name) onPickStreet(props.name);
  });
}

export function highlightStreet(normName) {
  if (!layer) return;
  // Find the feature(s) for the chosen street and pan/zoom to them.
  const matches = [];
  layer.eachLayer((lyr) => {
    if (lyr.feature?.properties?.name === normName) matches.push(lyr);
  });
  if (!matches.length) return;
  const group = L.featureGroup(matches);
  try {
    const b = group.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.5), { maxZoom: 16, animate: true });
  } catch (_) { /* ignore */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
