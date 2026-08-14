# Ledger Carousel Final Fix Report

## Fix Commit

- `5b9c603 fix: harden v11.7.1 ledger release`

## Findings Addressed

- Updated only `script.part1.js`, `script.part3.js`, and `script.part4.js` URL fingerprints to `11.7.1` in `index.html` and the service-worker app shell. Parts 2, 5, and 6 remain `11.6.0`.
- Changed release validation to require the exact per-script version matrix in both `index.html` and `service-worker.js`, including exactly one match per file.
- Added `inert` to inactive ledger panes and synchronized the track height to the active pane on switches and `ResizeObserver` updates while preserving the horizontal transform.
- Changed only the overview's latest-trade selection so a later inserted transaction wins when dates tie.
- Added a 44px minimum height to `.ledger-page-navigation .tab` and aligned carousel pages to `flex-start`.
- `cloudflare-worker.js` was not edited; Worker version remains exactly `10.56`.

## RED Evidence

- `node --test tests/ledger-carousel.test.mjs`: 3 of 8 tests failed before implementation. Failures proved missing inactive-pane inert state, stale same-date overview selection, and missing active-height CSS support.
- `node --test tests/brand-v11.7.test.mjs`: release fingerprint test failed because part 1 still used `11.6.0`; parts 3 and 4 were covered by the same exact version matrix.

## GREEN Evidence

- `node --test tests/ledger-carousel.test.mjs tests/brand-v11.7.test.mjs`: 16 of 16 tests passed.
- `node scripts/validate-release.mjs`: passed with `Release fingerprint is consistent: 11.7.1 (Worker 10.56)`.
- `npm test`: 65 of 65 tests passed.
- `git diff --check`: passed; output contained only Git's Windows LF-to-CRLF notices.
- `script.part3.js`: 29,976 bytes, below the 30,000-byte direct-publish limit.

## Browser Verification

- Local static server at `http://127.0.0.1:4173/`, viewport 390x844, visitor UI.
- Overview: active pane `scrollHeight` 223px; explicit track height 223px; carousel viewport height 225px. The inactive transaction pane remained 1001px tall but carried `inert` and did not inflate the track.
- Transaction page: explicit track height 1001px matched its active pane `scrollHeight`; carousel viewport height was 1003px. The horizontal slide remained active with transform matrix x offset `-315px`.
- Return to overview restored the 223px track height; overview was not inert and transactions was inert.
- Both visible ledger navigation tabs measured exactly 44px high with computed `min-height: 44px`; each was 156.5px wide.
- Network logs confirmed parts 1, 3, and 4 were requested with `?v=11.7.1`, while parts 2, 5, and 6 used `?v=11.6.0`.

## Files

- `brand-v11.7.css`
- `index.html`
- `script.part3.js`
- `scripts/validate-release.mjs`
- `service-worker.js`
- `tests/brand-v11.7.test.mjs`
- `tests/ledger-carousel.test.mjs`

## Remaining Browser Gaps

- The local static server does not provide `/api`, `/api/market-clock`, or `/api/quotes`; those requests returned 404 as expected for this setup. Ledger layout verification used the loaded local `data.json` visitor state.
- An authenticated administrator session was not exercised in this final wave. Admin five-dot layout was covered in the preceding fix round and remains protected by its structural CSS regression.
