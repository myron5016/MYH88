# 账本操作日历 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用不依赖行情服务的操作日历替换重复 KPI 的账本总览，并补齐全区滑动、资金总览标题与长期定投卡片排序。

**Architecture:** 在现有原生 HTML、CSS 和 JavaScript 架构中，将账本首页改为基于 `state.transactions` 和 `state.cashFlows` 派生的月份事件日历。日历渲染、月份导航和日期展开放在 `script.part3.js` 的账本切换函数附近；页面结构在 `index.html`，外观和移动布局在 `brand-v11.7.css`。不修改 `cloudflare-worker.js`、`data.json` 或行情刷新路径。

**Tech Stack:** 原生 HTML、CSS、JavaScript、Node.js 内置测试运行器、现有 `tests/*.test.mjs` VM harness。

## Global Constraints

- 不调用 Twelve、Finnhub 或其他行情接口；日历只读取本地账本状态。
- 不改变 `data.json` 格式、持仓成本、收益率、管理员登录、云端同步或 Worker 行情逻辑。
- 非管理员只可查看操作日历和交易流水；管理员原有批次、资金流水、备份入口继续存在。
- 页面使用中文可见文案；资金流入使用绿、资金流出使用红，颜色只表示现金方向。
- 桌面和移动端均支持整个账本内容区的左右页切换，但输入、按钮、弹窗和 `.table-wrap` 不触发页切换。
- 不新增第三方依赖。

---

## File Structure

- Modify: `index.html`，增加“资金总览”标题、替换账本首页 DOM、调整定投布局顺序并保留稳定 ID。
- Modify: `script.part3.js`，实现日历事件派生、月份状态、日历渲染、日期详情、全区手势边界和页签文案。
- Modify: `brand-v11.7.css`，实现日历网格、详情面板、无空白页码导航、桌面和移动端响应布局。
- Modify: `tests/ledger-carousel.test.mjs`，覆盖日历数据派生、默认页、月份切换、权限和全区手势。
- Modify: `tests/brand-v11.7.test.mjs`，验证资金总览标题、日历结构、无旧 KPI 总览以及定投 DOM 顺序。

## Task 1: 建立操作日历的数据契约

**Files:**
- Modify: `script.part3.js:106-166`
- Modify: `tests/ledger-carousel.test.mjs`

**Interfaces:**
- Consumes: `state.transactions`、`state.cashFlows`、`transactionLabel(transaction)`、`num(value)`、`round(value)`。
- Produces: `ledgerCalendarEvents(year, month)`，返回 `{ date, kind, title, amountUSD, note, direction }[]`；`ledgerCalendarMonth`，格式为 `{ year, month }`。

- [ ] **Step 1: 写失败测试**

```js
const events = harness.call("ledgerCalendarEvents", 2026, 8);
assert.deepEqual(events.map(({ date, kind, direction }) => [date, kind, direction]), [
  ["2026-08-03", "deposit", "in"],
  ["2026-08-05", "buy", "out"],
  ["2026-08-05", "sell", "in"],
  ["2026-08-08", "withdraw", "out"],
]);
assert.equal(events.find(event => event.kind === "buy").amountUSD, 501.25);
assert.equal(events.find(event => event.kind === "sell").amountUSD, 948.5);
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/ledger-carousel.test.mjs`

Expected: FAIL，提示 `ledgerCalendarEvents is not defined`。

- [ ] **Step 3: 实现最小派生函数**

```js
function ledgerCalendarEvents(year, month) {
  const prefix = `\${year}-\${String(month).padStart(2, "0")}-`;
  const trades = state.transactions.filter(t => !t.voided && String(t.date || "").startsWith(prefix) && ["buy", "sell"].includes(t.type))
    .map(t => ({ date:t.date, kind:t.type, title:`\${transactionLabel(t)} \${t.symbol || ""}`.trim(), amountUSD:round((t.type === "buy" ? -(num(t.shares) * num(t.price) + num(t.fee)) : num(t.shares) * num(t.price) - num(t.fee)) * num(t.fxRate || 1)), note:t.note || "", direction:t.type === "buy" ? "out" : "in" }));
  const cash = state.cashFlows.filter(flow => !flow.voided && String(flow.date || "").startsWith(prefix))
    .map(flow => ({ date:flow.date, kind:flow.type, title:flow.type === "withdraw" ? "提取本金" : "追加本金", amountUSD:round(flow.type === "withdraw" ? -num(flow.amountUSD) : num(flow.amountUSD)), note:flow.note || "", direction:flow.type === "withdraw" ? "out" : "in" }));
  return [...trades, ...cash].sort((a,b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/ledger-carousel.test.mjs`

Expected: PASS，覆盖事件方向、手续费和作废记录过滤。

- [ ] **Step 5: 提交**

```bash
git add script.part3.js tests/ledger-carousel.test.mjs
git commit -m "feat: derive ledger calendar events"
```

## Task 2: 将账本首页替换为操作日历

