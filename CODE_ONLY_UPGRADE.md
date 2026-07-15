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
