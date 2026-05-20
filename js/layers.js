// Buffalo context overlays: neighborhoods, meter zones, permit zones, venues.
// All overlays are off by default and toggle via state.layers (URL-syncable).

import { getMap } from "./map.js";
import { getLayers, subscribe, toggleLayer } from "./state.js";

const LAYER_STYLES = {
  neighborhoods: {
    color: "#0b7ab1",
    fillColor: "#0b7ab1",
    fillOpacity: 0.06,
    weight: 1.5,
    dashArray: "4 3",
  },
  meter: {
    color: "#c2453a",
    fillColor: "#c2453a",
    fillOpacity: 0.12,
    weight: 1.5,
  },
  permit: {
    color: "#b48a00",
    fillColor: "#b48a00",
    fillOpacity: 0.12,
    weight: 1.5,
    dashArray: "6 4",
  },
};

let neighborhoodsFc = null;
let meterFc = null;
let permitFc = null;
let eventsData = null;

// Leaflet layers
const layerInstances = {
  neighborhoods: null,
  meter: null,
  permit: null,
  venues: null,
};

export async function mountLayers() {
  bindToggleButtons();

  // Load all overlay JSON in parallel, but don't block mount on failures.
  try {
    [neighborhoodsFc, meterFc, permitFc, eventsData] = await Promise.all([
      fetchJson("data/neighborhoods.geojson"),
      fetchJson("data/meter-zones.geojson"),
      fetchJson("data/permit-zones.geojson"),
      fetchJson("data/events.json"),
    ]);
  } catch (err) {
    console.warn("[layers] failed to load one or more overlays:", err);
  }

  subscribe(syncLayers);
  syncLayers();
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function bindToggleButtons() {
  const btns = document.querySelectorAll(".overlay-toggle");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.layer;
      if (!key) return;
      toggleLayer(key);
    });
  });
}

function applyButtonStates() {
  const active = getLayers();
  document.querySelectorAll(".overlay-toggle").forEach((btn) => {
    const on = active.has(btn.dataset.layer);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.classList.toggle("active", on);
  });
}

function syncLayers() {
  applyButtonStates();
  const active = getLayers();
  const map = getMap();
  if (!map) return;

  ensureLayerInstance("neighborhoods", neighborhoodsFc);
  ensureLayerInstance("meter", meterFc);
  ensureLayerInstance("permit", permitFc);
  ensureVenueLayer(eventsData);

  for (const [key, layer] of Object.entries(layerInstances)) {
    if (!layer) continue;
    if (active.has(key)) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }
}

function ensureLayerInstance(key, fc) {
  if (layerInstances[key] || !fc) return;
  const style = LAYER_STYLES[key] || {
    color: "#666",
    fillOpacity: 0.05,
    weight: 1,
  };
  layerInstances[key] = L.geoJSON(fc, {
    style,
    renderer: L.svg(),
    onEachFeature: (feature, lyr) => {
      const p = feature.properties || {};
      const html =
        `<strong>${escapeHtml(p.name || key)}</strong>` +
        (p.rules
          ? `<br/><span style="color:#6b6560">${escapeHtml(p.rules)}</span>`
          : "") +
        (p.hours
          ? `<br/><span style="color:#6b6560">${escapeHtml(p.hours)}</span>`
          : "");
      lyr.bindTooltip(html, { sticky: true });
    },
  });
}

function ensureVenueLayer(data) {
  if (layerInstances.venues || !data?.venues?.length) return;
  const group = L.layerGroup();
  for (const v of data.venues) {
    if (typeof v.lat !== "number" || typeof v.lng !== "number") continue;
    const marker = L.circleMarker([v.lat, v.lng], {
      radius: 8,
      color: "#1a6b4a",
      fillColor: "#1a6b4a",
      fillOpacity: 0.85,
      weight: 2,
    });
    marker.bindTooltip(
      `<strong>${escapeHtml(v.name)}</strong><br/><span style="color:#6b6560">Location only — no game-day ticket data available.</span>`,
      { direction: "top", offset: [0, -8] },
    );
    group.addLayer(marker);
  }
  layerInstances.venues = group;
}

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
