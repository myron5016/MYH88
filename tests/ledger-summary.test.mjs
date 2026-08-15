import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

function createSummaryHarness(summarySource, { now = "2026-08-15T12:00:00+08:00" } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, { id, textContent: "", innerHTML: "", disabled: false });
    return elements.get(id);
  };
  const context = createContext({
    console,
    Date: class extends Date {
      constructor(value) { super(value === undefined ? now : value); }
      static now() { return new Date(now).getTime(); }
    },
    state: { transactions: [], cashFlows: [] },
    $: getElement,
    escapeHtml: (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])),
    money: (value) => `$${Number(value || 0).toFixed(2)}`,
    num: (value) => Number(value) || 0,
    round: (value, digits = 2) => Number(Number(value || 0).toFixed(digits)),
    transactionLabel: (transaction) => transaction.type === "buy" ? "买入" : "卖出",
    syncLedgerHeight() {},
  });
  runInContext(summarySource, context, { filename: "ledger-summary-v11.7.js" });
  return { context, getElement };
}

test("ledger summary aggregates the selected month and ignores voided records", async () => {
  const source = await read("ledger-summary-v11.7.js");
  const harness = createSummaryHarness(source);
  harness.context.state.transactions = [
    { id: "b1", type: "buy", symbol: "NVDA", date: "2026-08-05", shares: 2, price: 100, fee: 1, fxRate: 1.1 },
    { id: "s1", type: "sell", symbol: "GOOGL", date: "2026-08-14", shares: 3, price: 50, fee: 2, fxRate: 1, realizedPnlUSD: 20 },
    { id: "outside", type: "buy", symbol: "OLD", date: "2026-07-31", shares: 1, price: 99, fee: 0, fxRate: 1 },
    { id: "voided", type: "buy", symbol: "VOID", date: "2026-08-06", shares: 10, price: 999, fee: 0, fxRate: 1, voided: true },
  ];
  harness.context.state.cashFlows = [
    { id: "deposit", type: "deposit", date: "2026-08-02", amountUSD: 500 },
    { id: "withdraw", type: "withdraw", date: "2026-08-12", amountUSD: 25 },
    { id: "voided-cash", type: "deposit", date: "2026-08-13", amountUSD: 1000, voided: true },
  ];

  const result = harness.context.ledgerSummaryForMonth(2026, 8);
  assert.equal(result.buyUSD, 221.1);
  assert.equal(result.sellUSD, 148);
  assert.equal(result.depositUSD, 500);
  assert.equal(result.withdrawUSD, 25);
  assert.equal(result.realizedPnlUSD, 20);
  assert.equal(result.netCashUSD, 401.9);
  assert.deepEqual(result.recentTrades.map((trade) => trade.id), ["s1", "b1"]);
});

test("ledger summary exposes a focused render contract with current month controls", async () => {
  const [html, css, source] = await Promise.all([
    read("index.html"),
    read("brand-v11.7.css"),
    read("ledger-summary-v11.7.js"),
  ]);
  assert.match(html, />账本摘要</);
  for (const id of ["ledgerSummaryMonth", "ledgerSummaryGrid", "ledgerSummaryNet", "ledgerSummaryRecent"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.doesNotMatch(html, /ledgerCalendar/);
  assert.doesNotMatch(html, /操作日历/);
  assert.match(source, /function renderLedgerSummary\(/);
  assert.match(source, /function changeLedgerSummaryMonth\(/);
  assert.match(css, /\.ledger-summary-grid\s*\{/);
  assert.match(css, /\.ledger-summary-recent\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
});

test("ledger summary renders recent trades without including a second transaction table", async () => {
  const source = await read("ledger-summary-v11.7.js");
  const harness = createSummaryHarness(source);
  harness.context.state.transactions = [
    { id: "b1", type: "buy", symbol: "NVDA", name: "英伟达", date: "2026-08-05", shares: 2, price: 100, fee: 1, fxRate: 1 },
  ];
  harness.context.state.cashFlows = [];
  harness.context.renderLedgerSummary();
  assert.match(harness.getElement("ledgerSummaryMonth").textContent, /2026年8月/);
  assert.match(harness.getElement("ledgerSummaryGrid").innerHTML, /买入金额/);
  assert.match(harness.getElement("ledgerSummaryRecent").innerHTML, /NVDA/);
  assert.doesNotMatch(harness.getElement("ledgerSummaryRecent").innerHTML, /transactionBody/);
});
