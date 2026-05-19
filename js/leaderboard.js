// Inline leaderboard with horizontal bars. Reacts to filter changes.

import { getFilter, subscribe } from './state.js';
import { fmt, titleCase } from './util.js';

let allStreets = null;          // { [norm]: { display, count, byViolation, ... } }
let catalogByKey = null;
let showAll = false;
let onPick = null;

export function mountLeaderboard({ streets, catalog, onStreetSelected }) {
  allStreets = streets;
  catalogByKey = new Map(catalog.map(c => [c.key, c]));
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

function render() {
  const f = getFilter();
  const limit = showAll ? 100 : 20;

  // Compute ranked list for the current filter.
  const ranked = [];
  for (const [norm, v] of Object.entries(allStreets)) {
    const c = f === '_all' ? v.count : (v.byViolation?.[f] || 0);
    if (c > 0) ranked.push({ norm, display: v.display, count: c });
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

    btn.addEventListener('click', () => onPick && onPick(s.norm));
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

  document.getElementById('leaderboardMode').innerHTML =
    `Top ${top.length} &middot; <strong>${activeLabel()}</strong>`;
}
