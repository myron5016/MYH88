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
- `wrangler.toml` unless Worker config intentionally changed

`data.json` is the live ledger. It should be changed only by the website admin safe-save flow, so a local code release cannot overwrite newer holdings on GitHub.
