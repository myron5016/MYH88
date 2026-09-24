import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

await import("../myh88-core.js");
const core = globalThis.MYH88Core;
const source = await Promise.all(["script.part1.js", "script.part3.js", "script.part4.js", "script.part5.js", "ledger-summary-v11.7.js"].map(f => readFile(new URL(`../${f}`, import.meta.url), "utf8")));
const trade = (type, shares, price, extra = {}) => ({ id: `${type}-${Math.random()}`, type, shares, price, symbol: "TQQQ", currency: "USD", fxRate: 1, fee: 1, date: "2026-09-25", schemaVersion: "11.7.4", ...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

function harness(transactions = []) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: "", innerHTML: "", textContent: "", classList: { toggle() {}, remove() {} }, addEventListener() {}, querySelector() { return { textContent: "" }; } });
    return elements.get(id);
  };
  let counter = 0;
  const ctx = createContext({
    MYH88Core: core, state: { positions: [], transactions, cashFlows: [{ type: "deposit", date: "2026-01-01", amountUSD: 10000 }], fxRates: { USD: 1 } },
    $, document: { addEventListener() {}, querySelectorAll() { return []; } }, structuredClone, console,
    num: v => Number(v) || 0, round: (n, d=2) => Number(Number(n).toFixed(d)), uid: () => `id-${++counter}`, fx: () => 1,
    inferSector: () => "ETF", validColor: c => c || "#ffffff", sectorBaseColor: () => "#ffffff", autoColorForPosition: () => "#ffffff",
    applyAutoTaxonomy() {}, colorForSectorMember: () => "#ffffff", tradeColorAuto: false, tradeSectorAuto: false,
    money: n => `$${n}`, cls: n => n >= 0 ? "positive" : "negative", escapeHtml: s => String(s),
    isAdminMode: true, alert() {}, createBackup() {}, captureSnapshot() {}, markDirty() {}, renderAll() {}, switchLedgerTab() {}, saveLocal() {},
  });
  const normalizePosition = source[0].slice(source[0].indexOf("function normalizePosition("), source[0].indexOf("function migrateV8("));
  runInContext(normalizePosition + source[1] + source[3] + source[4], ctx);
  return { ctx, $, rebuild: tx => ctx.rebuildCurrentPositionsFromTransactions(tx || ctx.state.transactions) };
}

test("开空100股后股数、市值为负，现金收入扣除手续费，价格下跌盈利", () => {
  const h = harness([trade("short", 100, 50)]); h.rebuild();
  const p = h.ctx.state.positions[0];
  assert.equal(p.shares, -100); assert.equal(p.costBasisUSD, -4999); assert.equal(p.avgCost, 49.99);
  p.price = 45;
  const m = core.computeLedgerMetrics(h.ctx.state);
  assert.equal(m.cashBalance, 14999); assert.equal(m.marketTotal, -4500); assert.equal(m.netAsset, 10499);
  assert.equal(m.floatingPnl, 499); assert.ok(m.floatingReturn > 0);
  p.price = 55; assert.equal(core.computeLedgerMetrics(h.ctx.state).floatingPnl, -501);
});

test("部分平空、全部平空，双边手续费正确计入现金与已实现盈亏", () => {
  const h = harness([trade("short", 100, 50), trade("cover", 40, 45)]); h.rebuild();
  assert.equal(h.ctx.state.positions[0].shares, -60);
  close(h.ctx.state.positions[0].costBasisUSD, -2999.4);
  close(h.ctx.state.transactions[1].realizedPnlUSD, 198.6);
  close(core.computeLedgerMetrics(h.ctx.state).cashBalance, 13198);
  h.rebuild([...h.ctx.state.transactions, trade("cover", 60, 40)]);
  assert.equal(h.ctx.state.positions.length, 0);
  close(core.computeLedgerMetrics(h.ctx.state).realizedPnl, 797);
  close(core.computeLedgerMetrics(h.ctx.state).cashBalance, 10797);
});

test("平空支持指定开空批次", () => {
  const h = harness([trade("short", 40, 50, { id: "first" }), trade("short", 60, 60, { id: "second" }), trade("cover", 60, 40, { lotMethod: "specific", lotAllocations: [{ buyTransactionId: "second", shares: 60 }] })]);
  h.rebuild(); assert.equal(h.ctx.state.positions[0].shares, -40);
  close(h.ctx.state.transactions[2].realizedPnlUSD, 1198);
  close(h.ctx.state.positions[0].costBasisUSD, -1999);
});

test("平空使用交易汇率而非当前汇率", () => {
  const h = harness([trade("short", 100, 50, { currency: "EUR", fxRate: 1.1 }), trade("cover", 100, 45, { currency: "EUR", fxRate: 1.2 })]);
  h.rebuild(); close(h.ctx.state.transactions[1].realizedPnlUSD, 97.7);
});

