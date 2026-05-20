// Entry point: load static JSON, mount components, wire cross-component callbacks.

import { mountChips } from "./chips.js";
import { mountDuel } from "./duel.js";
import { mountLayers } from "./layers.js";
import { mountLeaderboard } from "./leaderboard.js";
import { mountLookup, selectStreet } from "./lookup.js";
import { highlightStreet, mountMap } from "./map.js";
import { mountMeta } from "./meta.js";
import { mountRange } from "./range.js";
import { mountRisk } from "./risk.js";
import {
  configureState,
  getStreet,
  hydrateFromHash,
  subscribe,
} from "./state.js";
import { mountTimeView } from "./time.js";
import {
  configureTimeIndex,
  getTotalCount,
  initTimeIndex,
} from "./timeIndex.js";
import { mountTimelapse } from "./timelapse.js";
import { fmt } from "./util.js";

(async () => {
  document.getElementById("footer-year").textContent = new Date().getFullYear();

  const backToTop = document.getElementById("back-to-top");
  window.addEventListener(
    "scroll",
    () => {
      backToTop.classList.toggle("visible", window.scrollY > 400);
    },
    { passive: true },
  );
  backToTop.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: "smooth" }),
  );

  let meta, streets, streetsTime, time, streetsFc, neighborhoods;
  try {
    [meta, streets, streetsTime, time, streetsFc] = await Promise.all([
      fetchJson("data/meta.json"),
      fetchJson("data/streets.json"),
      fetchJson("data/streets-time.json"),
      fetchJson("data/time.json"),
      fetchJson("data/streets.geojson"),
    ]);
  } catch (err) {
    console.error("[app] data load failed:", err);
    document.getElementById("headerCurrency").textContent = "Data unavailable";
    return;
  }
  // Load neighborhoods non-blocking — leaderboard degrades gracefully without it.
  // Shape: { neighborhoods: [...], streetNeighborhood: { [normKey]: nbKey } }
  const neighborhoodsData = await fetchJson("data/neighborhoods.json").catch(
    () => null,
  );
  neighborhoods = neighborhoodsData?.neighborhoods ?? neighborhoodsData ?? [];
  const streetNeighborhoodMap = neighborhoodsData?.streetNeighborhood ?? {};

  // Must be called before any component reads from timeIndex.
  initTimeIndex({ streetsTime, streets });
  // Pass street→neighborhood map so timeIndex can gate counts to active neighborhood.
  configureTimeIndex({ streetNeighborhood: streetNeighborhoodMap });

  paintHeader(meta);
  paintHeroStats(meta);

  const catalog = meta.violationCatalog || [];

  // Initialize state with months map BEFORE hydrating from URL hash.
  configureState({ months: meta.months || [], streets });
  window.__heatmapMonths = meta.months || [];
  hydrateFromHash();

  const onStreetSelected = (norm) => {
    selectStreet(norm);
    highlightStreet(norm);
    document
      .getElementById("lookup")
      .scrollIntoView({ behavior: "smooth", block: "start" });
  };

  mountChips({ catalog });
  mountRange({ months: meta.months || [] });
  mountMap({
    streetsFc,
    onStreetSelected,
    streetNeighborhood: streetNeighborhoodMap,
  });
  mountTimeView({ time, catalog, months: meta.months || [] });
  mountLookup({
    streets,
    catalog,
    months: meta.months || [],
    onStreetSelected,
    streetNeighborhood: streetNeighborhoodMap,
  });
  mountLeaderboard({
    streets,
    catalog,
    months: meta.months || [],
    neighborhoods: neighborhoods || [],
    onStreetSelected,
  });
  mountTimelapse({ months: meta.months || [] });
  mountDuel({ streets, catalog, months: meta.months || [], time });
  mountMeta({ catalog, months: meta.months || [], streets });
  mountLayers();
  mountRisk({
    streets,
    months: meta.months || [],
    time,
    streetsFc,
    streetCount: meta.streetCount,
  });

  // If a street was hydrated from the URL hash, restore the stats card + map highlight.
  const persistedStreet = getStreet();
  if (persistedStreet && streets[persistedStreet]) {
    selectStreet(persistedStreet);
    setTimeout(() => highlightStreet(persistedStreet), 200);
  }

  // Keep hero "Tickets" stat in sync with filter + range.
  const hsTickets = document.getElementById("hsTickets");
  subscribe((state) => {
    if (hsTickets) hsTickets.textContent = fmt(getTotalCount(state));
  });
})();

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function paintHeader(meta) {
  const el = document.getElementById("headerCurrency");
  if (meta.sample) {
    el.textContent = "Sample data";
    el.classList.add("sample");
    return;
  }
  if (meta.dateRange) {
    el.textContent = `${meta.dateRange.from} → ${meta.dateRange.to}`;
  } else if (meta.generatedAt) {
    el.textContent = `Updated ${meta.generatedAt.slice(0, 10)}`;
  } else {
    el.textContent = "";
  }
}

function paintHeroStats(meta) {
  document.getElementById("hsTickets").textContent = fmt(meta.rowCount || 0);
  document.getElementById("hsStreets").textContent = fmt(meta.streetCount || 0);
  const range = meta.dateRange;
  if (range) {
    document.getElementById("hsRange").textContent =
      `${formatShort(range.from)} – ${formatShort(range.to)}`;
  } else {
    document.getElementById("hsRange").textContent = "—";
  }
}

function formatShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
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
  return `${MN[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}
