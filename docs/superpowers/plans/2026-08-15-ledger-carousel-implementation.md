# Ledger Carousel and Admin Lot Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicated public holdings table by turning the Dream Fund ledger into a swipeable overview/history area whose lot-management page is visible only to administrators.

**Architecture:** Keep the existing state, holding aggregation, quote, transaction, and backup code unchanged. Replace the ledger tab/pane shell with an ordered carousel controlled by a small permission-aware controller in `script.part3.js`; render the overview from existing state in `script.part4.js`, and add responsive presentation in `brand-v11.7.css`.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js built-in test runner.

## Global Constraints

- Do not modify quote proxy, cache, refresh, cost-basis, P&L, transaction, cash-flow, backup, or GitHub synchronization algorithms.
- The public position table remains the only public current-holdings table.
- Visitor pages are `overview` and `transactions`.
- Administrator pages are `overview`, `transactions`, `positions`, `cashflows`, and `backup`.
- All users land on `overview` when the ledger initializes.
- Touch swiping and mouse/keyboard controls must coexist with horizontal table scrolling.

---

### Task 1: Lock the ledger information architecture with release tests

**Files:**
- Create: `tests/ledger-carousel.test.mjs`
- Modify: `scripts/validate-release.mjs`

**Interfaces:**
- Consumes: `index.html`, `script.part3.js`, `script.part4.js`, `brand-v11.7.css` as text fixtures.
- Produces: CI assertions for page order, permissions, controls, and the single public holdings-table rule.

- [ ] **Step 1: Write the failing structural test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("ledger opens on overview and exposes lot management only to admins", async () => {
  const [html, controller] = await Promise.all([read("index.html"), read("script.part3.js")]);
  assert.match(html, /data-ledger-page="overview"/);
  assert.match(html, /data-ledger-page="positions"[^>]*admin-only/);
  assert.match(html, />持仓批次管理</);
  assert.match(controller, /const PUBLIC_LEDGER_PAGES=\["overview","transactions"\]/);
  assert.match(controller, /activeLedgerTab="overview"/);
});

