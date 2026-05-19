# Buffalo parking-heatmap data build

The page is driven by three static JSON files in `data/`:

- `heatmap.json`  — weighted `[lat, lng, count]` triples binned to a ~30 m grid
- `streets.json`  — per-street totals, top violations, and citywide rank
- `meta.json`     — generation timestamp, source IDs, row counts

These are pre-aggregated so the page makes **zero** runtime calls to
`data.buffalony.gov`. The repo ships with a small **sample** dataset so the
page renders out of the box; to refresh with real data, run the build script.

## Refresh the data

Requires Node 20+ (uses global `fetch`). No `npm install` needed.

```bash
# from repo root
node scripts/build-data.mjs
```

Common overrides:

```bash
# pull a different date window
node scripts/build-data.mjs --since 2022-01-01

# coarser heatmap bins (faster, smaller file)
node scripts/build-data.mjs --grid 0.0012

# override the Socrata dataset 4x4 IDs
node scripts/build-data.mjs \
  --raw-id yvvn-sykd \
  --street-id es5y-a4h6
```

If you have a Socrata app token to avoid throttling:

```bash
SOCRATA_APP_TOKEN=xxxxxxxx node scripts/build-data.mjs
```

## Data sources

Both datasets live on the City of Buffalo's open data portal
(`data.buffalony.gov`), powered by Socrata SODA:

| Dataset                             | 4x4 ID      | Used for                              |
|-------------------------------------|-------------|---------------------------------------|
| [Parking Summonses][raw]            | `yvvn-sykd` | Heatmap points + per-street top violations |
| [Parking Summonses by Street][agg]  | `es5y-a4h6` | Fallback if grouped query above fails |

[raw]: https://data.buffalony.gov/Transportation/Parking-Summonses/yvvn-sykd
[agg]: https://data.buffalony.gov/Transportation/Parking-Summonses-by-Street/es5y-a4h6

## Field-name resolution

The script doesn't hard-code Socrata field names — it tries several common
spellings and uses whichever is present on the row:

| Logical field | Tried in order                                                        |
|---------------|------------------------------------------------------------------------|
| latitude      | `latitude`, `location.latitude`, `location.coordinates[1]`, `geocoded_column.latitude` |
| longitude     | `longitude`, `location.longitude`, `location.coordinates[0]`, `geocoded_column.longitude` |
| street name   | `street`, `street_name`, `block`, `address`, `location_street`        |
| violation     | `violation_description`, `description`, `violation`, `violation_code` |

If the dataset has changed since this was written, the first run will log
`bins=0` and `streetCount=0`. Inspect a sample row in your browser at
`https://data.buffalony.gov/resource/yvvn-sykd.json?$limit=1` and update the
`pickLat` / `pickLng` / `pickStreet` helpers in `build-data.mjs`.

## Output budgets

The script hard-fails if the total of the three JSON files exceeds **4 MB**.
Typical output with the defaults (`--since 2023-01-01 --grid 0.0008`):

- `heatmap.json`  ~1–1.5 MB
- `streets.json`  ~150–300 KB
- `meta.json`     <1 KB

If you blow the cap, raise `--grid` (e.g. `0.0012` ≈ 50 m bins) or shorten the
date window with `--since`.

## CORS / Cloudflare note

Some sandboxed environments (CI containers, headless cloud runners) get 403s
from `data.buffalony.gov`. Run the script from a normal residential network
or a GitHub Actions runner if you hit that wall.

## Commit the outputs

The generated JSON is tracked in git — that's the whole point. After
running the script, commit the updated files:

```bash
git add data/*.json
git commit -m "Refresh Buffalo parking-heatmap data"
```
