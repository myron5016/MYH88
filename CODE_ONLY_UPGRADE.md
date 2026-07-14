# Code-only upgrade rule

When upgrading the website version, upload code assets only.

Do upload:
- `index.html`
- `script.js`
- `style.css`
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