test("禁止跨零、反向开仓、无仓平仓与负数数量", () => {
  for (const [transactions, pattern] of [
    [[trade("buy", 30, 50), trade("sell", 100, 60)], /超过/],
    [[trade("short", 30, 50), trade("cover", 100, 40)], /超过/],
    [[trade("buy", 30, 50), trade("short", 10, 50)], /先平/],
    [[trade("short", 30, 50), trade("buy", 10, 50)], /先平/],
    [[trade("short", 30, 50), trade("sell", 10, 50)], /先平/],
    [[trade("cover", 1, 50)], /超过/],
    [[trade("sell", 1, 50)], /超过/],
    [[trade("short", -100, 50)], /incomplete/],
  ]) assert.throws(() => harness(transactions).rebuild(), pattern);
});

test("平仓后可以用独立交易转换方向", () => {
  const h = harness([trade("short", 10, 50), trade("cover", 10, 45), trade("buy", 20, 40)]); h.rebuild();
  assert.equal(h.ctx.state.positions[0].shares, 20);
  close(h.ctx.state.positions[0].costBasisUSD, 801);
});

test("保存再载入和重复回放不会丢失空头或重复扣除手续费", () => {
  const h = harness([trade("short", 100, 50), trade("cover", 40, 45)]); h.rebuild();
  const saved = JSON.parse(JSON.stringify(h.ctx.state));
  const reloaded = harness(saved.transactions); reloaded.ctx.state = saved; reloaded.rebuild();
  const after = core.computeLedgerMetrics(reloaded.ctx.state);
  assert.equal(reloaded.ctx.state.positions[0].shares, -60);
  close(after.cashBalance, 13198); close(after.realizedPnl, 198.6);
});

test("历史快照包含空头负市值和平空盈亏", () => {
  const h = harness([trade("short", 100, 50, { date: "2026-09-20" }), trade("cover", 40, 45)]); h.rebuild();
  const before = core.buildHistoricalSnapshot(h.ctx.state, "2026-09-21", { TQQQ: 45 });
  assert.equal(before.positions[0].shares, -100); close(before.snapshot.netAsset, 10499);
  const after = core.buildHistoricalSnapshot(h.ctx.state, "2026-09-25", { TQQQ: 45 });
  assert.equal(after.positions[0].shares, -60); close(after.snapshot.netAsset, 10498);
});

test("月度摘要统计做空收入、平空支出和已实现收益", () => {
  const h = harness([trade("short", 100, 50), trade("cover", 40, 45)]); h.rebuild();
  const summary = h.ctx.ledgerSummaryForMonth(2026, 9);
  assert.equal(summary.sellUSD, 4999); assert.equal(summary.buyUSD, 1801);
  assert.equal(summary.netCashUSD, 3198); assert.equal(summary.realizedPnlUSD, 198.6);
});

test("交易表单允许正数做空，编辑时清除旧成本以重新计算", () => {
  const h = harness();
  const values = { tradeType: "short", tradeSymbol: "TQQQ", tradeDate: "2026-09-25", tradeShares: "100", tradePrice: "50", tradeCurrency: "USD", tradeFx: "1", tradeFee: "1", tradeSource: "manual", tradeName: "TQQQ" };
  for (const [id,value] of Object.entries(values)) h.$(id).value = value;
  const draft = h.ctx.tradeFormDraft({ costBasisUSD: 99, costBasisNative: 99 });
  assert.equal(draft.type, "short"); assert.equal(draft.shares, 100); assert.equal(draft.costBasisUSD, undefined);
  h.rebuild([draft]); assert.equal(h.ctx.state.positions[0].costBasisUSD, -4999);
  h.$("tradeEditId").value = draft.id; h.$("tradePrice").value = "60";
  h.rebuild([h.ctx.tradeFormDraft(h.ctx.state.transactions[0])]);
  assert.equal(h.ctx.state.positions[0].costBasisUSD, -5999);
});

test("平空表单默认FIFO可提交，日期前移不能使用未来批次", () => {
  const h = harness([trade("short", 100, 50)]); h.rebuild();
  const values = { tradeType: "cover", tradeSymbol: "TQQQ", tradeDate: "2026-09-26", tradeShares: "100", tradePrice: "45", tradeCurrency: "USD", tradeFx: "1", tradeFee: "1", tradeLotMethod: "fifo" };
  for (const [id,value] of Object.entries(values)) h.$(id).value = value;
  const draft = h.ctx.tradeFormDraft(); assert.equal(draft.lotAllocations.length, 1);
  h.ctx.renderTradeLotPanel(); assert.match(h.$("tradePreview").innerHTML, /-100 → 0/);
  h.$("tradeDate").value = "2026-09-24";
  assert.throws(() => h.ctx.tradeFormDraft(), /超过/);
});

test("迁移前历史卖出继续保留，现有五股不会再扣减", () => {
  const h = harness([
    trade("opening", 5, 325.04, { symbol: "MRVL", date: "2026-06-21", fee: 0, schemaVersion: "10.48" }),
    trade("sell", 4, 315, { symbol: "MRVL", date: "2026-06-19", migration: true, costBasisUSD: 1300.16, schemaVersion: "10.48" }),
  ]); h.rebuild();
  assert.equal(h.ctx.state.positions[0].shares, 5);
  assert.equal(core.summarizeLots(core.lotsBeforeTransaction(h.ctx.state.transactions, "", "MRVL")).shares, 5);
});
