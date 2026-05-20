// Keeps <title> and Open Graph meta tags in sync with the active state so
// share previews reflect the user's filter / range / duel / street choice.

import { getState, subscribe } from "./state.js";
import { titleCase } from "./util.js";

let catalogByKey = null;
let metaMonths = [];
let streets = null;

const DEFAULT_TITLE = "Buffalo Parking Ticket Heatmap";
const DEFAULT_DESCRIPTION =
  "Where Buffalo tickets you. Street-by-street heatmap + time + violation breakdown, built from City of Buffalo Open Data.";
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

export function mountMeta({ catalog, months, streets: s }) {
  catalogByKey = new Map(catalog.map((c) => [c.key, c]));
  metaMonths = months || [];
  streets = s;
  subscribe(update);
  update();
}

function update() {
  const { title, description } = computeMeta(getState());
  setText("documentTitle", title);
  setMetaContent("metaDescription", description);
  setMetaContent("ogTitle", title);
  setMetaContent("ogDescription", description);
}

function computeMeta(state) {
  const parts = [];
  const reasonParts = [];

  // Duel takes priority — most specific share target.
  if (state.duel && streets) {
    const a = streets[state.duel.a]?.display;
    const b = streets[state.duel.b]?.display;
    if (a && b) {
      parts.push(`${titleCase(a)} vs. ${titleCase(b)}`);
      reasonParts.push("head-to-head ticket comparison");
    }
  } else if (state.street && streets?.[state.street]) {
    parts.push(`${titleCase(streets[state.street].display)} parking tickets`);
    reasonParts.push("ticket history and rank");
  }

  if (state.filter && state.filter !== "_all") {
    const label = catalogByKey?.get(state.filter)?.label || state.filter;
    reasonParts.push(`filter: ${label.toLowerCase()}`);
  }
  if (state.range && metaMonths.length) {
    const fromYM = metaMonths[state.range.fromIdx];
    const toYM = metaMonths[state.range.toIdx];
    if (fromYM && toYM) {
      const fromLbl = formatYM(fromYM);
      const toLbl = formatYM(toYM);
      const span = fromYM === toYM ? fromLbl : `${fromLbl}–${toLbl}`;
      reasonParts.push(span);
    }
  }

  if (!parts.length) {
    return {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    };
  }
  const tail = reasonParts.length ? ` · ${reasonParts.join(", ")}` : "";
  return {
    title: `${parts[0]} — Buffalo Parking Heatmap${tail}`,
    description: `Buffalo parking ticket data for ${parts[0]}${reasonParts.length ? ` (${reasonParts.join(", ")})` : ""}. Static dataviz built from City of Buffalo Open Data.`,
  };
}

function formatYM(ym) {
  const [y, m] = String(ym).split("-");
  return `${MN[+m - 1] || m} '${y.slice(2)}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el && el.textContent !== value) el.textContent = value;
}
function setMetaContent(id, value) {
  const el = document.getElementById(id);
  if (el && el.getAttribute("content") !== value)
    el.setAttribute("content", value);
}
