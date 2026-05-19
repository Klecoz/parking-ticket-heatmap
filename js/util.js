// Shared helpers: number formatting, color ramps, tooltip, street normalization.

export const FMT_NUM = new Intl.NumberFormat('en-US');
export const fmt = (n) => FMT_NUM.format(n);

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function titleCase(s) {
  return String(s).toLowerCase().replace(/\b([a-z])([a-z0-9']*)/g, (_, a, b) => a.toUpperCase() + b);
}

// Same normalization as scripts/build-data.mjs — must stay in sync.
export function normalizeStreet(s) {
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
    .replace(/\bCOURT\b/g, 'CT')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bCIRCLE\b/g, 'CIR')
    .replace(/\bHIGHWAY\b/g, 'HWY')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bWEST\b/g, 'W')
    .replace(/\s+/g, ' ')
    .trim();
}

// Perceptual ramp from surface (no data) → accent → deep.
// t in [0, 1]; returns CSS rgb string.
const RAMP_STOPS = [
  [0.00, [242, 240, 236]], // --surface
  [0.20, [217, 232, 220]],
  [0.45, [121, 173, 132]],
  [0.70, [26, 107, 74]],   // --accent
  [1.00, [10, 61, 41]],    // --accent-deep
];

export function rampColor(t) {
  if (!Number.isFinite(t) || t <= 0) return 'rgb(242, 240, 236)';
  if (t >= 1) return 'rgb(10, 61, 41)';
  for (let i = 1; i < RAMP_STOPS.length; i++) {
    const [t0, c0] = RAMP_STOPS[i - 1];
    const [t1, c1] = RAMP_STOPS[i];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * k);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * k);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * k);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return 'rgb(10, 61, 41)';
}

// Square-root scale: makes small values more visible against the dominant streets.
export function rampValue(count, maxCount) {
  if (!Number.isFinite(count) || count <= 0 || maxCount <= 0) return 0;
  return Math.min(1, Math.sqrt(count / maxCount));
}

// Shared tooltip singleton.
let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) tooltipEl = document.getElementById('tooltip');
  return tooltipEl;
}
export function showTooltip(html, x, y) {
  const el = ensureTooltip();
  if (!el) return;
  el.innerHTML = html;
  el.classList.add('visible');
  positionTooltip(x, y);
}
export function moveTooltip(x, y) { positionTooltip(x, y); }
export function hideTooltip() {
  const el = ensureTooltip();
  if (el) el.classList.remove('visible');
}
function positionTooltip(x, y) {
  const el = ensureTooltip();
  if (!el) return;
  const PAD = 12;
  const rect = el.getBoundingClientRect();
  let nx = x + PAD;
  let ny = y - rect.height - PAD;
  if (nx + rect.width > window.innerWidth - 8) nx = x - rect.width - PAD;
  if (ny < 8) ny = y + PAD;
  el.style.left = `${Math.max(8, nx)}px`;
  el.style.top  = `${Math.max(8, ny)}px`;
}
