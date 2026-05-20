# Feature Audit — Buffalo Parking Ticket Heatmap

Generated: 2026-05-19

---

## Context

The underlying dataset is 320,983 Buffalo parking summonses from 2024-01-01 onward, pre-aggregated into five JSON files covering per-street totals, per-street × per-month breakdowns, and citywide hour-by-day-by-violation matrices. The data is rich for answering *where* and *when* enforcement happens across the city's 3,530 named streets, but it lacks fine-grained dimensions that a decision-aid app would need: no per-street hour-of-day distribution, no fine amounts, no normalization by street length or parking supply, and no individual summons records. Three supplemental overlay files (snow events, venues, neighborhood polygons) add geographic and contextual flavor but have no computational linkage to the ticket data, either because of temporal non-overlap (snow events cover 2022–2023 only) or because the join was never computed (neighborhoods). The app's core — map, lookup, leaderboard, time heatstrip — sits on solid data ground. Its analytic extensions (risk calculator, duel) over-promise relative to what the aggregates can actually support.

---

## Keep

| Feature | Why it earns its place | Data justification |
|---|---|---|
| Street-line heatmap | Primary visual entry point; shows citywide enforcement geography at a glance | streets.geojson has geometry + per-street ticket totals; 6,359 of 11,629 segments matched (~55% match rate is expected given normalization differences) |
| Street lookup + stats card | Core utility: find any street, see count, rank, percentile, violation mix | streets.json covers 3,530 streets with per-violation breakdown and top-3 raw violations; streets-time.json enables range-filtered stats |
| Leaderboard | Directly answers "worst streets"; clicking feeds stats card | Same streets.json + streets-time.json foundation; ranking is unambiguous |
| Hour × day heatstrip | Best single view for *when* enforcement happens; both "By day" and "By type" tabs are data-grounded | time.json: `hourByDayByViolation` and `hourByDayByMonth` exactly match what these views render |
| Monthly sparkline + brush | Shows enforcement trend over time; the brushable range is the most discoverable range-entry point because it sits adjacent to the data it controls | time.json: `monthlyByViolation` covers 2024-01 through present |
| Timelapse player | Monthly animation unit matches monthly data granularity — no over-promise | streets-time.json per-street × per-month matrix drives each frame |
| Violation filter chips | Cuts every view to one enforcement type; citywide violation catalog is well-supported | meta.json: `violationCatalog` with 7 buckets (6 named + "other"); "other" is 18.3% of all tickets |
| Meter/permit zone overlays | Adds decision-relevant context (am I in a permit zone?) without implying ticket linkage | Hand-drawn polygons with text rules; no ticket aggregates misleadingly implied |
| URL hash sync | Enables share-links for street + filter + range + duel state | Pure state serialization; zero data dependency |
| Dynamic OG tags | Makes share-links descriptive in social previews | Reads already-loaded state; no new data dependency |

---

## Simplify

| Feature | Problem | Proposed simplification |
|---|---|---|
| Risk calculator probability framing | Outputs `P(ticket) = N%` with a color-coded verdict badge ("Risky", "Very low"). The formula uses raw street ticket counts scaled by citywide hour distribution — no normalization for street length, parking supply, or vehicle volume (time.json provides citywide hour fractions but not per-street hour shape). A long arterial scores identically to a short dead-end with the same count. | Strip the color-coded verdict badge and reframe output as "relative risk index vs. other streets" (a rank/percentile). The data supports ranking streets against each other; it does not support calibrated absolute probabilities. |
| Duel hour ministrip | Each duel card shows a 24-cell hour strip that is explicitly derived by scaling the citywide hour distribution by street total count — so both cards in every matchup show the same curve shape, differing only in scale. This makes the strip useless for comparing enforcement timing between two streets, which is its implied purpose. | Replace the hour strip with the per-street violation-type breakdown (byViolation, already in streets.json), which IS meaningfully different per street and directly comparable. |
| Three redundant range-entry controls | Users can set date range via three controls: top range slider (rangeSlider.js), sparkline brush (time.js + range.js), and date-range chip popover (range.js). The top slider and sparkline brush serve nearly identical drag-to-select paradigms for the same state dimension. | Remove the top range slider. The sparkline brush is the most naturally discoverable (adjacent to the data it filters); the chip popover provides discrete month-name visibility. Two entry points are enough. |
| Neighborhoods overlay | neighborhoods.geojson has 9 polygons with name + key only — no ticket counts. The overlay draws outlines and tooltips showing only the name. No analytical value beyond orientation. A client-side spatial join is possible but approximate and not implemented. | Either pre-compute per-neighborhood ticket totals in the build script (spatial join of neighborhood polygons × street centroids × streets.json counts) and embed them in neighborhoods.geojson properties, or demote the layer to a non-interactive base-map reference that is always visible, removing it from the toggle bar. |
| Venue overlay implication | events.json has 4 venue lat/lng points with season month arrays but no game dates and no ticket linkage. The "Venues" toggle implies game-day enforcement correlation that the data cannot support. | Keep the marker layer as a geographic landmark but retitle the toggle to "Stadiums" and remove any UI framing suggesting enforcement correlation. Add a tooltip note: "Location only — no game-day ticket data available." |

