// Top-of-page range slider — primary picker for state.range.
//
// Two thumbs, dragged independently or together. When both thumbs land on the
// same month, they visually collapse into a single diamond marker. Writes the
// same state.range that the sparkline brush + chip popover do; reads back on
// every state change so it stays in sync with any other entry point.

import { getRange, setRange, subscribe } from './state.js';

let months = [];
let wrap = null;
let trackEl = null;
let fillEl = null;
let thumbFrom = null;
let thumbTo = null;
let readoutEl = null;
let resetBtn = null;

const MN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MN_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let dragging = null; // 'from' | 'to' | null
let dragWidth = 0;   // cached track width in px

export function mountTopRangeSlider({ months: m }) {
  months = m;
  if (!months.length) return;

  wrap = document.getElementById('topRangeTrackWrap');
  trackEl = wrap.querySelector('.range-slider-track');
  fillEl = document.getElementById('topRangeFill');
  thumbFrom = document.getElementById('topRangeThumbFrom');
  thumbTo = document.getElementById('topRangeThumbTo');
  readoutEl = document.getElementById('topRangeReadout');
  resetBtn = document.getElementById('topRangeReset');

  // Endpoint labels under the track (optional axis row).
  const slider = document.getElementById('topRangeSlider');
  if (slider && !slider.querySelector('.range-slider-axis')) {
    const axis = document.createElement('div');
    axis.className = 'range-slider-axis';
    axis.setAttribute('aria-hidden', 'true');
    axis.style.gridColumn = '1';
    axis.innerHTML = `<span>${formatYMShort(months[0])}</span><span>${formatYMShort(months[months.length - 1])}</span>`;
    wrap.insertAdjacentElement('afterend', axis);
  }

  for (const t of [thumbFrom, thumbTo]) {
    t.setAttribute('aria-valuemin', '0');
    t.setAttribute('aria-valuemax', String(months.length - 1));
  }

  resetBtn.addEventListener('click', () => setRange(null));

  attachPointer(thumbFrom, 'from');
  attachPointer(thumbTo, 'to');
  attachKeyboard(thumbFrom, 'from');
  attachKeyboard(thumbTo, 'to');
  attachTrackClick();

  render();
  subscribe(render);
  window.addEventListener('resize', () => { render(); });
}

function trackRect() {
  return trackEl.getBoundingClientRect();
}

function idxFromClientX(clientX) {
  const r = trackRect();
  const w = r.width;
  if (!w) return 0;
  const px = clientX - r.left;
  const t = Math.max(0, Math.min(1, px / w));
  return Math.round(t * (months.length - 1));
}

function positionForIdx(idx) {
  const r = trackRect();
  if (!r.width) return 0;
  return (idx / (months.length - 1)) * r.width;
}

function currentRange() {
  return getRange() || { fromIdx: 0, toIdx: months.length - 1 };
}

function render() {
  if (!wrap) return;
  const explicit = getRange();
  const r = currentRange();
  const wrapRect = wrap.getBoundingClientRect();
  const trackRectV = trackRect();
  // Track is inset by 8px on each side via CSS. Position thumbs relative to the wrap.
  const offsetLeft = trackRectV.left - wrapRect.left;
  const x0 = offsetLeft + positionForIdx(r.fromIdx);
  const x1 = offsetLeft + positionForIdx(r.toIdx);

  fillEl.style.left = `${positionForIdx(r.fromIdx)}px`;
  fillEl.style.width = `${Math.max(0, positionForIdx(r.toIdx) - positionForIdx(r.fromIdx))}px`;

  thumbFrom.style.left = `${x0}px`;
  thumbTo.style.left = `${x1}px`;

  const collapsed = r.fromIdx === r.toIdx;
  if (collapsed && explicit) {
    thumbFrom.classList.add('collapsed');
    thumbTo.classList.add('hidden');
  } else {
    thumbFrom.classList.remove('collapsed');
    thumbTo.classList.remove('hidden');
  }

  thumbFrom.setAttribute('aria-valuenow', String(r.fromIdx));
  thumbFrom.setAttribute('aria-valuetext', formatYMLong(months[r.fromIdx]));
  thumbTo.setAttribute('aria-valuenow', String(r.toIdx));
  thumbTo.setAttribute('aria-valuetext', formatYMLong(months[r.toIdx]));

  readoutEl.textContent = explicit ? labelFor(explicit) : 'All months';
  resetBtn.hidden = !explicit;
}

