// Renders Buffalo street centerlines as a Leaflet GeoJSON layer.
// Per-feature stroke color reflects the active violation filter + date range.

import { getState, subscribe } from './state.js';
import { getMaxCount, getStreetCount } from './timeIndex.js';
import { fmt, rampColor, rampValue } from './util.js';

const BUFFALO_CENTER = [42.886, -78.878];
const DEFAULT_ZOOM   = 12;

let map, layer, onPickStreet = null;

export function mountMap({ streetsFc, onStreetSelected }) {
  onPickStreet = onStreetSelected;

  map = L.map('map', {
    preferCanvas: true,
    zoomControl: true,
    scrollWheelZoom: false,  // replaced by custom handler below
    zoomSnap: 0,             // allow fractional zoom for smooth feel
    zoomDelta: 0.5,
  }).setView(BUFFALO_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  installSmoothWheelZoom(map);

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

function styleFor(feature) {
  const state = getState();
  const norm = feature.properties?.name;
  const v = getStreetCount(norm, state);
  const max = getMaxCount(state);
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
    const state = getState();
    const norm = props.name;
    const v = getStreetCount(norm, state);
    const html = `<strong>${escapeHtml(props.display || props.name)}</strong>`
      + `${fmt(v)} ${state.filter === '_all' ? 'tickets' : 'tickets (filtered)'} since 2024`
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

// Custom wheel handler:
//   * Smooth (fractional) zoom — Leaflet's zoomSnap:0 + setZoomAround per event.
//   * Trackpad direction is flipped (scroll down = zoom in) to match macOS Maps;
//     coarse mouse wheel keeps the conventional direction.
//   * Trackpad detection: small deltaY at deltaMode 0 = pixel-precision = trackpad.
function installSmoothWheelZoom(mapInstance) {
  const mapDiv = mapInstance.getContainer();
  mapDiv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const isTrackpad = Math.abs(e.deltaY) < 40 && e.deltaMode === 0;
    // Sign convention: positive dZoom = zoom in.
    //   Mouse wheel default (Leaflet): scroll up (negative deltaY) → zoom in. dir = -1.
    //   Trackpad (user request):       scroll up (negative deltaY) → zoom out. dir = +1.
    const dir = isTrackpad ? +1 : -1;
    const factor = isTrackpad ? 0.008 : (0.5 / 120);
    const dZoom = dir * e.deltaY * factor;
    if (!dZoom) return;
    const z = mapInstance.getZoom();
    const newZ = Math.max(mapInstance.getMinZoom(), Math.min(mapInstance.getMaxZoom(), z + dZoom));
    const pt = mapInstance.mouseEventToContainerPoint(e);
    mapInstance.setZoomAround(mapInstance.containerPointToLatLng(pt), newZ, { animate: false });
  }, { passive: false });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
