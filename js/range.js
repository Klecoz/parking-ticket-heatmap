// Date-range UI: a chip (label + clear) inline with violation chips,
// plus a brush overlay on the monthly sparkline. Both write to state.range.
//
// Brush UX:
//   - Click an empty area of the sparkline   → 1-month range at that x.
//   - Drag across the sparkline              → range from start to current x.
//   - Drag the body of an existing brush     → pan the range.
//   - Drag either edge handle                → resize the range.
//   - × on the chip                          → clear (back to all months).
//
// Mobile fallback: tapping the chip opens a from/to dropdown popover so the
// brush isn't required on touch devices.

import { getRange, setRange, subscribe } from './state.js';

let months = [];                  // ["2024-01", ...]
let monthLabelShort = [];         // ["Jan '24", ...]
let monthLabelLong = [];          // ["January 2024", ...]
let svg = null;                   // SVG element of the sparkline
let geom = null;                  // { padX, padY, w, h, step } — set by time.js via setSparklineGeometry
let chipEl = null;
let popoverEl = null;
let brushOverlayG = null;         // <g> appended to sparkline svg

const MN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MN_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function mountRange({ months: m }) {
  months = m;
  monthLabelShort = months.map(formatYMShort);
  monthLabelLong  = months.map(formatYMLong);

  buildChip();
  buildPopover();
  renderChip();
  subscribe(() => { renderChip(); renderBrush(); });
}

// Called by time.js after it (re)draws the sparkline; gives us the SVG + geometry.
export function attachSparklineBrush(svgEl, geometry) {
  svg = svgEl;
  geom = geometry;
  ensureBrushLayer();
  attachPointerHandlers();
  renderBrush();
}

// ------------------------- Chip + popover -------------------------

function buildChip() {
  const bar = document.getElementById('chipBar');
  if (!bar) return;
  const li = document.createElement('li');
  li.className = 'range-chip-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip range-chip';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.id = 'rangeChip';
  btn.innerHTML = `
    <span class="chip-cal" aria-hidden="true">&#x1F4C5;</span>
    <span class="range-chip-label" id="rangeChipLabel">All months</span>
    <span class="range-chip-clear" id="rangeChipClear" hidden role="button" aria-label="Clear date range">&times;</span>
  `;
  btn.addEventListener('click', (e) => {
    if (e.target.id === 'rangeChipClear') { setRange(null); return; }
    togglePopover(btn);
  });
  li.appendChild(btn);
  bar.appendChild(li);
  chipEl = btn;
}

function buildPopover() {
  popoverEl = document.createElement('div');
  popoverEl.className = 'range-popover';
  popoverEl.hidden = true;
  popoverEl.setAttribute('role', 'dialog');
  popoverEl.setAttribute('aria-label', 'Choose date range');
  popoverEl.innerHTML = `
    <div class="range-popover-row">
      <label>From <select id="rangeFrom"></select></label>
      <label>To <select id="rangeTo"></select></label>
    </div>
    <div class="range-popover-actions">
      <button type="button" id="rangeClearBtn">All months</button>
      <button type="button" id="rangeApplyBtn" class="primary">Apply</button>
    </div>
  `;
  document.body.appendChild(popoverEl);

  const fromSel = popoverEl.querySelector('#rangeFrom');
  const toSel   = popoverEl.querySelector('#rangeTo');
  for (let i = 0; i < months.length; i++) {
    const oF = document.createElement('option');
    oF.value = String(i); oF.textContent = monthLabelLong[i];
    fromSel.appendChild(oF);
    const oT = oF.cloneNode(true);
    toSel.appendChild(oT);
  }

  popoverEl.querySelector('#rangeClearBtn').addEventListener('click', () => {
    setRange(null);
    hidePopover();
  });
  popoverEl.querySelector('#rangeApplyBtn').addEventListener('click', () => {
    const f = +fromSel.value, t = +toSel.value;
    if (Number.isFinite(f) && Number.isFinite(t)) {
      const fromIdx = Math.min(f, t), toIdx = Math.max(f, t);
      setRange({ fromIdx, toIdx });
    }
    hidePopover();
  });

  document.addEventListener('click', (e) => {
    if (popoverEl.hidden) return;
    if (popoverEl.contains(e.target) || (chipEl?.contains(e.target))) return;
    hidePopover();
  });
  window.addEventListener('scroll', hidePopover, true);
  window.addEventListener('resize', hidePopover);
}

