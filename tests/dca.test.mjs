import test from "node:test";
import assert from "node:assert/strict";

await import("../myh88-core.js");
const { computeDcaPlan, computeLedgerMetrics } = globalThis.MYH88Core;

const plan = {
  monthlyBudgetUSD: 500,
  funds: [
    { symbol: "VOO", targetWeight: 0.6, price: 708.51000975 },
    { symbol: "QQQM", targetWeight: 0.4, price: 294.3200073 },
  ],
  entries: [
    { date: "2026-06-05", type: "buy", symbol: "VOO", plannedAmountUSD: 300, shares: 0.4374, costBasisUSD: 300.2985424654 },
    { date: "2026-06-05", type: "buy", symbol: "QQQM", plannedAmountUSD: 200, shares: 0.6732, costBasisUSD: 200.3373571344 },
    { date: "2026-06-29", type: "reinvest", symbol: "QQQM", plannedAmountUSD: 0, shares: 0.0005, costBasisUSD: 0.14756262, countsTowardPlan: false },
    { date: "2026-07-01", type: "reinvest", symbol: "VOO", plannedAmountUSD: 0, shares: 0.0008, costBasisUSD: 0.54713916, countsTowardPlan: false },
    { date: "2026-07-07", type: "buy", symbol: "VOO", plannedAmountUSD: 300, shares: 0.4359, costBasisUSD: 300.29313574 },
    { date: "2026-07-07", type: "buy", symbol: "QQQM", plannedAmountUSD: 200, shares: 0.6831, costBasisUSD: 200.34841392 },
  ],
};

test("IBKR 初始定投持仓与收益计算准确", () => {
  const result = computeDcaPlan(plan, "2026-08-06");
  assert.ok(Math.abs(result.funds.find((fund) => fund.symbol === "VOO").shares - 0.8741) < 1e-9);
  assert.ok(Math.abs(result.funds.find((fund) => fund.symbol === "QQQM").shares - 1.3568) < 1e-9);
  assert.ok(Math.abs(result.totalCostUSD - 1001.97215104) < 0.001);
  assert.ok(Math.abs(result.marketValueUSD - 1018.64198542) < 0.001);
  assert.ok(Math.abs(result.pnlUSD - 16.66983438) < 0.002);
});

test("8月尚未买入时显示 0/500 且连续完成两期", () => {
  const result = computeDcaPlan(plan, "2026-08-06");
  assert.equal(result.monthlyInvestedUSD, 0);
  assert.equal(result.monthlyProgressPct, 0);
  assert.deepEqual(result.completedMonths, ["2026-06", "2026-07"]);
  assert.equal(result.consecutiveMonths, 2);
});

test("定投计划不改变梦想金库主账本指标", () => {
  const main = { cashFlows: [{ type: "deposit", amountUSD: 22370 }], transactions: [], positions: [] };
  const before = computeLedgerMetrics(main);
  const after = computeLedgerMetrics({ ...main, dcaPlan: plan });
  assert.deepEqual(after, before);
});
