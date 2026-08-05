import test from "node:test";
import assert from "node:assert/strict";

await import("../myh88-core.js");
const { allocateLotSale, createLot, lotsBeforeTransaction, summarizeLots } = globalThis.MYH88Core;

const buy = (id, date, shares, price, fee) => ({
  id, date, type: "buy", symbol: "TEST", shares, price, fee, fxRate: 1,
  costBasisUSD: shares * price + fee,
});

test("GOOGL 指定高成本 9 股后剩余批次均价为 335.07", () => {
  const transactions = [
    buy("g350", "2026-06-22", 1, 350, 0.34916025),
    buy("g342", "2026-06-25", 1, 342, 0.34986025),
    buy("g346", "2026-07-23", 5, 346, 0.34477225),
    buy("g345", "2026-07-23", 2, 345, 0.34666325),
    buy("g340", "2026-07-23", 5, 340, 0.34477225),
    buy("g330", "2026-07-23", 5, 330, 0.34127225),
  ];
  const lots = transactions.map((item, index) => createLot(item, index));
  const result = allocateLotSale(lots, 9, "specific", [
    { buyTransactionId: "g350", shares: 1 },
    { buyTransactionId: "g342", shares: 1 },
    { buyTransactionId: "g346", shares: 5 },
    { buyTransactionId: "g345", shares: 2 },
  ]);
  assert.ok(Math.abs(result.costBasisUSD - 3113.39045575) < 1e-6);
  assert.ok(Math.abs(result.remaining.avgCostNative - 335.0686044) < 1e-6);
  assert.equal(result.remaining.shares, 10);
});

test("MU 卖出 1110 高成本批次后保留 1080 批次", () => {
  const lots = [
    createLot(buy("mu1110", "2026-06-29", 1, 1110, 0.34916025), 0),
    createLot(buy("mu1080", "2026-07-01", 1, 1080, 0.34916025), 1),
  ];
  const result = allocateLotSale(lots, 1, "specific", [{ buyTransactionId: "mu1110", shares: 1 }]);
  assert.ok(Math.abs(result.costBasisUSD - 1110.34916025) < 1e-6);
  assert.ok(Math.abs(result.remaining.avgCostNative - 1080.34916025) < 1e-6);
  assert.equal(result.remaining.lots[0].buyTransactionId, "mu1080");
});

test("旧卖出没有批次信息时保持历史平均成本口径", () => {
  const lots = [
    createLot(buy("high", "2026-06-29", 1, 1110, 0.35), 0),
    createLot(buy("low", "2026-07-01", 1, 1080, 0.35), 1),
  ];
  const result = allocateLotSale(lots, 1, "average");
  assert.ok(Math.abs(result.costBasisUSD - 1095.35) < 1e-8);
  assert.ok(Math.abs(result.remaining.avgCostNative - 1095.35) < 1e-8);
});

test("历史回放会在目标卖出前返回当时可用批次", () => {
  const transactions = [
    buy("first", "2026-01-01", 2, 100, 0),
    { id: "sell", date: "2026-02-01", type: "sell", symbol: "TEST", shares: 1, price: 120, fee: 0, fxRate: 1 },
    buy("later", "2026-03-01", 1, 90, 0),
  ];
  const lots = lotsBeforeTransaction(transactions, "sell", "TEST");
  const summary = summarizeLots(lots);
  assert.equal(summary.shares, 2);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].buyTransactionId, "first");
});

test("指定批次数量不完整会拒绝记账", () => {
  const lots = [createLot(buy("only", "2026-01-01", 2, 100, 0), 0)];
  assert.throws(() => allocateLotSale(lots, 2, "specific", [{ buyTransactionId: "only", shares: 1 }]), /must equal/);
});

test("自动选择保存后按具体批次冻结，不会被后续规则重排", () => {
  const transactions = [
    buy("older", "2026-01-01", 1, 100, 0),
    buy("newer", "2026-02-01", 1, 200, 0),
    {
      id: "frozen-sale", date: "2026-03-01", type: "sell", symbol: "TEST", shares: 1, price: 220,
      fee: 0, fxRate: 1, lotMethod: "highest",
      lotAllocations: [{ buyTransactionId: "older", shares: 1 }],
    },
  ];
  const lots = lotsBeforeTransaction(transactions, "", "TEST");
  assert.equal(lots.length, 1);
  assert.equal(lots[0].buyTransactionId, "newer");
});
