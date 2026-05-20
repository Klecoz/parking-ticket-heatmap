// Risk calculator: shows the selected street's rank among all streets by
// ticket count. Also supports pin-on-map → snap-to-nearest-street.

import { getMap } from "./map.js";
import { getPin, getState, setPin, setStreet, subscribe } from "./state.js";
import { fmt, isJunkStreet, normalizeStreet, titleCase } from "./util.js";

let allStreets = null;
let streetIndex = null; // [{ norm, display, count, rank }]
let totalStreets = 0;
let streetsFc = null;
let pinMarker = null;
let pinMode = false;

export function mountRisk({ streets, streetsFc: fc, streetCount }) {
  allStreets = streets;
  totalStreets =
    streetCount || Object.keys(streets).filter((k) => !isJunkStreet(k)).length;
  streetsFc = fc;

  streetIndex = Object.entries(streets)
    .filter(([norm]) => !isJunkStreet(norm))
    .map(([norm, v]) => ({
      norm,
      display: v.display,
      count: v.count,
      rank: v.rank,
    }))
    .sort((a, b) => a.rank - b.rank);

  bindSearch();
  bindControls();
  bindMapPin();
  hydratePin();

  subscribe(render);
  render();

  // Populate the search input if a street was hydrated from the URL hash.
  const initialStreet = getState().street;
  if (initialStreet && allStreets[initialStreet]) {
    const input = document.getElementById("riskStreet");
    if (input) input.value = titleCase(allStreets[initialStreet].display);
  }
}

function bindSearch() {
  const input = document.getElementById("riskStreet");
  const sug = document.getElementById("riskSuggestions");
  if (!input || !sug) return;
  let activeIdx = -1;

  const close = () => {
    sug.classList.remove("open");
    sug.innerHTML = "";
    activeIdx = -1;
  };

  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (q.length < 2) {
      close();
      return;
    }
    const qNorm = normalizeStreet(q) || "";
    const matches = streetIndex
      .filter((s) => s.norm.includes(qNorm))
      .slice(0, 8);
    if (!matches.length) {
      close();
      return;
    }
    sug.innerHTML = "";
    matches.forEach((m) => {
      const li = document.createElement("li");
      li.dataset.norm = m.norm;
      li.innerHTML = `<span>${escapeHtml(titleCase(m.display))}</span><span class="sug-count">#${m.rank} · ${fmt(m.count)}</span>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = titleCase(m.display);
        setStreet(m.norm);
        close();
      });
      sug.appendChild(li);
    });
    sug.classList.add("open");
  });

  input.addEventListener("keydown", (e) => {
    const items = sug.querySelectorAll("li");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(items.length - 1, activeIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && items[activeIdx]) {
        const norm = items[activeIdx].dataset.norm;
        input.value = items[activeIdx].querySelector("span").textContent;
        setStreet(norm);
        close();
      }
    } else if (e.key === "Escape") {
      close();
    }
    items.forEach((el, i) => {
      el.classList.toggle("active", i === activeIdx);
    });
  });

  input.addEventListener("blur", () => setTimeout(close, 120));
}

function bindControls() {
  const ids = ["riskDay", "riskHour", "riskDuration"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", render);
    if (el) el.addEventListener("input", render);
  });

  const pinBtn = document.getElementById("riskDropPin");
  if (pinBtn) {
    pinBtn.addEventListener("click", () => {
      pinMode = !pinMode;
      pinBtn.classList.toggle("active", pinMode);
      pinBtn.textContent = pinMode ? "Click the map…" : "Drop pin on map";
      const map = getMap();
      if (map) map.getContainer().style.cursor = pinMode ? "crosshair" : "";
    });
  }
}

function bindMapPin() {
  const map = getMap();
  if (!map) return;
  map.on("click", (e) => {
    if (!pinMode) return;
    pinMode = false;
    const pinBtn = document.getElementById("riskDropPin");
    if (pinBtn) {
      pinBtn.classList.remove("active");
      pinBtn.textContent = "Drop pin on map";
    }
    map.getContainer().style.cursor = "";
    const { lat, lng } = e.latlng;
    setPin({ lat, lng });
    snapToNearestStreet(lat, lng);
  });
}

function hydratePin() {
  const pin = getPin();
  if (!pin) return;
  drawPin(pin);
  snapToNearestStreet(pin.lat, pin.lng);
}

function drawPin(pin) {
  const map = getMap();
  if (!map) return;
  if (!pin) {
    if (pinMarker) {
      pinMarker.remove();
      pinMarker = null;
    }
    return;
  }
  if (pinMarker) {
    pinMarker.setLatLng([pin.lat, pin.lng]);
    return;
  }
  pinMarker = L.marker([pin.lat, pin.lng], { draggable: true });
  pinMarker.addTo(map);
  pinMarker.on("dragend", () => {
    const { lat, lng } = pinMarker.getLatLng();
    setPin({ lat, lng });
    snapToNearestStreet(lat, lng);
  });
}

function snapToNearestStreet(lat, lng) {
  if (!streetsFc?.features?.length) return;
  let best = null,
    bestD = Infinity;
  for (const f of streetsFc.features) {
    const d = minDistToGeometry([lng, lat], f.geometry);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  if (best?.properties?.name) {
    const norm = best.properties.name;
    setStreet(norm);
    const input = document.getElementById("riskStreet");
    if (input && allStreets[norm])
      input.value = titleCase(allStreets[norm].display);
  }
}

function minDistToGeometry(point, geom) {
  if (!geom) return Infinity;
  if (geom.type === "LineString") return minDistToLine(point, geom.coordinates);
  if (geom.type === "MultiLineString") {
    let m = Infinity;
    for (const l of geom.coordinates) {
      const d = minDistToLine(point, l);
      if (d < m) m = d;
    }
    return m;
  }
  return Infinity;
}

function minDistToLine(p, coords) {
  let m = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const d = sqSegDist(p, coords[i - 1], coords[i]);
    if (d < m) m = d;
  }
  return m;
}

function sqSegDist(p, a, b) {
  let x = a[0],
    y = a[1];
  let dx = b[0] - x,
    dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function render() {
  drawPin(getPin());

  const readout = document.getElementById("riskReadout");
  if (!readout) return;

  const state = getState();
  const norm = state.street;

  if (!norm || !allStreets[norm]) {
    readout.innerHTML =
      '<p class="risk-empty">Search a street or drop a pin to see your rank.</p>';
    return;
  }

  const street = allStreets[norm];
  const rank = street.rank;
  const percentile = Math.round(((totalStreets - rank) / totalStreets) * 100);

  readout.innerHTML = `
    <div class="risk-card">
      <div class="risk-detail">
        <div class="risk-detail-row">
          <strong>${escapeHtml(titleCase(street.display))}</strong>
        </div>
        <div class="risk-rank-output">
          Ranks <strong>#${fmt(rank)}</strong> of ${fmt(totalStreets)} — ${percentile}th percentile
        </div>
        <div class="risk-detail-row muted">
          ${fmt(street.count)} total tickets
        </div>
      </div>
    </div>
  `;
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
