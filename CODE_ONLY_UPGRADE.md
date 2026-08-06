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

V10.46 keeps the approved simplified taxonomy and changes the admin password to the new user-selected password. The admin entry still requires a password in the current browser session and automatically expires after 12 hours; public viewing and market/ledger logic are unchanged. Upload `index.html`, `script.js`, `style.css`, `fresh-radar.css`, `layout-v10.34.css`, `service-worker.js`, `avatar-baby.jpg`, and the full `logos/` folder. The price proxy, refresh rules, Worker, and live ledger are unchanged. Do not run `npx wrangler deploy` for this release, and do not upload `data.json`.

V10.48 adds tax-lot accounting for partial sales. New and historical sales can use specific lots, highest-cost, FIFO, LIFO, or the legacy average-cost method. Upload the changed code and test files, but do not upload or replace `data.json`, `backups/`, or quote cache files. The market Worker is unchanged in this release, so no Worker deployment is required.

V10.49 replaces the asset-growth chart with a swipeable return dashboard for inception-to-date, month-to-date, and year-to-date performance. Returns exclude capital contributions and withdrawals. The market Worker and ledger data schema are unchanged, so do not upload or replace `data.json`, `backups/`, or quote cache files.

V10.50 makes month-to-date and year-to-date ranges follow strict calendar periods. A stale snapshot from well before month-end is no longer treated as the new month's baseline; incomplete history is clearly labeled from the first available date. Successful quote refreshes also preserve one local net-asset snapshot per day so future return curves stay continuous. The Worker and ledger schema remain unchanged.

V10.51 displays month-to-date and year-to-date ranges from the first actual US trading day, while separately identifying the first available Dream Fund net-asset snapshot. Performance still uses only the website ledger, holdings, cash, and website quote snapshots; no broker account data is read.

V10.52 reconstructs the first US trading day's closing net asset value from the Dream Fund website ledger and historical closing prices served by the Cloudflare Worker. The inception return now uses the intuitive account formula, total profit or loss divided by cumulative contributed capital. This release requires `npx wrangler deploy`; it never reads IBKR and must not overwrite `data.json`.