**Files:**
- Modify: `index.html:216-272`
- Modify: `script.part3.js:106-166`
- Modify: `tests/ledger-carousel.test.mjs`
- Modify: `tests/brand-v11.7.test.mjs`

**Interfaces:**
- Consumes: `ledgerCalendarEvents(year, month)`、`ledgerCalendarMonth`。
- Produces: `renderLedgerCalendar()`、`changeLedgerCalendarMonth(direction)`、`selectLedgerCalendarDate(date)`；DOM IDs `ledgerCalendarMonth`、`ledgerCalendarGrid`、`ledgerCalendarDetails`、`ledgerCalendarPrev`、`ledgerCalendarNext`。

- [ ] **Step 1: 写失败测试**

```js
assert.match(html, /data-ledger-page="overview"[^>]*>操作日历/);
assert.match(html, /id="ledgerCalendarGrid"/);
assert.match(html, /id="ledgerCalendarDetails"/);
assert.doesNotMatch(html, /ledgerOverviewPositionCount/);
harness.call("renderLedgerCalendar");
assert.match(harness.getElementById("ledgerCalendarGrid").innerHTML, /data-ledger-date="2026-08-05"/);
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/ledger-carousel.test.mjs tests/brand-v11.7.test.mjs`

Expected: FAIL，因为操作日历 DOM 和渲染函数尚不存在。

- [ ] **Step 3: 写入日历 DOM 和渲染函数**

```html
<section data-ledger-pane="overview" id="ledgerOverviewPane" class="ledger-page">
  <div class="ledger-calendar-head">
    <button id="ledgerCalendarPrev" type="button" onclick="changeLedgerCalendarMonth(-1)" aria-label="上个月">‹</button>
    <strong id="ledgerCalendarMonth"></strong>
    <button id="ledgerCalendarNext" type="button" onclick="changeLedgerCalendarMonth(1)" aria-label="下个月">›</button>
  </div>
  <div class="ledger-calendar-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
  <div id="ledgerCalendarGrid" class="ledger-calendar-grid"></div>
  <div id="ledgerCalendarDetails" class="ledger-calendar-details" aria-live="polite"></div>
</section>
```

```js
function selectLedgerCalendarDate(date) {
  activeLedgerCalendarDate = activeLedgerCalendarDate === date ? "" : date;
  renderLedgerCalendar();
}
function changeLedgerCalendarMonth(direction) {
  const current = new Date(ledgerCalendarMonth.year, ledgerCalendarMonth.month - 1 + direction, 1);
  const now = new Date();
  if (current > new Date(now.getFullYear(), now.getMonth(), 1)) return;
  ledgerCalendarMonth = { year:current.getFullYear(), month:current.getMonth() + 1 };
  activeLedgerCalendarDate = "";
  renderLedgerCalendar();
}
```

`renderLedgerCalendar()` 按周一开头生成 35 或 42 个日期格。事件格最多显示两条 `.ledger-calendar-event`，余项显示“另 N 笔”；选择后向 `#ledgerCalendarDetails` 写入当天完整事件。无事件月写入“本月尚无账本记录”。

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/ledger-carousel.test.mjs tests/brand-v11.7.test.mjs`

Expected: PASS，验证事件格、选择展开、未来月份禁用和旧 KPI 标识移除。

- [ ] **Step 5: 提交**

```bash
git add index.html script.part3.js tests/ledger-carousel.test.mjs tests/brand-v11.7.test.mjs
git commit -m "feat: replace ledger overview with operation calendar"
```

## Task 3: 重做分页控制和全区手势

**Files:**
- Modify: `index.html:216-272`
- Modify: `script.part3.js:115-166`
- Modify: `brand-v11.7.css:301-431`
- Modify: `tests/ledger-carousel.test.mjs`

**Interfaces:**
- Consumes: `allowedLedgerPages()`、`switchLedgerTab(page, options)`、`shiftLedgerPage(direction)`。
- Produces: `updateLedgerPager()`；`#ledgerPanel` 的全区手势注册；无 `data-ledger-dot` 页码按钮。

- [ ] **Step 1: 写失败测试**

```js
assert.doesNotMatch(html, /data-ledger-dot=/);
assert.match(html, /id="ledgerPagerStatus"/);
harness.call("initLedgerCarousel");
const panel = harness.getElementById("ledgerPanel");
assert.ok(panel.listeners.has("touchstart"));
assert.ok(panel.listeners.has("touchend"));
panel.dispatch("touchstart", touchEvent(plainTarget, 100, 20));
panel.dispatch("touchend", touchEvent(plainTarget, 20, 20));
assert.deepEqual(recordedShifts, [1]);
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/ledger-carousel.test.mjs`

Expected: FAIL，因为页码点仍存在且事件只绑定到旧轮播 viewport。

- [ ] **Step 3: 实现文字分页和全区手势**

```html
<div class="ledger-carousel-controls" aria-label="账本页切换">
  <button id="ledgerPagePrev" type="button" aria-label="上一页" onclick="shiftLedgerPage(-1)">‹</button>
  <span id="ledgerPagerStatus" aria-live="polite"></span>
  <button id="ledgerPageNext" type="button" aria-label="下一页" onclick="shiftLedgerPage(1)">›</button>
</div>
```

