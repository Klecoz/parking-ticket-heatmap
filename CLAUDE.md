# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static web app: a Leaflet heatmap of Buffalo, NY parking summonses plus a per-street lookup. Pre-aggregated JSON ships with the repo — the page makes **zero** API calls at runtime.

No `package.json`. No build step for the frontend. No test or lint suite.

## Local serve

```bash
python3 -m http.server 8765
# open http://localhost:8765/
```

The page uses `fetch()` on local JSON, so opening `index.html` via `file://` will break it. Always serve.

## Rebuild data

```bash
node scripts/build-data.mjs            # Node 20+ (uses global fetch)
```

Outputs `data/heatmap.json`, `data/streets.json`, `data/meta.json`. All three are committed. Details and flags: `scripts/README.md`.

Gotchas:
- Hard-fails if total output > 4 MB. Raise `--grid` (e.g. `0.0012`) or shorten `--since` window.
- Some sandboxed/headless networks get 403 from `data.buffalony.gov` — run from residential network.
- Set `SOCRATA_APP_TOKEN` env var to avoid throttling.
- Socrata field names are resolved by trying several spellings (see `pickLat`/`pickLng`/`pickStreet` in `build-data.mjs`); first run logs `bins=0` if the dataset changed.

## Lint

Biome is configured for JS lint only (formatting is owned by the prettier post-edit hook):

```bash
npx --yes @biomejs/biome check js/
```

## Commits

Do not add a `Co-Authored-By` trailer to commits or PR descriptions.
