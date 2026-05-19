// Renders the hour×day heatstrip + monthly sparkline. Reacts to filter changes.

import { getFilter, subscribe } from './state.js';
import { DAY_NAMES, fmt, hideTooltip, moveTooltip, rampColor, rampValue, showTooltip } from './util.js';

let timeData = null;
let catalogByKey = null;

export function mountTimeView({ time, catalog }) {
  timeData = time;
  catalogByKey = new Map(catalog.map(c => [c.key, c]));
  buildHeatstripCells();
  render();
  subscribe(render);
  window.addEventListener('resize', () => drawSparkline());
}

function buildHeatstripCells() {
  const wrap = document.getElementById('heatstripCells');
  wrap.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = document.createElement('div');
      c.className = 'heatstrip-cell';
      c.dataset.d = d;
      c.dataset.h = h;
      c.addEventListener('mouseenter', (e) => onCellEnter(e));
      c.addEventListener('mousemove', (e) => moveTooltip(e.clientX, e.clientY));
      c.addEventListener('mouseleave', () => hideTooltip());
      wrap.appendChild(c);
    }
  }
}

function activeLabel() {
  const f = getFilter();
  if (f === '_all') return 'all violations';
  return catalogByKey?.get(f)?.label?.toLowerCase() || f;
}

function render() {
  paintHeatstrip();
  drawSparkline();
  document.getElementById('timeStripSub').textContent = `— ${activeLabel()}`;
  document.getElementById('sparklineSub').textContent = `— ${activeLabel()}`;
}

function currentHourMatrix() {
  const f = getFilter();
  return timeData.hourByDayByViolation[f] || zeroMatrix();
}
function currentMonthly() {
  const f = getFilter();
  return timeData.monthlyByViolation[f] || timeData.monthlyByViolation['_all'] || [];
}
function zeroMatrix() {
  return Array.from({ length: 7 }, () => new Array(24).fill(0));
}

function paintHeatstrip() {
  const mat = currentHourMatrix();
  let max = 0;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (mat[d][h] > max) max = mat[d][h];
  const cells = document.querySelectorAll('#heatstripCells .heatstrip-cell');
  cells.forEach((c) => {
    const d = +c.dataset.d, h = +c.dataset.h;
    const n = mat[d][h];
    const t = rampValue(n, max);
    c.style.background = n > 0 ? rampColor(Math.max(0.12, t)) : 'var(--surface)';
    c.dataset.n = n;
  });
}

function onCellEnter(e) {
  const c = e.currentTarget;
  const d = +c.dataset.d, h = +c.dataset.h;
  const n = +c.dataset.n || 0;
  const hourLabel = `${String(h).padStart(2, '0')}:00`;
  showTooltip(`<strong>${DAY_NAMES[d]} ${hourLabel}</strong>${fmt(n)} tickets`, e.clientX, e.clientY);
}

// --- sparkline ---

function drawSparkline() {
  const svg = document.getElementById('sparkline');
  if (!svg) return;
  const series = currentMonthly();
  svg.innerHTML = '';
  if (!series.length) return;

  const W = 320, H = 90, PADX = 6, PADY = 8;
  const max = Math.max(1, ...series.map(p => p.n));
  const step = series.length > 1 ? (W - PADX * 2) / (series.length - 1) : 0;

  const pts = series.map((p, i) => {
    const x = PADX + i * step;
    const y = H - PADY - ((p.n / max) * (H - PADY * 2));
    return [x, y, p.ym, p.n];
  });

  const ns = 'http://www.w3.org/2000/svg';

  // Area fill
  const area = document.createElementNS(ns, 'path');
  let dArea = `M ${pts[0][0]} ${H - PADY}`;
  for (const [x, y] of pts) dArea += ` L ${x} ${y}`;
  dArea += ` L ${pts[pts.length - 1][0]} ${H - PADY} Z`;
  area.setAttribute('d', dArea);
  area.setAttribute('fill', 'rgba(26, 107, 74, 0.12)');
  svg.appendChild(area);

  // Line
  const line = document.createElementNS(ns, 'path');
  let dLine = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) dLine += ` L ${pts[i][0]} ${pts[i][1]}`;
  line.setAttribute('d', dLine);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--accent)');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(line);

  // Last-point dot
  const last = pts[pts.length - 1];
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', last[0]);
  dot.setAttribute('cy', last[1]);
  dot.setAttribute('r', '2.5');
  dot.setAttribute('fill', 'var(--accent-deep)');
  svg.appendChild(dot);

  // Hover hit-areas (invisible rects, one per month).
  for (let i = 0; i < pts.length; i++) {
    const [x, y, ym, n] = pts[i];
    const hit = document.createElementNS(ns, 'rect');
    hit.setAttribute('x', String(x - (step / 2 || 4)));
    hit.setAttribute('y', '0');
    hit.setAttribute('width', String(step || 8));
    hit.setAttribute('height', String(H));
    hit.setAttribute('fill', 'transparent');
    hit.style.cursor = 'crosshair';
    hit.addEventListener('mouseenter', (e) => {
      showTooltip(`<strong>${formatYM(ym)}</strong>${fmt(n)} tickets`, e.clientX, e.clientY);
    });
    hit.addEventListener('mousemove', (e) => moveTooltip(e.clientX, e.clientY));
    hit.addEventListener('mouseleave', () => hideTooltip());
    svg.appendChild(hit);
  }

  document.getElementById('sparkLabelStart').textContent = formatYM(series[0].ym);
  document.getElementById('sparkLabelEnd').textContent   = formatYM(series[series.length - 1].ym);
}

function formatYM(ym) {
  const [y, m] = String(ym).split('-');
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MN[parseInt(m, 10) - 1] || m} '${y.slice(2)}`;
}
