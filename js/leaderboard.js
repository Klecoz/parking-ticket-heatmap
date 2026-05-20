// Inline leaderboard with horizontal bars. Reacts to filter + range changes.

import {
  clearNeighborhood,
  getFilter,
  getRange,
  getState,
  setNeighborhood,
  subscribe,
} from "./state.js";
import { getStreetCounts } from "./timeIndex.js";
import { fmt, isJunkStreet, titleCase } from "./util.js";

let allStreets = null; // { [norm]: { display, count, byViolation, ... } }
let catalogByKey = null;
let catalogList = [];
let metaMonths = []; // ["2024-01", ...]
let neighborhoodData = []; // pre-sorted array from neighborhoods.json
let showAll = false;
let onPick = null;
let activeTab = "streets"; // "streets" | "neighborhoods"

const MN_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function mountLeaderboard({
  streets,
  catalog,
  months,
  neighborhoods,
  onStreetSelected,
}) {
  allStreets = streets;
  catalogByKey = new Map(catalog.map((c) => [c.key, c]));
  catalogList = catalog || [];
  metaMonths = months || [];
  neighborhoodData = neighborhoods || [];
  onPick = onStreetSelected;

  document.getElementById("leaderboardMore").addEventListener("click", () => {
    showAll = !showAll;
    render();
  });

  // Tab switching
  document.querySelectorAll(".lb-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.lbtab;
      applyTabState();
      render();
    });
  });

  render();
  subscribe(render);
}

