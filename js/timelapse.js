// Animated month-by-month timelapse. Drives state.range through every month
// in sequence so the map and all dependent views re-render in step.

import { getPlay, getRange, setPlay, setRange, subscribe } from "./state.js";

const FRAME_MS = 600; // dwell time per month
const TOTAL_TARGET_MS = 18000; // total play length target; adjust dwell for short data ranges

let months = [];
let monthLabels = []; // pretty labels for readout
let timer = null;
let cursor = 0;
let returnRange = null; // range to restore after timelapse ends

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

export function mountTimelapse({ months: m }) {
  months = m || [];
  monthLabels = months.map((ym) => {
    const [y, mm] = String(ym).split("-");
    return `${MN[+mm - 1] || mm} ${y}`;
  });
  const btn = document.getElementById("timelapsePlay");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (getPlay()) setPlay(false);
    else setPlay(true);
  });
  subscribe(syncWithState);
  syncWithState();
}

function syncWithState() {
  const want = getPlay();
  if (want && !timer) start();
  else if (!want && timer) stop({ restoreRange: false });
  paintUI();
}

function paintUI() {
  const btn = document.getElementById("timelapsePlay");
  const progress = document.getElementById("timelapseProgress");
  if (!btn || !progress) return;
  const playing = getPlay();
  btn.classList.toggle("playing", playing);
  btn.setAttribute(
    "aria-label",
    playing ? "Stop timelapse" : "Play monthly timelapse",
  );
  btn.querySelector(".tl-icon").innerHTML = playing ? "&#9632;" : "&#9654;";
  btn.querySelector(".tl-label").textContent = playing
    ? "Stop"
    : "Play timelapse";
  progress.hidden = !playing;
}

function start() {
  if (!months.length || timer) return;
  returnRange = getRange();
  cursor = 0;
  const dwell = Math.max(
    220,
    Math.min(FRAME_MS, Math.round(TOTAL_TARGET_MS / months.length)),
  );
  // Assign timer BEFORE the initial tick(), otherwise the synchronous
  // setRange() inside tick() re-enters syncWithState (sees !timer) and
  // calls start() again — stacking multiple intervals that "Stop" can't
  // clear.
  timer = setInterval(tick, dwell);
  tick();
}

function stop({ restoreRange }) {
  if (timer) clearInterval(timer);
  timer = null;
  if (restoreRange) {
    setRange(returnRange);
  }
  returnRange = null;
}

function tick() {
  if (cursor >= months.length) {
    // Finished: stop, restore prior range, and tell state we're done playing.
    stop({ restoreRange: true });
    setPlay(false);
    return;
  }
  setRange({ fromIdx: cursor, toIdx: cursor });
  updateProgress(cursor);
  cursor++;
}

function updateProgress(i) {
  const m = document.getElementById("timelapseMonth");
  const fill = document.getElementById("timelapseBarFill");
  if (m) m.textContent = monthLabels[i] || "";
  if (fill) {
    const pct = months.length > 1 ? (i / (months.length - 1)) * 100 : 100;
    fill.style.width = `${pct}%`;
  }
}