---

## Cut

| Feature | Reason | What's lost |
|---|---|---|
| Snow event sparkline overlay | snow-events.json covers 8 storms from 2022–2023. The ticket dataset starts 2024-01-01. The overlay searches for each snow event's year-month in the months list and draws a marker only if the month exists in that list. Since no 2022–2023 month exists in the 2024+ months list, the overlay never renders a single marker under any normal use. The feature is completely inert. | Nothing — the overlay is already invisible to all users. The toggle UI noise is the only cost of keeping it. |

---

## Add

| Feature | What data supports it | Sketch |
|---|---|---|
| Per-neighborhood leaderboard | A build-time spatial join of neighborhoods.geojson polygons × streets.geojson segment centroids × streets.json counts would produce per-neighborhood ticket totals — a question the data can answer but has not been asked. neighborhoods.geojson already has the polygons; streets.geojson has the geometry; streets.json has the counts. | Add a `neighborhoodTotals` step to build-data.mjs. Embed per-neighborhood counts in neighborhoods.geojson properties or a separate `neighborhoods.json`. Surface as a "By neighborhood" tab in the leaderboard component. |
| Violation type × time-of-day detail | time.json `hourByDayByViolation` already provides a per-violation-type hour×day matrix. The existing "By type" heatstrip collapses across all days. The data directly enables "meter violations peak 9–11 AM; alternate-side violations peak Tuesday/Thursday mornings." | Add a day-of-week selector or small-multiples expansion to the "By type" tab in time.js, reading from the already-loaded `hourByDayByViolation` object. No new data files needed. |

---

## Implementation order

If implementation begins, address in this sequence:

1. **Drop snow event overlay** — zero-risk removal; the feature is already inert and its code can be deleted without affecting any other feature.
2. **Fix duel hour ministrip** — replace citywide-shaped hour strip with per-street violation-type breakdown from streets.json. Corrects a silent data integrity issue visible to any user who uses the duel feature.
3. **Reframe risk calculator output** — swap absolute probability + verdict badge for a relative rank/percentile display. Requires only UI changes in risk.js; the underlying formula can stay.
4. **Remove top range slider** — simplifies the UI and eliminates a redundant interaction surface. Requires deleting rangeSlider.js import from app.js and removing its DOM section.
5. **Pre-compute neighborhood totals at build time** — enables the neighborhoods overlay to deliver actual analytical value and unlocks the per-neighborhood leaderboard tab.
6. **Per-neighborhood leaderboard tab** — depends on #5; add a tab to leaderboard.js.
7. **Violation type × time-of-day detail** — no data changes needed; UI-only enhancement to time.js using already-loaded `hourByDayByViolation`.
8. **Venue overlay relabeling** — low-effort; retitle toggle, update tooltip text to remove implied correlation.
9. **Neighborhoods overlay demotion** — conditional on #5; if neighborhood totals are not computed, remove the toggle and bake boundaries into the base map as a permanent non-interactive layer.
