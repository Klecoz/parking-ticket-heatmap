// Entry point: load static JSON, mount components, wire cross-component callbacks.

import { mountChips } from './chips.js';
import { mountLeaderboard } from './leaderboard.js';
import { mountLookup, selectStreet } from './lookup.js';
import { highlightStreet, mountMap } from './map.js';
import { mountTimeView } from './time.js';
import { fmt } from './util.js';

(async () => {
  document.getElementById('footer-year').textContent = new Date().getFullYear();

  const backToTop = document.getElementById('back-to-top');
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  let meta, streets, time, streetsFc;
  try {
    [meta, streets, time, streetsFc] = await Promise.all([
      fetchJson('data/meta.json'),
      fetchJson('data/streets.json'),
      fetchJson('data/time.json'),
      fetchJson('data/streets.geojson'),
    ]);
  } catch (err) {
    console.error('[app] data load failed:', err);
    document.getElementById('headerCurrency').textContent = 'Data unavailable';
    return;
  }

  paintHeader(meta);
  paintHeroStats(meta);

  const catalog = meta.violationCatalog || [];

  const onStreetSelected = (norm) => {
    selectStreet(norm);
    highlightStreet(norm);
    document.getElementById('lookup').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  mountChips({ catalog });
  mountMap({ streetsFc, onStreetSelected });
  mountTimeView({ time, catalog });
  mountLookup({ streets, catalog, onStreetSelected });
  mountLeaderboard({ streets, catalog, onStreetSelected });
})();

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function paintHeader(meta) {
  const el = document.getElementById('headerCurrency');
  if (meta.sample) {
    el.textContent = 'Sample data';
    el.classList.add('sample');
    return;
  }
  if (meta.dateRange) {
    el.textContent = `${meta.dateRange.from} → ${meta.dateRange.to}`;
  } else if (meta.generatedAt) {
    el.textContent = `Updated ${meta.generatedAt.slice(0, 10)}`;
  } else {
    el.textContent = '';
  }
}

function paintHeroStats(meta) {
  document.getElementById('hsTickets').textContent = fmt(meta.rowCount || 0);
  document.getElementById('hsStreets').textContent = fmt(meta.streetCount || 0);
  const range = meta.dateRange;
  if (range) {
    document.getElementById('hsRange').textContent = `${formatShort(range.from)} – ${formatShort(range.to)}`;
  } else {
    document.getElementById('hsRange').textContent = '—';
  }
}

function formatShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MN[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}
