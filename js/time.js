// Renders the hour×day heatstrip + monthly sparkline. Reacts to filter + range changes.

import { attachSparklineBrush } from "./range.js";
import {
  getFilter,
  getRange,
  getTimeView,
  setTimeView,
  subscribe,
} from "./state.js";
import {
  DAY_NAMES,
  fmt,
  hideTooltip,
  moveTooltip,
  rampColor,
  rampValue,
  showTooltip,
} from "./util.js";

let timeData = null;
let catalogByKey = null;
let catalogList = []; // ordered list of violation entries (for byType rows)
let metaMonths = []; // ["2024-01", ...] — needed to sum per-month matrices
let selectedDow = "all"; // "all" or 0–6 (Sunday=0)

export function mountTimeView({ time, catalog, months }) {
  timeData = time;
  catalogByKey = new Map(catalog.map((c) => [c.key, c]));
  catalogList = catalog || [];
  metaMonths = months || [];
  buildHeatstripCells();
  buildToggle();
  buildDowSelector();
  render();
  subscribe(render);
  window.addEventListener("resize", () => drawSparkline());
}

function buildToggle() {
  const btns = document.querySelectorAll(".time-toggle-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view === "byType" ? "byType" : "all";
      setTimeView(view);
    });
  });
}

function buildDowSelector() {
  const selector = document.getElementById("bytypeDowSelector");
  if (!selector) return;
  selector.querySelectorAll(".dow-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.dow;
      selectedDow = val === "all" ? "all" : parseInt(val, 10);
      applyDowState();
      paintByTypeHeatstrip();
    });
  });
}

function applyDowState() {
  const selector = document.getElementById("bytypeDowSelector");
  if (!selector) return;
  selector.querySelectorAll(".dow-chip").forEach((btn) => {
    const val = btn.dataset.dow;
    const active =
      selectedDow === "all" ? val === "all" : parseInt(val, 10) === selectedDow;
    btn.classList.toggle("dow-chip-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function applyToggleState() {
  const view = getTimeView();
  const btns = document.querySelectorAll(".time-toggle-btn");
  btns.forEach((btn) => {
    const on = btn.dataset.view === view;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.classList.toggle("active", on);
  });
  const byDay = document.getElementById("heatstripByDay");
  const byType = document.getElementById("heatstripByType");
  const dowSelector = document.getElementById("bytypeDowSelector");
  if (byDay) byDay.hidden = view !== "all";
  if (byType) byType.hidden = view !== "byType";
  if (dowSelector) dowSelector.hidden = view !== "byType";
  const heading = document.getElementById("timeStripHeading");
  if (heading) {
    const lead =
      view === "byType" ? "Hour of day · by violation" : "Hour × day of week";
    if (heading.firstChild) heading.firstChild.textContent = `${lead} `;
  }
}

function buildHeatstripCells() {
  const wrap = document.getElementById("heatstripCells");
  wrap.innerHTML = "";
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = document.createElement("div");
      c.className = "heatstrip-cell";
      c.dataset.d = d;
      c.dataset.h = h;
      c.addEventListener("mouseenter", (e) => onCellEnter(e));
      c.addEventListener("mousemove", (e) => moveTooltip(e.clientX, e.clientY));
      c.addEventListener("mouseleave", () => hideTooltip());
      wrap.appendChild(c);
    }
  }
}

function activeLabel() {
  const f = getFilter();
  if (f === "_all") return "all violations";
  return catalogByKey?.get(f)?.label?.toLowerCase() || f;
}

// Format a short scope label for the active range, e.g. "Mar '25" or "Mar '25 – May '26".
function activeScopeLabel() {
  const range = getRange();
  if (!range || !metaMonths.length) return null;
  const MN = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const fmt0 = (ym) => {
    if (!ym) return "";
    const [y, m] = String(ym).split("-");
    return `${MN[parseInt(m, 10) - 1] || m} '${y.slice(2)}`;
  };
  if (range.fromIdx === range.toIdx) return fmt0(metaMonths[range.fromIdx]);
  return `${fmt0(metaMonths[range.fromIdx])} – ${fmt0(metaMonths[range.toIdx])}`;
}

function render() {
  applyToggleState();
  if (getTimeView() === "byType") {
    paintByTypeHeatstrip();
  } else {
    paintHeatstrip();
  }
  drawSparkline();
  const scopePart = activeScopeLabel() ? ` · ${activeScopeLabel()}` : "";
  const dowLabel = selectedDow === "all" ? "all days" : DAY_NAMES[selectedDow];
  const subLabel =
    getTimeView() === "byType" ? `all violations · ${dowLabel}` : activeLabel();
  document.getElementById("timeStripSub").textContent =
    `— ${subLabel}${scopePart}`;
  document.getElementById("sparklineSub").textContent =
    `— ${activeLabel()}${scopePart}`;
}

function currentHourMatrix() {
  const f = getFilter();
  const range = getRange();

  if (!range) {
    // Fast path: use precomputed all-time hourByDayByViolation.
    return timeData.hourByDayByViolation?.[f] || zeroMatrix();
  }

  // Range path: sum hourByDayByMonth[ym][f] across the selected months.
  const { fromIdx, toIdx } = range;
  const selectedMonths = metaMonths.slice(fromIdx, toIdx + 1);
  const result = zeroMatrix();
  const byMonth = timeData.hourByDayByMonth;
  if (!byMonth) return result; // data not present — degrade gracefully
  for (const ym of selectedMonths) {
    const monthData = byMonth[ym];
    if (!monthData) continue;
    const mat = monthData[f] || monthData._all;
    if (!mat) continue;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        result[d][h] += mat[d]?.[h] || 0;
      }
    }
  }
  return result;
}

