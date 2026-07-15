# Code-only upgrade rule

When upgrading the website version, upload code assets only.

Do upload:
- `index.html`
- `script.js`
- `style.css`
- `fresh-radar.css`
- `service-worker.js`
- `manifest.webmanifest`
- icon/image assets when changed

Do not upload:
- `data.json`
- `backups/`
- `kv-fx-EUR.json`
- `kv-quotes-all-current.json`
- `.wrangler/`
- `cloudflare-worker.js` and `wrangler.toml` only when the release explicitly says Worker deployment is required

`data.json` is the live ledger. It should be changed only by the website admin safe-save flow, so a local code release cannot overwrite newer holdings on GitHub.

V10.33 is a Worker release: upload the code assets, deploy `cloudflare-worker.js` with `npx wrangler deploy`, and never upload `data.json` during a code release. This release removes duplicate quote retries, sanitizes upstream error headers, and preserves static/last-close fallback behavior.

V10.34 is a visual-only release: upload `index.html`, `script.js`, `style.css`, `fresh-radar.css`, and `service-worker.js`. It keeps the V10.33 Worker and ledger schema unchanged, adds the fresh white/green radar visual system, and adds local company monogram marks inside the cost map. Do not upload `data.json`, backups, caches, or `.wrangler/`.

V10.45 keeps the approved simplified taxonomy: `AI基建`, `半导体`, `光通信`, `太空`, `科技平台`, `医疗`, and `现金`. MU and DRAM are consolidated into `半导体`; TSLA and common EV symbols remain in `科技平台`. Previously saved `AI存储` and `智能汽车` labels are migrated automatically, and all existing unlocked holdings plus transaction metadata are reclassified once. New trades still receive automatic sector classification and same-sector color variants, while manual sector/color locks remain available. The admin entry now requires a password in the current browser session and automatically expires after 12 hours; public viewing and market/ledger logic are unchanged. The V10.39 squarified treemap, dynamic height, minimum readable area, adaptive logo/text levels, mobile grid, monogram fallback, and horizontal compact mode remain unchanged. Upload `index.html`, `script.js`, `style.css`, `fresh-radar.css`, `layout-v10.34.css`, `service-worker.js`, `avatar-baby.jpg`, and the full `logos/` folder. The price proxy, refresh rules, Worker, and live ledger are unchanged. Do not run `npx wrangler deploy` for this release, and do not upload `data.json`.