```js
function updateLedgerPager() {
  const pages = allowedLedgerPages(), index = Math.max(0, pages.indexOf(activeLedgerTab));
  $("ledgerPagerStatus").textContent = `\${index + 1} / \${pages.length}`;
  $("ledgerPagePrev").disabled = index === 0;
  $("ledgerPageNext").disabled = index === pages.length - 1;
}
function isLedgerGestureBlocked(target) {
  return Boolean(target?.closest?.(".table-wrap,input,select,button,dialog,a"));
}
```

在 `initLedgerCarousel()` 将触控、鼠标和键盘监听附加到 `#ledgerPanel`，保留 `#ledgerCarousel` 的 `ResizeObserver`。每次 `switchLedgerTab()` 后调用 `updateLedgerPager()`。横向手势至少 56px 且大于纵向距离。

- [ ] **Step 4: 完成紧凑控制器 CSS**

```css
.ledger-carousel-controls { display:grid; grid-template-columns:40px auto 40px; justify-content:end; gap:8px; }
.ledger-carousel-controls button:disabled { opacity:.35; cursor:not-allowed; }
.ledger-page-dots { display:none; }
@media (max-width:640px) { .ledger-carousel-controls { justify-content:center; } }
```

控制器不保留视觉空白页码框；移动端为一行紧凑控件。

- [ ] **Step 5: 运行测试，确认通过并提交**

Run: `node --test tests/ledger-carousel.test.mjs`

Expected: PASS，覆盖页签、按钮禁用、日历空白区和日期格手势、表格控件排除与键盘操作。

```bash
git add index.html script.part3.js brand-v11.7.css tests/ledger-carousel.test.mjs
git commit -m "feat: make ledger navigation explicit and swipeable"
```

## Task 4: 增加资金总览标题并重排定投名片

**Files:**
- Modify: `index.html:139-147,276-295`
- Modify: `brand-v11.7.css:257-301`
- Modify: `dca-v10.53.css`
- Modify: `tests/brand-v11.7.test.mjs`

**Interfaces:**
- Consumes: 现有 `#dcaFundGrid`、`.dca-progress-panel` 和 KPI `.kpis` DOM。
- Produces: `#fundOverview` 标题区和稳定的定投 CSS grid areas `funds`、`plan`。

- [ ] **Step 1: 写失败测试**

```js
assert.match(html, /id="fundOverview"[\\s\\S]*<h2>资金总览<\\/h2>/);
const layoutStart = html.indexOf('<div class="dca-layout">');
assert.ok(html.indexOf('id="dcaFundGrid"', layoutStart) < html.indexOf('class="dca-progress-panel"', layoutStart));
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/brand-v11.7.test.mjs`

Expected: FAIL，因为顶部无资金总览标题且定投计划位于基金名片之前。

- [ ] **Step 3: 调整结构与响应样式**

```html
<section id="fundOverview" class="section-title-block">
  <span class="section-kicker">FUND OVERVIEW</span>
  <h2>资金总览</h2>
  <p class="section-note">本金、资产与盈亏的实时概览</p>
</section>
<section class="kpis v117-kpi-deck">...</section>
```

将 `#dcaFundGrid` 置于 `.dca-progress-panel` 前。CSS 设定 `.dca-fund-grid { grid-area:funds; }` 和 `.dca-progress-panel { grid-area:plan; }`，移动端按同一顺序单列。不得变更 DCA 进度、收益和历史记录 ID 或计算函数。

- [ ] **Step 4: 运行测试，确认通过并提交**

Run: `node --test tests/brand-v11.7.test.mjs`

Expected: PASS，验证标题、基金名片优先和定投结构仍存在。

```bash
git add index.html brand-v11.7.css dca-v10.53.css tests/brand-v11.7.test.mjs
git commit -m "feat: refine fund overview and dca order"
```

## Task 5: 回归验证与发布准备

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-ledger-operation-calendar-design.md`，仅在实现与设计不一致时更新。

- [ ] **Step 1: 执行静态和完整测试**

```bash
git diff --check
npm test
```

Expected: 无 whitespace 错误，发布验证和全部 Node 测试通过。

- [ ] **Step 2: 进行视觉验证**

启动本地站点，验证 1440px 和 390px 宽度下：资金总览标题存在；账本首页为操作日历；空月无空白卡片；日期详情不溢出；页签、箭头与全区滑动可用；DCA 顺序为 VOO、QQQM、计划。

- [ ] **Step 3: 执行数据和权限回归检查**

非管理员 URL 不显示买、卖、编辑、作废和备份控制；`?admin=1` 可达批次、资金流水和备份页。检查 `git diff -- data.json cloudflare-worker.js` 输出为空。

- [ ] **Step 4: 提交最终验证记录**

```bash
git add docs/superpowers/specs/2026-08-15-ledger-operation-calendar-design.md
git commit -m "docs: verify ledger calendar release"
```