function labelFor(r) {
  if (r.fromIdx === r.toIdx) return formatYMLong(months[r.fromIdx]);
  const sameYear = months[r.fromIdx]?.slice(0, 4) === months[r.toIdx]?.slice(0, 4);
  if (sameYear) {
    return `${MN_SHORT[+months[r.fromIdx].slice(5, 7) - 1]} – ${MN_SHORT[+months[r.toIdx].slice(5, 7) - 1]} ${months[r.fromIdx].slice(0, 4)}`;
  }
  return `${formatYMShort(months[r.fromIdx])} – ${formatYMShort(months[r.toIdx])}`;
}

function attachPointer(thumbEl, which) {
  thumbEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = which;
    dragWidth = trackRect().width;
    thumbEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  thumbEl.addEventListener('pointermove', (e) => {
    if (dragging !== which) return;
    const idx = idxFromClientX(e.clientX);
    applyDrag(which, idx);
  });
  const end = (e) => {
    if (dragging !== which) return;
    dragging = null;
    try { thumbEl.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  thumbEl.addEventListener('pointerup', end);
  thumbEl.addEventListener('pointercancel', end);
}

function applyDrag(which, idx) {
  const r = currentRange();
  let from = r.fromIdx, to = r.toIdx;
  if (which === 'from') from = Math.min(idx, to);
  else                  to   = Math.max(idx, from);
  setRange({ fromIdx: from, toIdx: to });
}

function attachKeyboard(thumbEl, which) {
  thumbEl.addEventListener('keydown', (e) => {
    const r = currentRange();
    let from = r.fromIdx, to = r.toIdx;
    const step = e.shiftKey ? 3 : 1;
    let handled = true;
    if (e.key === 'ArrowLeft')      { if (which === 'from') from = Math.max(0, from - step); else to = Math.max(from, to - step); }
    else if (e.key === 'ArrowRight'){ if (which === 'from') from = Math.min(to, from + step); else to = Math.min(months.length - 1, to + step); }
    else if (e.key === 'Home')      { if (which === 'from') from = 0; else to = from; }
    else if (e.key === 'End')       { if (which === 'from') from = to; else to = months.length - 1; }
    else if (e.key === 'Escape')    { setRange(null); return; }
    else handled = false;
    if (handled) {
      e.preventDefault();
      setRange({ fromIdx: from, toIdx: to });
    }
  });
}

function attachTrackClick() {
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === thumbFrom || e.target === thumbTo) return;
    const idx = idxFromClientX(e.clientX);
    const r = currentRange();
    // Move the closer thumb to the click point.
    const dF = Math.abs(idx - r.fromIdx);
    const dT = Math.abs(idx - r.toIdx);
    if (dF <= dT) setRange({ fromIdx: Math.min(idx, r.toIdx),   toIdx: r.toIdx });
    else          setRange({ fromIdx: r.fromIdx, toIdx: Math.max(idx, r.fromIdx) });
  });
}

function formatYMShort(ym) {
  if (!ym) return '';
  const [y, m] = String(ym).split('-');
  return `${MN_SHORT[parseInt(m, 10) - 1] || m} '${y.slice(2)}`;
}
function formatYMLong(ym) {
  if (!ym) return '';
  const [y, m] = String(ym).split('-');
  return `${MN_LONG[parseInt(m, 10) - 1] || m} ${y}`;
}
