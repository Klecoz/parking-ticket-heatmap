// Street search + stats card. Both react to filter changes.

import { getFilter, subscribe } from './state.js';
import { fmt, normalizeStreet, titleCase } from './util.js';

let allStreets = null;
let streetIndex = null; // [{ norm, display, count }] sorted by count desc — used for search ranking
let catalogByKey = null;
let onPick = null;
let activeStreet = null;
let totalStreetCount = 0;

export function mountLookup({ streets, catalog, onStreetSelected }) {
  allStreets = streets;
  catalogByKey = new Map(catalog.map(c => [c.key, c]));
  onPick = onStreetSelected;

  streetIndex = Object.entries(streets)
    .map(([norm, v]) => ({ norm, display: v.display, count: v.count, rank: v.rank }))
    .sort((a, b) => a.rank - b.rank);
  totalStreetCount = streetIndex.length;

  setupSearch();
  subscribe(() => renderStatsCard());
}

function setupSearch() {
  const input = document.getElementById('streetSearch');
  const sug = document.getElementById('suggestions');
  let activeIdx = -1;

  function close() { sug.classList.remove('open'); sug.innerHTML = ''; activeIdx = -1; }
  function open(matches) {
    sug.innerHTML = '';
    matches.forEach((m, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.dataset.norm = m.norm;
      li.innerHTML = `<span>${escapeHtml(titleCase(m.display))}</span>` +
                     `<span class="sug-count">#${m.rank} &middot; ${fmt(m.count)}</span>`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(m.norm); });
      sug.appendChild(li);
    });
    sug.classList.add('open');
    activeIdx = matches.length ? 0 : -1;
    mark();
  }
  function mark() {
    const items = sug.querySelectorAll('li');
    items.forEach((el, i) => { el.classList.toggle('active', i === activeIdx); });
    if (activeIdx >= 0) items[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    const qNorm = normalizeStreet(q) || '';
    const matches = streetIndex.filter(s => s.norm.includes(qNorm)).slice(0, 12);
    if (!matches.length) { close(); return; }
    open(matches);
  });

  input.addEventListener('keydown', (e) => {
    const items = sug.querySelectorAll('li');
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); mark(); }
    else if (e.key === 'Enter')  { e.preventDefault(); if (activeIdx >= 0) pick(items[activeIdx].dataset.norm); }
    else if (e.key === 'Escape') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

function pick(norm) {
  const input = document.getElementById('streetSearch');
  const street = allStreets[norm];
  if (!street) return;
  input.value = titleCase(street.display);
  document.getElementById('suggestions').classList.remove('open');
  selectStreet(norm);
  if (onPick) onPick(norm);
}

export function selectStreet(norm) {
  activeStreet = norm;
  renderStatsCard();
}

function renderStatsCard() {
  const card = document.getElementById('statsCard');
  if (!activeStreet || !allStreets[activeStreet]) {
    card.classList.add('empty');
    card.innerHTML = `<p class="stats-empty">Search a street above to see its parking-summons stats.</p>`;
    return;
  }
  card.classList.remove('empty');

  const v = allStreets[activeStreet];
  const f = getFilter();
  const filteredCount = f === '_all' ? v.count : (v.byViolation?.[f] || 0);
  const totalStreets = totalStreetCount;
  // Percentile under the active filter: rank by current count, ascending = better.
  // Using stored rank for _all; recompute when filtered.
  let rank;
  if (f === '_all') {
    rank = v.rank;
  } else {
    let r = 1;
    for (const norm in allStreets) {
      if (norm === activeStreet) continue;
      const cmp = allStreets[norm].byViolation?.[f] || 0;
      if (cmp > filteredCount) r++;
    }
    rank = r;
  }
  const percentile = totalStreets > 0
    ? Math.round(((totalStreets - rank) / totalStreets) * 100)
    : 0;
  const rankClass = percentile >= 99 ? 'worst' : percentile >= 90 ? 'bad' : '';

  const topViolations = (v.topViolations || []).slice(0, 3);
  const filterLabel = f === '_all' ? 'all violations' : catalogByKey.get(f)?.label;

  card.innerHTML = `
    <div class="stats-header">
      <h3 class="stats-name">${escapeHtml(titleCase(v.display))}</h3>
      <span class="stats-rank ${rankClass}">Rank #${fmt(rank)} of ${fmt(totalStreets)}</span>
    </div>
    <p class="stats-headline">
      <strong>${fmt(filteredCount)}</strong> ${filteredCount === 1 ? 'ticket' : 'tickets'}
      since 2024 &middot; ${escapeHtml(filterLabel)}.
    </p>
    <div class="pctile" aria-label="Citywide percentile">
      <div class="pctile-label"><span>Citywide percentile</span><strong>worse than ${percentile}% of streets</strong></div>
      <div class="pctile-track"><div class="pctile-fill" style="width:${percentile}%"></div></div>
    </div>
    <div class="stats-violations">
      <h5>Top violations on this street</h5>
      <ul class="violation-list">
        ${topViolations.map(tv => `
          <li><span>${escapeHtml(tv.desc)}</span><span class="v-count">${fmt(tv.count)}</span></li>
        `).join('') || '<li><span class="stats-empty">No data for this filter.</span></li>'}
      </ul>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