function currentMonthly() {
  const f = getFilter();
  return (
    timeData.monthlyByViolation?.[f] || timeData.monthlyByViolation?._all || []
  );
}

function zeroMatrix() {
  return Array.from({ length: 7 }, () => new Array(24).fill(0));
}

function paintHeatstrip() {
  const mat = currentHourMatrix();
  let max = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (mat[d][h] > max) max = mat[d][h];
    }
  }
  const cells = document.querySelectorAll("#heatstripCells .heatstrip-cell");
  cells.forEach((c) => {
    const d = +c.dataset.d,
      h = +c.dataset.h;
    const n = mat[d][h];
    const t = rampValue(n, max);
    c.style.background =
      n > 0 ? rampColor(Math.max(0.12, t)) : "var(--surface)";
    c.dataset.n = n;
  });
}

function onCellEnter(e) {
  const c = e.currentTarget;
  const d = +c.dataset.d,
    h = +c.dataset.h;
  const n = +c.dataset.n || 0;
  const hourLabel = `${String(h).padStart(2, "0")}:00`;
  showTooltip(
    `<strong>${DAY_NAMES[d]} ${hourLabel}</strong>${fmt(n)} tickets`,
    e.clientX,
    e.clientY,
  );
}

// --- By-type heatstrip: one row per violation, 24 hour columns ---

function hourTotalsFor(filterKey) {
  // Return a 24-cell vector. When selectedDow is "all", sum all days.
  // When a specific day is selected, read only that day's row.
  const range = getRange();
  const result = new Array(24).fill(0);
  const dayFilter = selectedDow; // "all" or 0-6

  if (!range) {
    const mat = timeData.hourByDayByViolation?.[filterKey];
    if (!mat) return result;
    if (dayFilter === "all") {
      for (let d = 0; d < 7; d++)
        for (let h = 0; h < 24; h++) result[h] += mat[d][h] || 0;
    } else {
      for (let h = 0; h < 24; h++) result[h] = mat[dayFilter]?.[h] || 0;
    }
    return result;
  }

  const byMonth = timeData.hourByDayByMonth;
  if (!byMonth) return result;
  const { fromIdx, toIdx } = range;
  const months = metaMonths.slice(fromIdx, toIdx + 1);
  for (const ym of months) {
    const monthData = byMonth[ym];
    if (!monthData) continue;
    const mat = monthData[filterKey] || monthData._all;
    if (!mat) continue;
    if (dayFilter === "all") {
      for (let d = 0; d < 7; d++)
        for (let h = 0; h < 24; h++) result[h] += mat[d]?.[h] || 0;
    } else {
      for (let h = 0; h < 24; h++) result[h] += mat[dayFilter]?.[h] || 0;
    }
  }
  return result;
}

function paintByTypeHeatstrip() {
  const container = document.getElementById("heatstripByType");
  if (!container) return;
  container.innerHTML = "";

  // Hour labels row across the top
  const head = document.createElement("div");
  head.className = "bt-head";
  const headSpacer = document.createElement("div");
  headSpacer.className = "bt-label";
  head.appendChild(headSpacer);
  const headCells = document.createElement("div");
  headCells.className = "bt-cells bt-hours";
  for (let h = 0; h < 24; h++) {
    const lbl = document.createElement("div");
    lbl.className = "bt-hour";
    if (h % 3 === 0) lbl.textContent = String(h);
    headCells.appendChild(lbl);
  }
  head.appendChild(headCells);
  container.appendChild(head);

  // One row per violation key (skip _all; the rows themselves are the breakdown).
  for (const v of catalogList) {
    const vec = hourTotalsFor(v.key);
    const max = vec.reduce((m, n) => (n > m ? n : m), 0);
    const row = document.createElement("div");
    row.className = "bt-row";

    const label = document.createElement("div");
    label.className = "bt-label";
    const dot = document.createElement("span");
    dot.className = "bt-dot";
    if (v.color) dot.style.background = v.color;
    label.appendChild(dot);
    const lblText = document.createElement("span");
    lblText.className = "bt-label-text";
    lblText.textContent = v.label;
    label.appendChild(lblText);
    row.appendChild(label);

    const cells = document.createElement("div");
    cells.className = "bt-cells";
    for (let h = 0; h < 24; h++) {
      const cell = document.createElement("div");
      cell.className = "bt-cell";
      const n = vec[h];
      const t = rampValue(n, max);
      cell.style.background =
        n > 0 ? mixWithViolationColor(v.color, t) : "var(--surface)";
      cell.dataset.n = n;
      cell.dataset.h = h;
      cell.dataset.v = v.label;
      cell.addEventListener("mouseenter", onByTypeCellEnter);
      cell.addEventListener("mousemove", (e) =>
        moveTooltip(e.clientX, e.clientY),
      );
      cell.addEventListener("mouseleave", () => hideTooltip());
      cells.appendChild(cell);
    }
    row.appendChild(cells);
    container.appendChild(row);
  }
}

