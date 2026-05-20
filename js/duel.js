// Head-to-head: pick two streets, render side-by-side cards with totals,
// rank/percentile, a per-street violation-type breakdown bar, and top
// violations. State.duel persists the matchup to the URL hash so it's
// shareable.

import { getDuel, getFilter, getState, setDuel, subscribe } from "./state.js";
import {
  getStreetCount,
  getStreetCounts,
  getStreetSlice,
} from "./timeIndex.js";
import { fmt, isJunkStreet, normalizeStreet, titleCase } from "./util.js";

let allStreets = null;
let catalogByKey = null;
let streetIndex = null; // [{ norm, display, count, rank }] sorted by rank asc
let totalStreets = 0;

export function mountDuel({ streets, catalog }) {
  allStreets = streets;
  catalogByKey = new Map(catalog.map((c) => [c.key, c]));

  streetIndex = Object.entries(streets)
    .filter(([norm]) => !isJunkStreet(norm))
    .map(([norm, v]) => ({
      norm,
      display: v.display,
      count: v.count,
      rank: v.rank,
    }))
    .sort((a, b) => a.rank - b.rank);
  totalStreets = streetIndex.length;

  bindSearch("duelSearchA", "duelSuggestionsA");
  bindSearch("duelSearchB", "duelSuggestionsB");

  document
    .getElementById("duelCompareBtn")
    ?.addEventListener("click", commitFromInputs);
  document.getElementById("duelClearBtn")?.addEventListener("click", () => {
    setDuel(null);
    document.getElementById("duelSearchA").value = "";
    document.getElementById("duelSearchB").value = "";
  });

  // Hydrate inputs from current duel state (URL hash).
  const cur = getDuel();
  if (cur) {
    const aNorm = allStreets[cur.a] ? cur.a : normalizeStreet(cur.a);
    const bNorm = allStreets[cur.b] ? cur.b : normalizeStreet(cur.b);
    const a = allStreets[aNorm];
    const b = allStreets[bNorm];
    if (a) document.getElementById("duelSearchA").value = titleCase(a.display);
    if (b) document.getElementById("duelSearchB").value = titleCase(b.display);
  }

  subscribe(render);
  render();
}

function commitFromInputs() {
  const a = resolveInput(document.getElementById("duelSearchA").value);
  const b = resolveInput(document.getElementById("duelSearchB").value);
  if (!a || !b || a === b) {
    document.getElementById("duelCards").innerHTML =
      '<p class="duel-empty">Pick two different streets, then hit Compare.</p>';
    return;
  }
  setDuel({ a, b });
}

function resolveInput(value) {
  if (!value) return null;
  const qNorm = normalizeStreet(value);
  if (qNorm && allStreets[qNorm]) return qNorm;
  // Fallback: substring match in display names.
  const lower = value.toLowerCase();
  const hit = streetIndex.find(
    (s) =>
      titleCase(s.display).toLowerCase() === lower ||
      s.norm.toLowerCase() === lower,
  );
  if (hit) return hit.norm;
  // Last resort: include match.
  const inc = streetIndex.find((s) => s.norm.includes(qNorm || ""));
  return inc?.norm || null;
}

