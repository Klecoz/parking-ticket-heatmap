// Street search + stats card. Both react to filter + range changes.

import {
  getFilter,
  getNeighborhood,
  getRange,
  getState,
  setStreet,
  subscribe,
} from "./state.js";
import { getStreetCounts, getStreetSlice } from "./timeIndex.js";
import { fmt, isJunkStreet, normalizeStreet, titleCase } from "./util.js";

let allStreets = null;
let streetIndex = null; // [{ norm, display, count }] sorted by count desc — used for search ranking
let catalogByKey = null;
let metaMonths = []; // ["2024-01", ...] — threaded from app.js for range labels
let onPick = null;
let activeStreet = null;
let totalStreetCount = 0;
let streetNeighborhoodMap = null; // { [normKey]: nbKey } — for prioritizing in-nb suggestions

const _MN_SHORT = [
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

export function mountLookup({
  streets,
  catalog,
  months,
  onStreetSelected,
  streetNeighborhood,
}) {
  allStreets = streets;
  catalogByKey = new Map(catalog.map((c) => [c.key, c]));
  metaMonths = months || [];
  onPick = onStreetSelected;
  streetNeighborhoodMap = streetNeighborhood || null;

  streetIndex = Object.entries(streets)
    .filter(([norm]) => !isJunkStreet(norm))
    .map(([norm, v]) => ({
      norm,
      display: v.display,
      count: v.count,
      rank: v.rank,
    }))
    .sort((a, b) => a.rank - b.rank);
  totalStreetCount = streetIndex.length;

  setupSearch();
  subscribe(() => renderStatsCard());
}

function setupSearch() {
  const input = document.getElementById("streetSearch");
  const sug = document.getElementById("suggestions");
  let activeIdx = -1;

  function close() {
    sug.classList.remove("open");
    sug.innerHTML = "";
    activeIdx = -1;
  }
  function open(matches) {
    sug.innerHTML = "";
    matches.forEach((m, _i) => {
      const li = document.createElement("li");
      li.role = "option";
      li.dataset.norm = m.norm;
      li.innerHTML =
        `<span>${escapeHtml(titleCase(m.display))}</span>` +
        `<span class="sug-count">#${m.rank} &middot; ${fmt(m.count)}</span>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(m.norm);
      });
      sug.appendChild(li);
    });
    sug.classList.add("open");
    activeIdx = matches.length ? 0 : -1;
    mark();
  }
  function mark() {
    const items = sug.querySelectorAll("li");
    items.forEach((el, i) => {
      el.classList.toggle("active", i === activeIdx);
    });
    if (activeIdx >= 0) items[activeIdx]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (q.length < 2) {
      close();
      return;
    }
    const qNorm = normalizeStreet(q) || "";
    const nb = getNeighborhood();
    let filtered = streetIndex.filter((s) => s.norm.includes(qNorm));
    // When a neighborhood is active, sort in-neighborhood streets first.
    if (nb && streetNeighborhoodMap) {
      filtered = [
        ...filtered.filter((s) => streetNeighborhoodMap[s.norm] === nb),
        ...filtered.filter((s) => streetNeighborhoodMap[s.norm] !== nb),
      ];
    }
    const matches = filtered.slice(0, 12);
    if (!matches.length) {
      close();
      return;
    }
    open(matches);
  });

  input.addEventListener("keydown", (e) => {
    const items = sug.querySelectorAll("li");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(items.length - 1, activeIdx + 1);
      mark();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      mark();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0) pick(items[activeIdx].dataset.norm);
    } else if (e.key === "Escape") {
      close();
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

function pick(norm) {
  const input = document.getElementById("streetSearch");
  const street = allStreets[norm];
  if (!street) return;
  input.value = titleCase(street.display);
  document.getElementById("suggestions").classList.remove("open");
  selectStreet(norm);
  if (onPick) onPick(norm);
}

export function selectStreet(norm) {
  activeStreet = norm;
  setStreet(norm);
  renderStatsCard();
}

// Format a short scope label from the active range, e.g. "in March 2026" or "since 2024".
function scopeLabel(range, months) {
  if (!range || !months.length) return "since 2024";
  const MN_LONG = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const fmtLong = (ym) => {
    if (!ym) return "";
    const [y, m] = String(ym).split("-");
    return `${MN_LONG[parseInt(m, 10) - 1] || m} ${y}`;
  };
  if (range.fromIdx === range.toIdx) {
    return `in ${fmtLong(months[range.fromIdx])}`;
  }
  const fromYM = months[range.fromIdx];
  const toYM = months[range.toIdx];
  const fromYear = fromYM?.slice(0, 4);
  const toYear = toYM?.slice(0, 4);
  if (fromYear === toYear) {
    return `in ${fromYear}`;
  }
  return `${fromYear}–${toYear}`;
}

function renderStatsCard() {
  const card = document.getElementById("statsCard");
  if (!activeStreet || !allStreets[activeStreet]) {
    card.classList.add("empty");
    card.innerHTML = `<p class="stats-empty">Search a street above to see its parking-summons stats.</p>`;
    return;
  }
  card.classList.remove("empty");

  const state = getState();
  const v = allStreets[activeStreet];
  const f = getFilter();
  const range = getRange();

  // Use timeIndex for count (handles range correctly).
  const slice = getStreetSlice(activeStreet, state);
  const filteredCount = slice
    ? f === "_all"
      ? slice.total
      : slice.byViolation?.[f] || 0
    : 0;

  // Rank: count streets with higher count than current in the active scope.
  const counts = getStreetCounts(state);
  let rank = 1;
  for (const [norm, c] of counts) {
    if (norm !== activeStreet && c > filteredCount) rank++;
  }

  const totalStreets = totalStreetCount;
  const percentile =
    totalStreets > 0
      ? Math.round(((totalStreets - rank) / totalStreets) * 100)
      : 0;
  const rankClass = percentile >= 99 ? "worst" : percentile >= 90 ? "bad" : "";

  const filterLabel =
    f === "_all" ? "all violations" : catalogByKey.get(f)?.label || f;
  // Build top violations list.
  let violationRows = "";
  if (slice?.ranked) {
    // No range: use raw-desc top violations from streets.json.
    const topViolations = (v.topViolations || []).slice(0, 3);
    violationRows =
      topViolations
        .map(
          (tv) => `
      <li><span>${escapeHtml(tv.desc)}</span><span class="v-count">${fmt(tv.count)}</span></li>
    `,
        )
        .join("") ||
      '<li><span class="stats-empty">No data for this filter.</span></li>';
  } else {
    // Range active: use topViolations keyed by violation key, look up label via catalog.
    const topViolations = (slice?.topViolations || []).slice(0, 3);
    violationRows =
      topViolations
        .map(
          (tv) => `
      <li><span>${escapeHtml(catalogByKey.get(tv.key)?.label || tv.key)}</span><span class="v-count">${fmt(tv.count)}</span></li>
    `,
        )
        .join("") ||
      '<li><span class="stats-empty">No data for this filter.</span></li>';
  }

  // Build scope label from range for the headline using stored metaMonths.
  const headlineScope = scopeLabel(range, metaMonths);

  card.innerHTML = `
    <div class="stats-header">
      <h3 class="stats-name">${escapeHtml(titleCase(v.display))}</h3>
      <span class="stats-rank ${rankClass}">Rank #${fmt(rank)} of ${fmt(totalStreets)}</span>
    </div>
    <p class="stats-headline">
      <strong>${fmt(filteredCount)}</strong> ${filteredCount === 1 ? "ticket" : "tickets"}
      ${escapeHtml(headlineScope)} &middot; ${escapeHtml(filterLabel)}.
    </p>
    <div class="pctile" aria-label="Citywide percentile">
      <div class="pctile-label"><span>Citywide percentile</span><strong>worse than ${percentile}% of streets</strong></div>
      <div class="pctile-track"><div class="pctile-fill" style="width:${percentile}%"></div></div>
    </div>
    <div class="stats-violations">
      <h5>Top violations on this street</h5>
      <ul class="violation-list">
        ${violationRows}
      </ul>
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