function onByTypeCellEnter(e) {
  const c = e.currentTarget;
  const n = +c.dataset.n || 0;
  const h = +c.dataset.h;
  const v = c.dataset.v || "";
  const hourLabel = `${String(h).padStart(2, "0")}:00`;
  showTooltip(
    `<strong>${v} · ${hourLabel}</strong>${fmt(n)} tickets`,
    e.clientX,
    e.clientY,
  );
}

// Tint a violation color by intensity t in [0,1].
// Low t → light tint over surface; high t → near full color.
function mixWithViolationColor(hex, t) {
  if (!hex) return rampColor(Math.max(0.12, t));
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return rampColor(Math.max(0.12, t));
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  // Mix toward surface (242,240,236) at low t.
  const k = Math.max(0.18, t);
  const mix = (c, base) => Math.round(base + (c - base) * k);
  return `rgb(${mix(r, 242)}, ${mix(g, 240)}, ${mix(b, 236)})`;
}

// --- sparkline ---

function drawSparkline() {
  const svg = document.getElementById("sparkline");
  if (!svg) return;
  const series = currentMonthly();
  svg.innerHTML = "";
  if (!series.length) return;

  const W = 320,
    H = 90,
    padX = 6,
    padY = 8;
  const max = Math.max(1, ...series.map((p) => p.n));
  const step = series.length > 1 ? (W - padX * 2) / (series.length - 1) : 0;

  const pts = series.map((p, i) => {
    const x = padX + i * step;
    const y = H - padY - (p.n / max) * (H - padY * 2);
    return [x, y, p.ym, p.n];
  });

  const ns = "http://www.w3.org/2000/svg";

  // Area fill
  const area = document.createElementNS(ns, "path");
  let dArea = `M ${pts[0][0]} ${H - padY}`;
  for (const [x, y] of pts) dArea += ` L ${x} ${y}`;
  dArea += ` L ${pts[pts.length - 1][0]} ${H - padY} Z`;
  area.setAttribute("d", dArea);
  area.setAttribute("fill", "rgba(26, 107, 74, 0.12)");
  svg.appendChild(area);

  // Line
  const line = document.createElementNS(ns, "path");
  let dLine = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) dLine += ` L ${pts[i][0]} ${pts[i][1]}`;
  line.setAttribute("d", dLine);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--accent)");
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(line);

  // Last-point dot
  const last = pts[pts.length - 1];
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", last[0]);
  dot.setAttribute("cy", last[1]);
  dot.setAttribute("r", "2.5");
  dot.setAttribute("fill", "var(--accent-deep)");
  svg.appendChild(dot);

  // Per-month hit areas: show tooltips. Pointer events propagate through to the
  // SVG (where range.js's brush handler lives), so clicking a month both shows a
  // tooltip and starts a 1-month brush — they don't conflict.
  for (let i = 0; i < pts.length; i++) {
    const [x, , ym, n] = pts[i];
    const hit = document.createElementNS(ns, "rect");
    hit.setAttribute("x", String(x - (step / 2 || 4)));
    hit.setAttribute("y", "0");
    hit.setAttribute("width", String(step || 8));
    hit.setAttribute("height", String(H));
    hit.setAttribute("fill", "transparent");
    hit.addEventListener("mouseenter", (e) => {
      showTooltip(
        `<strong>${formatYM(ym)}</strong>${fmt(n)} tickets`,
        e.clientX,
        e.clientY,
      );
    });
    hit.addEventListener("mousemove", (e) => moveTooltip(e.clientX, e.clientY));
    hit.addEventListener("mouseleave", () => hideTooltip());
    svg.appendChild(hit);
  }

  document.getElementById("sparkLabelStart").textContent = formatYM(
    series[0].ym,
  );
  document.getElementById("sparkLabelEnd").textContent = formatYM(
    series[series.length - 1].ym,
  );

  // Attach (or re-attach) the brush overlay. Called every redraw (including resize).
  attachSparklineBrush(svg, { padX, padY, w: W, h: H, step });
}

function formatYM(ym) {
  const [y, m] = String(ym).split("-");
  const MN = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${MN[parseInt(m, 10) - 1] || m} '${y.slice(2)}`;
}
