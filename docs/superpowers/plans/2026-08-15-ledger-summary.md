# 账本摘要 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用低密度操作日历替换为可读的账本摘要，展示本月交易与资金变化，同时保留完整流水和现有权限边界。

**Architecture:** 在现有账本页的 overview pane 内渲染摘要结构，新增一个聚合函数从 `state.transactions` 与 `state.cashFlows` 生成本月指标和最近操作。摘要逻辑放在独立前端脚本中，页面脚本只负责调用；现有交易流水和管理员页面不改数据口径。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js 内置测试、现有 service worker 缓存清单。

## Global Constraints

- 只读取现有 `state.transactions` 和 `state.cashFlows`，不改 `data.json`、`cloudflare-worker.js` 或行情刷新逻辑。
- 作废记录不参与摘要；定投记录不进入梦想金库主账本摘要。
- 沿用现有 `money`、`round`、`num`、`escapeHtml`、`transactionLabel` 等工具函数。
- 保持公开用户与管理员现有账本页面权限边界。
- 所有手动编辑使用 `apply_patch`，不新增第三方依赖。

---

### Task 1: Add failing aggregation tests

**Files:**
- Create: `tests/ledger-summary.test.mjs`
- Read: `script.part3.js`, `script.part4.js`, `ledger-calendar-v11.7.js`

**Interfaces:**
- Produces tests for `ledgerSummaryForMonth(year, month)` and `renderLedgerSummary()`.
- The aggregation result must expose `buyUSD`, `sellUSD`, `depositUSD`, `withdrawUSD`, `realizedPnlUSD`, `netCashUSD`, `recentTrades`.

- [ ] **Step 1: Write the failing test**

Create a VM harness using the same script-loading pattern as `tests/ledger-carousel.test.mjs`. Seed valid and voided buy/sell/cash-flow records plus a separate DCA record. Assert that only valid records in the requested month are included, buy/sell amounts apply fee and `fxRate`, realized P&L only sums sells, and recent trades are newest first with a maximum of five.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/ledger-summary.test.mjs`

Expected: FAIL because the summary functions and summary DOM are not implemented.

### Task 2: Implement summary data and markup

**Files:**
- Create: `ledger-summary-v11.7.js`
- Modify: `index.html`
- Modify: `script.part3.js`
- Modify: `script.part4.js`
- Modify: `service-worker.js`

**Interfaces:**
- `ledgerSummaryForMonth(year, month)` returns the aggregation object defined in Task 1.
- `renderLedgerSummary()` updates `ledgerSummaryMonth`, `ledgerSummaryGrid`, `ledgerSummaryNet`, and `ledgerSummaryRecent`.
- `changeLedgerSummaryMonth(direction)` changes the displayed month without requesting quotes and prevents navigation into future months.

- [ ] **Step 1: Add the summary pane markup**

Replace the overview pane’s calendar controls/grid/details with a summary header, four metric slots, a net cash summary, and a recent-operations list. Keep the existing `data-ledger-pane="overview"` and pager IDs so the carousel and permissions remain compatible. Change the visible first tab label to `账本摘要`.

- [ ] **Step 2: Implement the aggregation function**

In `ledger-summary-v11.7.js`, filter non-voided transactions and cash flows by `YYYY-MM-` prefix. Compute buy/sell USD values using shares, price, fee and fxRate; compute principal inflows/outflows from cash flows; sum sell `realizedPnlUSD`; calculate `netCashUSD`; sort valid buy/sell transactions descending by date and retain five.

- [ ] **Step 3: Implement rendering and month navigation**

Render escaped symbols, labels, notes, dates and amounts through existing helpers. Show `暂无本月操作` when the recent list is empty and `本月暂无记录` when all metrics are zero. Call `renderLedgerSummary()` from carousel initialization and `renderAll()`. Add the new file to the app shell and network-first runtime list.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/ledger-summary.test.mjs tests/ledger-carousel.test.mjs`

Expected: PASS with the summary tests and existing ledger tests green.

### Task 3: Style desktop and mobile summary

**Files:**
- Modify: `brand-v11.7.css`
- Modify: `tests/ledger-summary.test.mjs`

**Interfaces:**
- CSS classes: `.ledger-summary-head`, `.ledger-summary-grid`, `.ledger-summary-metric`, `.ledger-summary-net`, `.ledger-summary-recent`, `.ledger-summary-row`.

- [ ] **Step 1: Add CSS contract assertions**

Assert the stylesheet defines a desktop four-column summary grid, a two-column mobile grid, readable list rows, and no old calendar grid dependency in the overview pane.

- [ ] **Step 2: Add the responsive styles**

Use existing white/green variables and border language. Use four columns above 900px, two columns below 680px, and compact rows that wrap on narrow screens. Keep pager controls compact and remove calendar-specific styles that no longer have consumers.

- [ ] **Step 3: Run focused tests**

Run: `node --test tests/ledger-summary.test.mjs tests/ledger-carousel.test.mjs`

Expected: PASS with no CSS contract failures.

### Task 4: Regression and release verification

**Files:**
- Modify: `tests/brand-v11.7.test.mjs` only if the new summary chunk reference needs a structural assertion.

- [ ] **Step 1: Add regression coverage**

Assert `index.html` and `service-worker.js` reference the summary runtime chunk, and assert the summary source does not reference price endpoints or DCA state.

- [ ] **Step 2: Run the full suite**

Run: `npm test`

Expected: release fingerprint is consistent, Worker remains 10.56, and all tests pass with zero failures.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check`, `git status --short`, and `git diff --name-only`. Confirm only ledger summary UI, tests, CSS, HTML, service-worker shell references and the new summary script changed; confirm `data.json` and `cloudflare-worker.js` are absent.

- [ ] **Step 4: Commit the implementation**

Run:

```powershell
git add index.html script.part3.js script.part4.js ledger-summary-v11.7.js brand-v11.7.css service-worker.js tests/ledger-summary.test.mjs tests/brand-v11.7.test.mjs
git commit -m "feat: replace ledger calendar with summary"
```