function togglePopover(anchor) {
  if (!popoverEl.hidden) { hidePopover(); return; }
  // Seed selects from current range.
  const r = getRange();
  popoverEl.querySelector('#rangeFrom').value = String(r ? r.fromIdx : 0);
  popoverEl.querySelector('#rangeTo').value   = String(r ? r.toIdx : months.length - 1);
  const rect = anchor.getBoundingClientRect();
  popoverEl.hidden = false;
  // Position below the chip; clamp to viewport.
  const pw = popoverEl.offsetWidth || 260;
  const ph = popoverEl.offsetHeight || 120;
  let left = rect.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (left < 8) left = 8;
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top  = `${Math.min(window.innerHeight - ph - 8, rect.bottom + 6)}px`;
}
function hidePopover() { if (popoverEl) popoverEl.hidden = true; }

function renderChip() {
  if (!chipEl) return;
  const r = getRange();
  const label = chipEl.querySelector('#rangeChipLabel');
  const clear = chipEl.querySelector('#rangeChipClear');
  if (!r) {
    label.textContent = 'All months';
    clear.hidden = true;
    chipEl.classList.remove('range-chip-active');
  } else {
    label.textContent = rangeLabel(r);
    clear.hidden = false;
    chipEl.classList.add('range-chip-active');
  }
}

function rangeLabel(r) {
  if (r.fromIdx === r.toIdx) return monthLabelLong[r.fromIdx];
  const sameYear = months[r.fromIdx]?.slice(0, 4) === months[r.toIdx]?.slice(0, 4);
  if (sameYear) {
    return `${MN_SHORT[+months[r.fromIdx].slice(5, 7) - 1]} – ${MN_SHORT[+months[r.toIdx].slice(5, 7) - 1]} ${months[r.fromIdx].slice(0, 4)}`;
  }
  return `${monthLabelShort[r.fromIdx]} – ${monthLabelShort[r.toIdx]}`;
}

// ------------------------- Sparkline brush -------------------------

function ensureBrushLayer() {
  if (!svg) return;
  if (brushOverlayG && brushOverlayG.ownerSVGElement === svg) return;
  brushOverlayG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  brushOverlayG.setAttribute('class', 'brush-layer');
  svg.appendChild(brushOverlayG);
}

function xForIdx(i) {
  if (!geom) return 0;
  return geom.padX + i * geom.step;
}
function idxForClientX(clientX) {
  if (!geom || !svg) return 0;
  // Map clientX → svg viewBox X (since svg uses preserveAspectRatio="none", x scales with width).
  const r = svg.getBoundingClientRect();
  const px = clientX - r.left;
  const vx = (px / r.width) * geom.w;
  let i = Math.round((vx - geom.padX) / (geom.step || 1));
  if (i < 0) i = 0;
  if (i > months.length - 1) i = months.length - 1;
  return i;
}

