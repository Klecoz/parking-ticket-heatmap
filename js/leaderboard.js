// Inline leaderboard with horizontal bars. Reacts to filter + range changes.

import { getFilter, getRange, getState, subscribe } from './state.js';
import { getStreetCounts } from './timeIndex.js';
import { fmt, titleCase } from './util.js';

let allStreets = null;          // { [norm]: { display, count, byViolation, ... } }
let catalogByKey = null;
let metaMonths = [];            // ["2024-01", ...]
let showAll = false;
let onPick = null;

const MN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function mountLeaderboard({ streets, catalog, months, onStreetSelected }) {
  allStreets = streets;
  catalogByKey = new Map(catalog.map(c => [c.key, c]));
  metaMonths = months || [];
  onPick = onStreetSelected;

  document.getElementById('leaderboardMore').addEventListener('click', () => {
    showAll = !showAll;
    render();
  });

  render();
  subscribe(render);
}

function activeLabel() {
  const f = getFilter();
  return f === '_all' ? 'all violations' : (catalogByKey?.get(f)?.label?.toLowerCase() || f);
}

// Format a range object to a short human label, e.g. "Mar '25" or "Mar '25 – May '26".
function formatRangeLabel(range, months) {
  if (!range || !months.length) return null;
  const fmt0 = (ym) => {
    const [y, m] = String(ym).split('-');
    return `${MN_SHORT[parseInt(m, 10) - 1] || m} '${y.slice(2)}`;
  };
  if (range.fromIdx === range.toIdx) return fmt0(months[range.fromIdx]);
  return `${fmt0(months[range.fromIdx])} – ${fmt0(months[range.toIdx])}`;
}

function render() {
  const state = getState();
  const limit = showAll ? 100 : 20;

  // Get per-street counts from timeIndex (handles both fast-path and range-path).
  const counts = getStreetCounts(state);

  const ranked = [];
  for (const [norm, count] of counts) {
    const display = allStreets[norm]?.display;
    if (display) ranked.push({ norm, display, count });
  }
  ranked.sort((a, b) => b.count - a.count);

  const top = ranked.slice(0, limit);
  const max = top[0]?.count || 1;

  const list = document.getElementById('leaderboardList');
  list.innerHTML = '';
  for (let i = 0; i < top.length; i++) {
    const s = top[i];
    const li = document.createElement('li');

    const rank = document.createElement('span');
    rank.className = 'lb-rank num';
    rank.textContent = String(i + 1);
    li.appendChild(rank);

    const btn = document.createElement('button');
    btn.className = 'lb-button';
    btn.type = 'button';
    btn.dataset.norm = s.norm;

    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = titleCase(s.display);
    btn.appendChild(name);

    const bar = document.createElement('span');
    bar.className = 'lb-bar';
    const fill = document.createElement('span');
    fill.className = 'lb-bar-fill';
    fill.style.transform = `scaleX(${Math.max(0.02, s.count / max)})`;
    bar.appendChild(fill);
    btn.appendChild(bar);

    btn.addEventListener('click', () => onPick?.(s.norm));
    li.appendChild(btn);

    const count = document.createElement('span');
    count.className = 'lb-count num';
    count.textContent = fmt(s.count);
    li.appendChild(count);

    list.appendChild(li);
  }

  const more = document.getElementById('leaderboardMore');
  if (ranked.length <= 20) {
    more.hidden = true;
  } else {
    more.hidden = false;
    more.textContent = showAll ? '← Show only top 20' : `Show next ${Math.min(80, ranked.length - 20)} →`;
  }

  const rangeLabel = formatRangeLabel(getRange(), metaMonths);
  const rangePart = rangeLabel ? ` · ${rangeLabel}` : '';
  document.getElementById('leaderboardMode').innerHTML =
    `Top ${top.length} &middot; <strong>${activeLabel()}</strong>${escapeHtml(rangePart)}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