function applyTabState() {
  document.querySelectorAll(".lb-tab").forEach((btn) => {
    const on = btn.dataset.lbtab === activeTab;
    btn.classList.toggle("lb-tab-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const streetPanel = document.getElementById("leaderboardList");
  const moreBtn = document.getElementById("leaderboardMore");
  const nbPanel = document.getElementById("leaderboardNeighborhoods");
  const modeEl = document.getElementById("leaderboardMode");
  if (activeTab === "neighborhoods") {
    if (streetPanel) streetPanel.hidden = true;
    if (moreBtn) moreBtn.hidden = true;
    if (nbPanel) nbPanel.hidden = false;
    if (modeEl)
      modeEl.innerHTML = `${neighborhoodData.length} neighborhoods &middot; <strong>all time</strong>`;
  } else {
    if (streetPanel) streetPanel.hidden = false;
    if (nbPanel) nbPanel.hidden = true;
  }
  if (modeEl) modeEl.hidden = false;
}

function activeLabel() {
  const f = getFilter();
  return f === "_all"
    ? "all violations"
    : catalogByKey?.get(f)?.label?.toLowerCase() || f;
}

// Format a range object to a short human label, e.g. "Mar '25" or "Mar '25 – May '26".
function formatRangeLabel(range, months) {
  if (!range || !months.length) return null;
  const fmt0 = (ym) => {
    const [y, m] = String(ym).split("-");
    return `${MN_SHORT[parseInt(m, 10) - 1] || m} '${y.slice(2)}`;
  };
  if (range.fromIdx === range.toIdx) return fmt0(months[range.fromIdx]);
  return `${fmt0(months[range.fromIdx])} – ${fmt0(months[range.toIdx])}`;
}

function renderBreadcrumb() {
  const state = getState();
  const nb = state.neighborhood;
  const container = document.getElementById("lbBreadcrumb");
  if (!container) return;
  if (!nb) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const nbData = neighborhoodData.find((n) => n.key === nb);
  const nbName = nbData ? nbData.name : nb;
  container.hidden = false;
  container.innerHTML =
    `<span class="nb-breadcrumb-label">Viewing: <strong>${escapeHtml(nbName)}</strong></span>` +
    `<button class="nb-breadcrumb-clear" type="button" aria-label="Clear neighborhood filter">× Clear</button>`;
  container
    .querySelector(".nb-breadcrumb-clear")
    .addEventListener("click", () => {
      clearNeighborhood();
    });
}

function render() {
  renderBreadcrumb();
  applyTabState();
  if (activeTab === "neighborhoods") {
    renderNeighborhoods();
  } else {
    renderStreets();
  }
}

function renderStreets() {
  const state = getState();
  const limit = showAll ? 100 : 20;

  // Get per-street counts from timeIndex (handles both fast-path and range-path).
  const counts = getStreetCounts(state);

  const ranked = [];
  for (const [norm, count] of counts) {
    if (isJunkStreet(norm)) continue;
    const display = allStreets[norm]?.display;
    if (display) ranked.push({ norm, display, count });
  }
  ranked.sort((a, b) => b.count - a.count);

  const top = ranked.slice(0, limit);
  const max = top[0]?.count || 1;

  const list = document.getElementById("leaderboardList");
  list.removeAttribute("aria-busy");
  list.innerHTML = "";
  for (let i = 0; i < top.length; i++) {
    const s = top[i];
    const li = document.createElement("li");

    const rank = document.createElement("span");
    rank.className = "lb-rank num";
    rank.textContent = String(i + 1);
    li.appendChild(rank);

    const btn = document.createElement("button");
    btn.className = "lb-button";
    btn.type = "button";
    btn.dataset.norm = s.norm;

    const name = document.createElement("span");
    name.className = "lb-name";
    name.textContent = titleCase(s.display);
    btn.appendChild(name);

    const bar = document.createElement("span");
    bar.className = "lb-bar";
    const fill = document.createElement("span");
    fill.className = "lb-bar-fill";
    fill.style.transform = `scaleX(${Math.max(0.02, s.count / max)})`;
    bar.appendChild(fill);
    btn.appendChild(bar);

    btn.addEventListener("click", () => onPick?.(s.norm));
    li.appendChild(btn);

    const count = document.createElement("span");
    count.className = "lb-count num";
    count.textContent = fmt(s.count);
    li.appendChild(count);

    list.appendChild(li);
  }

  const more = document.getElementById("leaderboardMore");
  if (ranked.length <= 20) {
    more.hidden = true;
  } else {
    more.hidden = false;
    more.textContent = showAll
      ? "← Show only top 20"
      : `Show next ${Math.min(80, ranked.length - 20)} →`;
  }

  const rangeLabel = formatRangeLabel(getRange(), metaMonths);
  const rangePart = rangeLabel ? ` · ${rangeLabel}` : "";
  document.getElementById("leaderboardMode").innerHTML =
    `Top ${top.length} &middot; <strong>${activeLabel()}</strong>${escapeHtml(rangePart)}`;
}

function renderNeighborhoods() {
  const container = document.getElementById("leaderboardNeighborhoods");
  if (!container) return;
  container.innerHTML = "";

  if (!neighborhoodData.length) {
    const empty = document.createElement("p");
    empty.className = "lb-nb-empty";
    empty.textContent = "Neighborhood data not available.";
    container.appendChild(empty);
    return;
  }

  const note = document.createElement("p");
  note.className = "lb-nb-note";
  note.textContent = "All-time totals — date-range filter does not apply.";
  container.appendChild(note);

  const max = neighborhoodData[0]?.ticketCount || 1;
  const activeNb = getState().neighborhood;

  for (let i = 0; i < neighborhoodData.length; i++) {
    const nb = neighborhoodData[i];
    const isActive = nb.key === activeNb;
    const row = document.createElement("div");
    row.className = `lb-nb-row${isActive ? " lb-nb-active" : ""}`;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-pressed", isActive ? "true" : "false");
    row.style.cursor = "pointer";

    // Rank + name
    const meta = document.createElement("div");
    meta.className = "lb-nb-meta";

    const rank = document.createElement("span");
    rank.className = "lb-rank num";
    rank.textContent = String(i + 1);
    meta.appendChild(rank);

    const name = document.createElement("span");
    name.className = "lb-nb-name";
    name.textContent = nb.name;
    meta.appendChild(name);

    const count = document.createElement("span");
    count.className = "lb-count num";
    count.textContent = fmt(nb.ticketCount);
    meta.appendChild(count);

    row.appendChild(meta);

    // Stacked violation-mix bar
    const barWrap = document.createElement("div");
    barWrap.className = "lb-nb-bar";
    const total = nb.ticketCount || 1;

    for (const entry of catalogList) {
      const n = nb.byViolation?.[entry.key] || 0;
      if (n === 0) continue;
      const seg = document.createElement("div");
      seg.className = "lb-nb-seg";
      seg.style.width = `${(n / total) * 100}%`;
      if (entry.color) seg.style.background = entry.color;
      seg.title = `${entry.label}: ${fmt(n)}`;
      barWrap.appendChild(seg);
    }
    // "other" bucket not in catalog
    const otherN = nb.byViolation?.other || 0;
    if (otherN > 0) {
      const seg = document.createElement("div");
      seg.className = "lb-nb-seg lb-nb-seg-other";
      seg.style.width = `${(otherN / total) * 100}%`;
      seg.title = `Other: ${fmt(otherN)}`;
      barWrap.appendChild(seg);
    }

    row.appendChild(barWrap);

    // Top streets tooltip on hover
    if (nb.topStreets?.length) {
      const tip = nb.topStreets
        .slice(0, 3)
        .map((s) => `${titleCase(s.name)} (${fmt(s.count)})`)
        .join(", ");
      row.title = `Top streets: ${tip}`;
    }

    // Scale bar relative to max neighborhood
    row.style.setProperty(
      "--nb-scale",
      String(Math.max(0.04, nb.ticketCount / max)),
    );

    // Click to drill down (toggle off if already active)
    const handleNbClick = () => {
      if (isActive) {
        clearNeighborhood();
      } else {
        setNeighborhood(nb.key);
        // Switch to streets tab to immediately show filtered results
        activeTab = "streets";
      }
    };
    row.addEventListener("click", handleNbClick);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleNbClick();
      }
    });

    container.appendChild(row);
  }
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