test("only one holdings table is public", async () => {
  const html = await read("index.html");
  assert.equal((html.match(/id="mapHoldingBody"/g) || []).length, 1);
  assert.match(html, /id="positionsPane"[^>]*admin-only/);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `node --test tests/ledger-carousel.test.mjs`

Expected: FAIL because the overview page and permission-aware carousel do not exist yet.

- [ ] **Step 3: Add release fingerprint assertions**

Add assertions to `scripts/validate-release.mjs` for `ledgerCarousel`, `ledgerOverviewPane`, `持仓批次管理`, and the admin-only positions page.

- [ ] **Step 4: Commit the red test**

```powershell
git add tests/ledger-carousel.test.mjs scripts/validate-release.mjs
git commit -m "test: define ledger carousel permissions"
```

### Task 2: Build the overview-first permission-aware ledger carousel

**Files:**
- Modify: `index.html:205-254`
- Modify: `script.part3.js:87-104`
- Modify: `script.part4.js:131-137`

**Interfaces:**
- Consumes: existing globals `state`, `isAdminMode`, `activeLedgerTab`, `$`, `money`, and `escapeHtml`.
- Produces: `PUBLIC_LEDGER_PAGES`, `ADMIN_LEDGER_PAGES`, `allowedLedgerPages()`, `switchLedgerTab(page, options)`, `shiftLedgerPage(direction)`, `renderLedgerOverview()`, and `initLedgerCarousel()`.

- [ ] **Step 1: Replace ledger tabs with carousel navigation and pages**

Create an `overview` page containing `ledgerOverviewPositionCount`, `ledgerOverviewTransactionCount`, `ledgerOverviewRealizedPnl`, and `ledgerOverviewLatestTrade`. Keep existing tables intact, but mark `positionsPane`, its navigation control, `cashflowsPane`, and `backupPane` with `admin-only hidden`. Add previous/next icon buttons and page dots with accessible labels.

- [ ] **Step 2: Implement page permissions and navigation**

```js
const PUBLIC_LEDGER_PAGES=["overview","transactions"];
const ADMIN_LEDGER_PAGES=["overview","transactions","positions","cashflows","backup"];
let activeLedgerTab="overview";
function allowedLedgerPages(){return isAdminMode?ADMIN_LEDGER_PAGES:PUBLIC_LEDGER_PAGES}
function shiftLedgerPage(direction){
  const pages=allowedLedgerPages(),index=Math.max(0,pages.indexOf(activeLedgerTab));
  switchLedgerTab(pages[Math.min(pages.length-1,Math.max(0,index+direction))]);
}
```

`switchLedgerTab` must reject unauthorized page names by returning to `overview`, update `aria-current`, translate the carousel track, and render backups only when the active page is `backup`.

- [ ] **Step 3: Render the non-duplicative overview**

`renderLedgerOverview()` must show summary values only: current holding count, transaction count, accumulated non-voided realized P&L, and the latest non-voided transaction label/date. It must not list individual holdings.

- [ ] **Step 4: Add guarded touch, mouse, and keyboard navigation**

Initialize swipe handling on the carousel viewport. Ignore gestures originating inside `.table-wrap`, `input`, `select`, `button`, or `dialog`; change page only when horizontal travel is at least 56 pixels and exceeds vertical travel. Support `ArrowLeft` and `ArrowRight` while the carousel has focus.

- [ ] **Step 5: Reset inaccessible pages after admin state changes**

Call `initLedgerCarousel()` once during initialization. After `initAdminMode()`, if `activeLedgerTab` is not allowed, switch to `overview`. Call `renderLedgerOverview()` from `renderAll()` before updating carousel position.

- [ ] **Step 6: Run the structural test**

Run: `node --test tests/ledger-carousel.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit the functional change**

```powershell
git add index.html script.part3.js script.part4.js
git commit -m "feat: add permission-aware ledger carousel"
```

### Task 3: Style and verify desktop/mobile behavior

**Files:**
- Modify: `brand-v11.7.css`
- Modify: `tests/ledger-carousel.test.mjs`
- Modify: `build-meta.json`
- Modify: `package.json`
- Modify: `service-worker.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: carousel classes introduced in Task 2.
- Produces: responsive carousel layout, visible page state, motion-reduction fallback, and release `11.7.1`.

- [ ] **Step 1: Add failing CSS assertions**

Assert that `brand-v11.7.css` defines `.ledger-carousel-viewport`, `.ledger-carousel-track`, `.ledger-page`, `.ledger-page-dot`, a mobile media query, and `prefers-reduced-motion` handling.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/ledger-carousel.test.mjs`

Expected: FAIL on missing carousel styling.

- [ ] **Step 3: Implement responsive carousel styling**

Use a fixed 100% page track, `overflow: hidden` on the viewport, and `transform` transitions on the track. Keep cards at 8px radius or less, provide 44px touch targets for controls, preserve internal `.table-wrap { overflow-x: auto; }`, and disable transitions under `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Bump only frontend release fingerprints to 11.7.1**

Update `build-meta.json`, `package.json`, `service-worker.js`, and asset query strings in `index.html`. Do not change the Worker version or Worker source.

- [ ] **Step 5: Run complete automated verification**

Run: `npm test`

Expected: all validation and Node tests PASS.

- [ ] **Step 6: Verify in a local browser**

Run the existing local static server, then check desktop 1440×900 and mobile 390×844:

- Visitor: overview opens first; only overview and transactions are reachable.
- Administrator: all five pages are reachable; positions page is titled “持仓批次管理”.
- Transaction table scrolls horizontally without changing ledger page.
- Swipe, buttons, dots, and keyboard arrows select the same active page.
- Quote values, holding quantities, costs, P&L, and transaction rows remain unchanged.

- [ ] **Step 7: Commit the verified release**

```powershell
git add brand-v11.7.css tests/ledger-carousel.test.mjs build-meta.json package.json service-worker.js index.html scripts/validate-release.mjs
git commit -m "release: ship v11.7.1 ledger carousel"
```