function renderBrush() {
  if (!brushOverlayG || !geom) return;
  brushOverlayG.innerHTML = '';
  const r = getRange();
  if (!r) return;
  const ns = 'http://www.w3.org/2000/svg';
  const x0 = xForIdx(r.fromIdx);
  const x1 = xForIdx(r.toIdx);
  const left = Math.min(x0, x1) - geom.step / 2;
  const right = Math.max(x0, x1) + geom.step / 2;
  const width = Math.max(2, right - left);

  // Translucent band
  const band = document.createElementNS(ns, 'rect');
  band.setAttribute('x', String(left));
  band.setAttribute('y', '0');
  band.setAttribute('width', String(width));
  band.setAttribute('height', String(geom.h));
  band.setAttribute('class', 'brush-band');
  brushOverlayG.appendChild(band);

  // Left + right edge lines + handles
  for (const [x, role] of [[left, 'left'], [right, 'right']]) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', '0');
    line.setAttribute('y2', String(geom.h));
    line.setAttribute('class', 'brush-edge');
    brushOverlayG.appendChild(line);

    // Wider invisible hit area for the handle
    const hit = document.createElementNS(ns, 'rect');
    hit.setAttribute('x', String(x - 5));
    hit.setAttribute('y', '0');
    hit.setAttribute('width', '10');
    hit.setAttribute('height', String(geom.h));
    hit.setAttribute('class', 'brush-handle');
    hit.dataset.handle = role;
    brushOverlayG.appendChild(hit);
  }

  // Body hit area for panning
  const body = document.createElementNS(ns, 'rect');
  body.setAttribute('x', String(left + 6));
  body.setAttribute('y', '0');
  body.setAttribute('width', String(Math.max(0, width - 12)));
  body.setAttribute('height', String(geom.h));
  body.setAttribute('class', 'brush-body');
  brushOverlayG.appendChild(body);
}

function attachPointerHandlers() {
  if (!svg || svg.dataset.brushBound === '1') return;
  svg.dataset.brushBound = '1';

  let mode = null;     // 'create' | 'left' | 'right' | 'body'
  let anchorIdx = 0;   // for create-drag start
  let startRange = null;
  let startMouseIdx = 0;

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const target = e.target;
    svg.setPointerCapture(e.pointerId);
    const idx = idxForClientX(e.clientX);
    if (target?.classList?.contains('brush-handle')) {
      mode = target.dataset.handle; // 'left' | 'right'
      startRange = { ...getRange() };
    } else if (target?.classList?.contains('brush-body')) {
      mode = 'body';
      startRange = { ...getRange() };
      startMouseIdx = idx;
    } else {
      mode = 'create';
      anchorIdx = idx;
      setRange({ fromIdx: idx, toIdx: idx });
    }
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const idx = idxForClientX(e.clientX);
    if (mode === 'create') {
      const a = Math.min(anchorIdx, idx), b = Math.max(anchorIdx, idx);
      setRange({ fromIdx: a, toIdx: b });
    } else if (mode === 'left') {
      const a = Math.min(idx, startRange.toIdx);
      const b = Math.max(idx, startRange.toIdx);
      setRange({ fromIdx: a, toIdx: b });
    } else if (mode === 'right') {
      const a = Math.min(startRange.fromIdx, idx);
      const b = Math.max(startRange.fromIdx, idx);
      setRange({ fromIdx: a, toIdx: b });
    } else if (mode === 'body') {
      const delta = idx - startMouseIdx;
      const width = startRange.toIdx - startRange.fromIdx;
      let from = startRange.fromIdx + delta;
      let to   = startRange.toIdx   + delta;
      if (from < 0) { from = 0; to = width; }
      if (to > months.length - 1) { to = months.length - 1; from = to - width; }
      setRange({ fromIdx: from, toIdx: to });
    }
  });

  const endDrag = (e) => {
    if (!mode) return;
    mode = null;
    startRange = null;
    try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
}

// ------------------------- Formatting -------------------------

function formatYMShort(ym) {
  const [y, m] = String(ym).split('-');
  return `${MN_SHORT[parseInt(m, 10) - 1] || m} '${y.slice(2)}`;
}
function formatYMLong(ym) {
  const [y, m] = String(ym).split('-');
  return `${MN_LONG[parseInt(m, 10) - 1] || m} ${y}`;
}
