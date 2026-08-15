# Task 3 Fix Round 1 Report

## Fix Commit

- `5d4afdb fix: complete v11.7.1 carousel release`

## Findings Addressed

- Updated the frontend fallback in `script.part1.js` to `VERSION="V11.7.1 果园生长版"` and `RELEASE="11.7.1"`.
- Strengthened `scripts/validate-release.mjs` to require both fallback constants at `11.7.1`. Worker validation still reads `10.56`; `cloudflare-worker.js` was not edited.
- Redesigned the mobile carousel controls into a two-row grid: dots span the full first row and the two 44px arrows occupy centered cells on the second row. All control radii remain 8px or less.
- Replaced the loose mobile CSS assertion with a brace-aware media-block extractor. The test verifies the relevant rules belong to the ledger-owned `@media (max-width: 700px)` block and requires the full-width five-dot row plus dedicated arrow cells.

## RED/GREEN Evidence

- RED: `node --test tests/ledger-carousel.test.mjs` failed because the existing mobile block lacked the two-row grid, full-width dot row, and arrow placements.
- RED: `node --test tests/brand-v11.7.test.mjs` failed because `script.part1.js` still declared `V11.7.0` and `11.7.0`.
- GREEN: `node --test tests/ledger-carousel.test.mjs` passed 6 of 6 tests.
- GREEN: `npm test` passed 63 of 63 tests; release validation reported `11.7.1 (Worker 10.56)`.
- GREEN: `git diff --check` completed without whitespace errors.

## Browser Measurements

- Local static server: `http://127.0.0.1:4173/`.
- Visitor at 390x844: controls width 317px; 4 visible controls, each 44x44px; overlap `false`. Dot row y=4150.64; arrow row y=4202.64.
- Visitor at 320x844: controls width 247px; 4 visible controls, each 44x44px; overlap `false`. Dot row y=4243.16; arrow row y=4295.16.
- Administrator session was unavailable. An isolated five-admin-dot fixture was attempted at the measured 247px mobile control width, but browser URL policy blocked the data-URL fixture. It is recorded as unavailable, not as a passed browser check. The CSS contract proves the five 44px dots use a standalone full-width row; their 220px total width leaves 27px within the measured 247px control width, and arrows occupy a separate 44px second row.

## Scope

- Changed only `brand-v11.7.css`, `script.part1.js`, `scripts/validate-release.mjs`, `tests/brand-v11.7.test.mjs`, and `tests/ledger-carousel.test.mjs`.
- Quote, cache, refresh, cost basis, P&L, transaction, cash, backup, GitHub synchronization, and Worker source remain unchanged.