function bindSearch(inputId, suggestionsId) {
  const input = document.getElementById(inputId);
  const sug = document.getElementById(suggestionsId);
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
      li.innerHTML =
        `<span>${escapeHtml(titleCase(m.display))}</span>` +
        `<span class="sug-count">#${m.rank} · ${fmt(m.count)}</span>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = titleCase(m.display);
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
        input.value = items[activeIdx].querySelector("span").textContent;
        close();
      } else {
        // Enter without a highlighted suggestion: trigger compare if both filled.
        if (
          document.getElementById("duelSearchA").value &&
          document.getElementById("duelSearchB").value
        ) {
          commitFromInputs();
        }
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

function render() {
  const duel = getDuel();
  const cards = document.getElementById("duelCards");
  const clearBtn = document.getElementById("duelClearBtn");
  if (!cards) return;
  clearBtn.hidden = !duel;

  if (!duel) {
    cards.innerHTML =
      '<p class="duel-empty">Pick two streets and press Compare.</p>';
    return;
  }
  const a = allStreets[duel.a];
  const b = allStreets[duel.b];
  if (!a || !b) {
    cards.innerHTML =
      '<p class="duel-empty">One of the streets is unknown in the current data.</p>';
    return;
  }

  const state = getState();
  const aCount = getStreetCount(duel.a, state);
  const bCount = getStreetCount(duel.b, state);
  const aSlice = getStreetSlice(duel.a, state);
  const bSlice = getStreetSlice(duel.b, state);

  // Compute current ranks in active scope.
  const counts = getStreetCounts(state);
  const aRank = rankFor(counts, duel.a, aCount);
  const bRank = rankFor(counts, duel.b, bCount);

  const aPct = percentileFromRank(aRank);
  const bPct = percentileFromRank(bRank);

  const winnerKey =
    aCount === bCount ? null : aCount > bCount ? duel.a : duel.b;

  cards.innerHTML = `
    <div class="duel-grid">
      ${renderCard(a, duel.a, aCount, aRank, aPct, aSlice, winnerKey === duel.a)}
      ${renderCard(b, duel.b, bCount, bRank, bPct, bSlice, winnerKey === duel.b)}
    </div>
    <p class="duel-summary">${summary(a, b, aCount, bCount)}</p>
  `;
}

function rankFor(counts, norm, count) {
  let rank = 1;
  for (const [k, c] of counts) if (k !== norm && c > count) rank++;
  return rank;
}

function percentileFromRank(rank) {
  if (!totalStreets) return 0;
  return Math.round(((totalStreets - rank) / totalStreets) * 100);
}

function renderCard(street, norm, count, rank, pct, slice, isWinner) {
  const f = getFilter();
  const filterLabel =
    f === "_all" ? "all violations" : catalogByKey.get(f)?.label || f;
  const stackedBar = buildViolationBar(norm, count);

  // Top violations
  let topRows = "";
  if (slice?.ranked) {
    const top = (street.topViolations || []).slice(0, 3);
    topRows = top
      .map(
        (tv) =>
          `<li><span>${escapeHtml(tv.desc)}</span><span class="v-count">${fmt(tv.count)}</span></li>`,
      )
      .join("");
  } else {
    const top = (slice?.topViolations || []).slice(0, 3);
    topRows = top
      .map(
        (tv) =>
          `<li><span>${escapeHtml(catalogByKey.get(tv.key)?.label || tv.key)}</span><span class="v-count">${fmt(tv.count)}</span></li>`,
      )
      .join("");
  }
  if (!topRows)
    topRows =
      '<li><span class="stats-empty">No data for this filter.</span></li>';

  return `
    <div class="duel-card ${isWinner ? "duel-winner" : ""}">
      ${isWinner ? '<span class="duel-badge">Worse offender</span>' : ""}
      <h3>${escapeHtml(titleCase(street.display))}</h3>
      <div class="duel-headline">
        <strong>${fmt(count)}</strong> ${count === 1 ? "ticket" : "tickets"}
        <span class="duel-filter">· ${escapeHtml(filterLabel)}</span>
      </div>
      <div class="duel-rank">Rank #${fmt(rank)} of ${fmt(totalStreets)} — ${pct}th percentile</div>
      <div class="duel-violation-bar-wrap">
        <div class="duel-violation-bar-label">Tickets by type</div>
        <div class="duel-violation-bar">${stackedBar.segments}</div>
        <div class="duel-violation-bar-legend">${stackedBar.legend}</div>
      </div>
      <ul class="duel-violations">${topRows}</ul>
    </div>
  `;
}

function summary(a, b, aCount, bCount) {
  if (aCount === bCount) {
    return `Tied at ${fmt(aCount)} tickets — pick a different scope to find the gap.`;
  }
  const [moreName, moreN, lessName, lessN] =
    aCount > bCount
      ? [a.display, aCount, b.display, bCount]
      : [b.display, bCount, a.display, aCount];
  const delta = moreN - lessN;
  const pct = lessN > 0 ? Math.round((delta / lessN) * 100) : 100;
  return `${escapeHtml(titleCase(moreName))} has ${fmt(delta)} more tickets than ${escapeHtml(titleCase(lessName))} — ${pct}% more.`;
}

function buildViolationBar(norm, total) {
  const street = allStreets[norm];
  const byViolation = street?.byViolation || {};
  const segments = catalogByKey
    ? [...catalogByKey.values()]
        .map((cat) => {
          const n = byViolation[cat.key] || 0;
          if (!n || !total) return "";
          const pct = (n / total) * 100;
          return `<span class="duel-vbar-seg" style="width:${pct.toFixed(2)}%;background:${cat.color}" title="${escapeHtml(cat.label)}: ${fmt(n)}"></span>`;
        })
        .join("")
    : "";
  const legend = catalogByKey
    ? [...catalogByKey.values()]
        .filter((cat) => byViolation[cat.key] > 0)
        .map(
          (cat) =>
            `<span class="duel-vbar-swatch" style="background:${cat.color}"></span><span>${escapeHtml(cat.label)}</span>`,
        )
        .join("")
    : "";
  return { segments, legend };
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
