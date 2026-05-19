(() => {
  const $ = (id) => document.getElementById(id);

  $('footer-year').textContent = new Date().getFullYear();
  const backToTop = $('back-to-top');
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // Street-name normalizer must match build-data.mjs.
  function normalizeStreet(s) {
    if (!s) return null;
    return String(s)
      .toUpperCase()
      .replace(/\./g, '')
      .replace(/\bSTREET\b/g, 'ST')
      .replace(/\bAVENUE\b/g, 'AVE')
      .replace(/\bBOULEVARD\b/g, 'BLVD')
      .replace(/\bPARKWAY\b/g, 'PKWY')
      .replace(/\bDRIVE\b/g, 'DR')
      .replace(/\bROAD\b/g, 'RD')
      .replace(/\bPLACE\b/g, 'PL')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Map: CartoDB Positron tiles for a muted palette that fits the design.
  const map = L.map('map', { scrollWheelZoom: false, zoomControl: true })
    .setView([42.886, -78.878], 12);
  L.control.scale({ imperial: true, metric: false }).addTo(map);
  map.on('click', () => { map.scrollWheelZoom.enable(); });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  let heatLayer = null;
  let streetsData = {};
  let streetNames = [];
  let metaData = null;

  function renderHeatmap(points) {
    if (heatLayer) map.removeLayer(heatLayer);
    heatLayer = L.heatLayer(points, {
      radius: 22,
      blur: 26,
      maxZoom: 16,
      minOpacity: 0.35,
      gradient: { 0.2: '#e6f2ec', 0.45: '#7fb59a', 0.7: '#1a6b4a', 1.0: '#0a3d29' },
    }).addTo(map);
  }

  function rankClass(rank, total) {
    if (rank <= Math.max(10, total * 0.02)) return 'worst';
    if (rank <= Math.max(50, total * 0.10)) return 'bad';
    return 'ok';
  }

  function renderStats(streetEntry, normKey) {
    const card = $('statsCard');
    card.classList.remove('empty');
    const total = streetNames.length;
    const cls = rankClass(streetEntry.rank, total);
    const rankLabel = cls === 'worst' ? 'High-risk' : cls === 'bad' ? 'Watch out' : 'Lower risk';
    const violations = streetEntry.topViolations.map(v => `
      <li><span>${escapeHtml(v.desc)}</span><span class="v-count">${v.count.toLocaleString()}</span></li>
    `).join('');
    card.innerHTML = `
      <div class="stats-header">
        <h3 class="stats-name">${escapeHtml(streetEntry.display)}</h3>
        <span class="stats-rank ${cls}">${rankLabel} · #${streetEntry.rank} of ${total.toLocaleString()}</span>
      </div>
      <p class="stats-headline">
        <strong>${streetEntry.count.toLocaleString()}</strong> parking summonses issued here in the dataset window.
      </p>
      <div class="stats-violations">
        <h5>Top violations on ${escapeHtml(streetEntry.display)}</h5>
        <ul class="violation-list">${violations}</ul>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Autocomplete
  const input = $('streetSearch');
  const list = $('suggestions');
  let activeIdx = -1;
  let currentMatches = [];

  function renderSuggestions(matches) {
    list.innerHTML = matches.map((m, i) => `
      <li role="option" data-norm="${m.norm}" class="${i === activeIdx ? 'active' : ''}">
        <span>${escapeHtml(m.display)}</span>
        <span class="sug-count">${m.count.toLocaleString()} tickets</span>
      </li>
    `).join('');
    list.classList.toggle('open', matches.length > 0);
  }

  function commitSelection(norm) {
    const entry = streetsData[norm];
    if (!entry) return;
    input.value = entry.display;
    list.classList.remove('open');
    activeIdx = -1;
    renderStats(entry, norm);
  }

  input.addEventListener('input', () => {
    const q = normalizeStreet(input.value);
    if (!q) {
      list.classList.remove('open');
      currentMatches = [];
      return;
    }
    currentMatches = streetNames
      .filter(n => n.norm.includes(q))
      .slice(0, 8);
    activeIdx = -1;
    renderSuggestions(currentMatches);
  });

  input.addEventListener('keydown', (e) => {
    if (!list.classList.contains('open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, currentMatches.length - 1);
      renderSuggestions(currentMatches);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      renderSuggestions(currentMatches);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = currentMatches[activeIdx >= 0 ? activeIdx : 0];
      if (pick) commitSelection(pick.norm);
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
      activeIdx = -1;
    }
  });

  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    commitSelection(li.dataset.norm);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) {
      list.classList.remove('open');
    }
  });

  function renderLeaderboard() {
    const top = streetNames.slice(0, 20);
    $('leaderboardList').innerHTML = top.map(n => `
      <li>
        <button type="button" data-norm="${n.norm}">${escapeHtml(n.display)}</button>
        <span class="lb-count">${n.count.toLocaleString()}</span>
      </li>
    `).join('');
  }

  $('leaderboardList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-norm]');
    if (!btn) return;
    commitSelection(btn.dataset.norm);
    document.getElementById('lookup').scrollIntoView({ behavior: 'smooth' });
  });

  function renderDataCurrency() {
    const el = $('dataCurrency');
    if (metaData?.sample) {
      el.classList.add('sample');
      el.textContent = 'Showing sample data. Run the build script to populate live Buffalo Open Data — see /parking-heatmap/scripts/README.md.';
      return;
    }
    if (metaData?.generatedAt) {
      const d = new Date(metaData.generatedAt);
      const formatted = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const rows = metaData.rowCount?.toLocaleString() || '—';
      const streets = metaData.streetCount?.toLocaleString() || '—';
      el.textContent = `Data current as of ${formatted} · ${rows} summonses across ${streets} streets since ${metaData.since}.`;
    } else {
      el.textContent = '';
    }
  }

  Promise.all([
    fetch('data/heatmap.json').then(r => r.json()),
    fetch('data/streets.json').then(r => r.json()),
    fetch('data/meta.json').then(r => r.json()).catch(() => null),
  ]).then(([heatmap, streets, meta]) => {
    streetsData = streets;
    metaData = meta;
    streetNames = Object.entries(streets)
      .map(([norm, v]) => ({ norm, display: v.display, count: v.count }))
      .sort((a, b) => b.count - a.count);

    renderHeatmap(heatmap.points || []);
    renderLeaderboard();
    renderDataCurrency();
  }).catch(err => {
    console.error('Failed to load parking-heatmap data:', err);
    $('dataCurrency').textContent = 'Could not load data. Check the browser console.';
    $('dataCurrency').classList.add('sample');
  });
})();
