import test from "node:test";
import assert from "node:assert/strict";

await import("../myh88-core.js");
const { buildReturnSeries, computeLedgerMetrics } = globalThis.MYH88Core;

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

test("收益率曲线剔除追加本金影响", () => {
  const series = buildReturnSeries([
    { date: "2026-06-30", capital: 15000, netAsset: 16500 },
    { date: "2026-07-10", capital: 22370, netAsset: 25570 },
  ], "all");
  assert.equal(series.points.length, 2);
  assert.ok(Math.abs(series.points[0].returnPct - 10) < 1e-9);
  assert.ok(Math.abs(series.returnPct - 21.333333333333325) < 1e-9);
  assert.equal(series.pnlUSD, 3200);
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
});
