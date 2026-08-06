import test from "node:test";
import assert from "node:assert/strict";

await import("../myh88-core.js");
const { buildHistoricalSnapshot, buildReturnSeries, computeLedgerMetrics } = globalThis.MYH88Core;

test("追加本金不会被算成投资收益", () => {
  const metrics = computeLedgerMetrics({
    fxRates: { USD: 1 },
    cashFlows: [
      { type: "deposit", amountUSD: 15000 },
      { type: "deposit", amountUSD: 7370 },
    ],
    transactions: [],
    positions: [
      { symbol: "NVDA", shares: 10, price: 110, currency: "USD", costBasisUSD: 1000 },
    ],
  });
  assert.equal(metrics.contributedCapital, 22370);
  assert.equal(metrics.currentCost, 1000);
  assert.equal(metrics.marketTotal, 1100);
  assert.equal(metrics.cashBalance, 21370);
  assert.equal(metrics.netAsset, 22470);
  assert.equal(metrics.totalPnl, 100);
});

test("卖出盈利进入现金并保留在总资产中", () => {
  const metrics = computeLedgerMetrics({
    fxRates: { USD: 1 },
    cashFlows: [{ type: "deposit", amountUSD: 15000 }],
    transactions: [{ type: "sell", realizedPnlUSD: 250 }],
    positions: [{ shares: 5, price: 900, currency: "USD", costBasisUSD: 4000 }],
  });
  assert.equal(metrics.realizedPnl, 250);
  assert.equal(metrics.cashBalance, 11250);
  assert.equal(metrics.netAsset, 15750);
  assert.equal(metrics.totalPnl, 750);
});

test("外币市值使用手动汇率且作废流水不参与计算", () => {
  const metrics = computeLedgerMetrics({
    fxRates: { USD: 1, EUR: 1.14 },
    cashFlows: [
      { type: "deposit", amountUSD: 10000 },
      { type: "withdraw", amountUSD: 1000 },
      { type: "deposit", amountUSD: 9999, voided: true },
    ],
    transactions: [{ type: "sell", realizedPnlUSD: 999, voided: true }],
    positions: [{ shares: 10, price: 20, currency: "EUR", costBasisUSD: 200 }],
  });
  assert.equal(metrics.contributedCapital, 9000);
  assert.ok(Math.abs(metrics.marketTotal - 228) < 1e-9);
  assert.ok(Math.abs(metrics.totalPnl - 28) < 1e-9);
});

test("累计收益率按累计盈亏除以累计投入本金", () => {
  const series = buildReturnSeries([
    { date: "2026-06-30", capital: 15000, netAsset: 16500 },
    { date: "2026-07-10", capital: 22370, netAsset: 25570 },
  ], "all");
  assert.equal(series.points.length, 2);
  assert.ok(Math.abs(series.points[0].returnPct - 10) < 1e-9);
  assert.ok(Math.abs(series.returnPct - 14.30487259722843) < 1e-9);
  assert.equal(series.pnlUSD, 3200);
});

test("按网站流水与历史收盘价重建指定交易日净值", () => {
  const built = buildHistoricalSnapshot({
    fxRates: { USD: 1, EUR: 1.15 },
    cashFlows: [{ date: "2026-07-10", type: "deposit", amountUSD: 10000 }],
    transactions: [
      { id: "a", date: "2026-07-20", type: "buy", symbol: "AAA", shares: 10, price: 100, fxRate: 1, feeUSD: 0, costBasisUSD: 1000, costBasisNative: 1000, source: "twelve" },
      { id: "b", date: "2026-08-03", type: "sell", symbol: "AAA", shares: 2, price: 120, fxRate: 1, feeUSD: 0, realizedPnlUSD: 40, source: "twelve" },
      { id: "c", date: "2026-08-05", type: "buy", symbol: "BBB", shares: 1, price: 50, fxRate: 1, feeUSD: 0, costBasisUSD: 50, costBasisNative: 50, source: "twelve" },
    ],
    positions: [{ symbol: "AAA", source: "twelve", currency: "USD" }],
  }, "2026-08-03", { AAA: { close: 125 } });
  assert.equal(built.complete, true);
  assert.equal(built.positions.length, 1);
  assert.equal(built.positions[0].shares, 8);
  assert.equal(built.snapshot.capital, 10000);
  assert.equal(built.snapshot.cash, 9240);
  assert.equal(built.snapshot.market, 1000);
  assert.equal(built.snapshot.netAsset, 10240);
  assert.equal(built.snapshot.openingBaseline, true);
});

test("本月收益率以上月最后快照作为比较基准", () => {
  const series = buildReturnSeries([
    { date: "2026-07-31", capital: 10000, netAsset: 11000 },
    { date: "2026-08-05", capital: 10000, netAsset: 10780 },
    { date: "2026-08-06", capital: 10000, netAsset: 11220 },
  ], "month");
  assert.deepEqual(series.points.map((point) => point.date), ["2026-07-31", "2026-08-05", "2026-08-06"]);
  assert.equal(series.points[0].returnPct, 0);
  assert.equal(series.points[0].baseline, true);
  assert.ok(Math.abs(series.returnPct - 2) < 1e-9);
  assert.equal(series.pnlUSD, 220);
  assert.equal(series.baselineDate, "2026-07-31");
  assert.equal(series.baselineComplete, true);
});

test("本月不会把距离月初太久的旧快照当成基准", () => {
  const series = buildReturnSeries([
    { date: "2026-07-23", capital: 22370, netAsset: 20086.31 },
    { date: "2026-08-05", capital: 22370, netAsset: 22479.99 },
    { date: "2026-08-06", capital: 22370, netAsset: 21058.75 },
  ], "month");
  assert.deepEqual(series.points.map((point) => point.date), ["2026-08-05", "2026-08-06"]);
  assert.equal(series.points[0].returnPct, 0);
  assert.equal(series.baselineDate, "");
  assert.equal(series.baselineComplete, false);
  assert.equal(series.periodStart, "2026-08-01");
  assert.equal(series.dataStart, "2026-08-05");
  assert.ok(Math.abs(series.returnPct - (-6.322244805269051)) < 1e-9);
  assert.ok(Math.abs(series.pnlUSD - (-1421.24)) < 1e-9);
});

test("月初重建快照作为当月收盘基准", () => {
  const series = buildReturnSeries([
    { date: "2026-07-23", capital: 22370, netAsset: 20086.31 },
    { date: "2026-08-03", capital: 22370, netAsset: 21500, openingBaseline: true },
    { date: "2026-08-06", capital: 22370, netAsset: 21058.75 },
  ], "month");
  assert.deepEqual(series.points.map((point) => point.date), ["2026-08-03", "2026-08-06"]);
  assert.equal(series.baselineDate, "2026-08-03");
  assert.equal(series.baselineComplete, true);
  assert.ok(Math.abs(series.returnPct - (21058.75 / 21500 - 1) * 100) < 1e-9);
});
