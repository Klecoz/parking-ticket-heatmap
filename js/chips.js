import { getFilter, setFilter, subscribe } from './state.js';
import { fmt } from './util.js';

export function mountChips({ catalog }) {
  const bar = document.getElementById('chipBar');
  if (!bar) return;
  bar.innerHTML = '';

  const totalAll = catalog.reduce((s, c) => s + c.count, 0);

  // 'All' first.
  bar.appendChild(makeChip({ key: '_all', label: 'All violations', count: totalAll, color: null }));
  for (const v of catalog) {
    bar.appendChild(makeChip({ key: v.key, label: v.label, count: v.count, color: v.color }));
  }
  applyPressed();
  subscribe(applyPressed);
}

function makeChip({ key, label, count, color }) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.dataset.key = key;
  btn.setAttribute('aria-pressed', 'false');
  if (color) btn.style.setProperty('--chip-color', color);

  const dot = document.createElement('span');
  dot.className = 'chip-dot';
  btn.appendChild(dot);

  const lbl = document.createElement('span');
  lbl.textContent = label;
  btn.appendChild(lbl);

  const cnt = document.createElement('span');
  cnt.className = 'chip-count';
  cnt.textContent = fmt(count);
  btn.appendChild(cnt);

  btn.addEventListener('click', () => setFilter(key));
  li.appendChild(btn);
  return li;
}

function applyPressed() {
  const f = getFilter();
  const chips = document.querySelectorAll('#chipBar .chip');
  chips.forEach((c) => { c.setAttribute('aria-pressed', c.dataset.key === f ? 'true' : 'false'); });
}
