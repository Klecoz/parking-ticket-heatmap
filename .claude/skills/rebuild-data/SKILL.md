---
name: rebuild-data
description: Refresh the Buffalo parking-summons JSON files (data/heatmap.json, data/streets.json, data/meta.json) by re-running the Socrata fetch. Use when the user wants to update the data, refresh the heatmap, or pull a newer date window.
disable-model-invocation: true
---

Run the data build script from the repo root:

```bash
node scripts/build-data.mjs
```

Requires Node 20+ (uses global `fetch`). No `npm install` needed.

After it completes:
1. Report the row counts and output file sizes from the script's stdout.
2. If the script logs `bins=0` or `streetCount=0`, the Socrata field names have changed — point the user at `pickLat` / `pickLng` / `pickStreet` in `scripts/build-data.mjs` and a sample row at `https://data.buffalony.gov/resource/yvvn-sykd.json?$limit=1`.
3. If it 403s, the network is sandboxed — tell the user to run from a residential network (do not retry from here).
4. Do not auto-commit. Show `git diff --stat data/` and let the user decide.

Common flag overrides the user may ask for (pass through verbatim):
- `--since YYYY-MM-DD` — change the date window
- `--grid 0.0012` — coarser bins (smaller output) if the 4 MB cap trips
- `SOCRATA_APP_TOKEN=…` env var — avoid throttling

Full reference: `scripts/README.md`.
