import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildProviderPlan, quoteCacheKey } from "../cloudflare-worker.js";

test("Twelve 优先名单不受持仓原始顺序影响", () => {
  const symbols = ["NEW2", "MRVL", "NVDA", "NEW1", "RKLB", "SPCX", "GOOGL", "TSLA", "MU", "TSM"];
  const priority = ["NVDA", "RKLB", "SPCX", "GOOGL", "TSM", "TSLA", "MU", "MRVL"];
  const plan = buildProviderPlan(symbols, priority, 8);
  assert.deepEqual(plan.twelve, priority);
  assert.deepEqual(plan.finnhub, ["NEW2", "NEW1"]);
});

test("不足八只时由当前持仓补满 Twelve 名额", () => {
  const plan = buildProviderPlan(["B", "A", "C"], ["A"], 8);
  assert.deepEqual(plan.twelve, ["A", "B", "C"]);
  assert.deepEqual(plan.finnhub, []);
});

test("逐股缓存键与请求组合和顺序无关", () => {
  assert.equal(quoteCacheKey("NVDA", "live"), "quote:live:NVDA");
  assert.equal(quoteCacheKey("NVDA", "last-close", "2026-07-22"), "quote:last-close:2026-07-22:NVDA");
  assert.notEqual(quoteCacheKey("NVDA", "live"), quoteCacheKey("TSLA", "live"));
});

test("Worker 可直接命中单只股票缓存且不请求整套持仓", async () => {
  const now = Date.now();
  const records = new Map([
    ["config:portfolio-symbols", {
      cachedAt: now,
      body: JSON.stringify({ symbols: ["NVDA", "TSLA"] }),
    }],
    ["quote:live:NVDA", {
      cachedAt: now,
      source: "twelve",
      body: JSON.stringify({ symbol: "NVDA", close: "200", source: "twelve" }),
    }],
  ]);
  const env = {
    TWELVE_DATA_KEY: "configured-twelve-key",
    FINNHUB_API_KEY: "configured-finnhub-key",
    TWELVE_PRIORITY_SYMBOLS: "NVDA,TSLA",
    MYH88_CACHE: {
      async get(key) { return records.get(key) || null; },
      async put() {},
    },
    MYH88_QUOTE_LIMITER: { async limit() { return { success: true }; } },
  };
  const pending = [];
  const response = await worker.fetch(
    new Request("https://quote.myh88.com/quotes?symbols=NVDA"),
    env,
    { waitUntil(promise) { pending.push(promise); } },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-MYH88-Cache"), "HIT-KV-PER-SYMBOL");
  assert.deepEqual(await response.json(), {
    NVDA: { symbol: "NVDA", close: "200", source: "twelve" },
  });
  await Promise.all(pending);
});
