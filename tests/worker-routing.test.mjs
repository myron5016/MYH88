import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildProviderPlan, portfolioSymbolsFromData, quoteCacheKey } from "../cloudflare-worker.js";

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
  assert.equal(quoteCacheKey("NVDA", "historical-close", "2026-08-03"), "quote:historical:2026-08-03:NVDA");
  assert.notEqual(quoteCacheKey("NVDA", "live"), quoteCacheKey("TSLA", "live"));
});

test("portfolio allowlist includes recurring investment funds", () => {
  const symbols = portfolioSymbolsFromData({
    positions: [
      { symbol: "NVDA", source: "twelve" },
      { symbol: "XFAB", source: "manual" },
    ],
    transactions: [
      { symbol: "SPCX", source: "twelve" },
      { symbol: "VOID", source: "twelve", voided: true },
    ],
    dcaPlan: {
      funds: [
        { symbol: "VOO", source: "twelve" },
        { symbol: "QQQM", source: "twelve" },
      ],
    },
  });
  assert.deepEqual(symbols, ["NVDA", "SPCX", "VOO", "QQQM"]);
});

test("market-hours cache older than five minutes refreshes one symbol", async () => {
  const now = Date.now();
  const records = new Map([
    ["config:portfolio-symbols:v3", { cachedAt: now, body: JSON.stringify({ symbols: ["SPCH"] }) }],
    ["quote:live:SPCH", {
      cachedAt: now - 6 * 60 * 1000,
      source: "twelve",
      body: JSON.stringify({ symbol: "SPCH", close: "9.88", timestamp: Math.floor((now - 6 * 60 * 1000) / 1000), source: "twelve" }),
    }],
  ]);
  const env = {
    TWELVE_DATA_KEY: "configured-twelve-key",
    FINNHUB_API_KEY: "configured-finnhub-key",
    TWELVE_PRIORITY_SYMBOLS: "SPCH",
    MYH88_CACHE: {
      async get(key) { return records.get(key) || null; },
      async put() {},
    },
    MYH88_QUOTE_LIMITER: { async limit() { return { success: true }; } },
  };
  const pending = [];
  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async (url) => {
    providerRequests += 1;
    assert.match(String(url), /twelvedata\.com/);
    return new Response(JSON.stringify({ SPCH: { symbol: "SPCH", close: "9.39", timestamp: Math.floor(now / 1000) } }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/quotes?symbols=SPCH"), env, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(providerRequests, 1);
    assert.equal((await response.json()).SPCH.close, "9.39");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await Promise.all(pending);
});

test("Worker 可直接命中单只股票缓存且不请求整套持仓", async () => {
  const now = Date.now();
  const records = new Map([
    ["config:portfolio-symbols:v3", {
      cachedAt: now,
      body: JSON.stringify({ symbols: ["NVDA", "TSLA"] }),
    }],
    ["quote:live:NVDA", {
      cachedAt: now,
      source: "twelve",
      body: JSON.stringify({ symbol: "NVDA", close: "200", timestamp: Math.floor(now / 1000), source: "twelve" }),
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
  assert.equal(response.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate, max-age=0");
  assert.deepEqual(await response.json(), {
    NVDA: { symbol: "NVDA", close: "200", timestamp: Math.floor(now / 1000), source: "twelve" },
  });
  await Promise.all(pending);
});

test("过旧实时报价不会被当成新鲜缓存继续延长", async () => {
  const now = Date.now();
  const records = new Map([
    ["config:portfolio-symbols:v3", { cachedAt: now, body: JSON.stringify({ symbols: ["SPCH"] }) }],
    ["quote:live:SPCH", {
      cachedAt: now - 31 * 60 * 1000,
      source: "twelve",
      body: JSON.stringify({ symbol: "SPCH", close: "9.38", timestamp: Math.floor((now - 60 * 60 * 1000) / 1000), source: "twelve" }),
    }],
  ]);
  const env = {
    TWELVE_DATA_KEY: "configured-twelve-key",
    FINNHUB_API_KEY: "configured-finnhub-key",
    TWELVE_PRIORITY_SYMBOLS: "SPCH",
    MYH88_CACHE: {
      async get(key) { return records.get(key) || null; },
      async put() {},
    },
    MYH88_QUOTE_LIMITER: { async limit() { return { success: true }; } },
  };
  const pending = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /twelvedata\.com/);
    return new Response(JSON.stringify({ SPCH: { symbol: "SPCH", close: "9.5", timestamp: Math.floor((now - 60 * 60 * 1000) / 1000) } }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/quotes?symbols=SPCH"), env, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("X-MYH88-Warnings") || "", /old|fallback/i);
    assert.equal(response.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate, max-age=0");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await Promise.all(pending);
});

test("Twelve 暂时不可用时，旧缓存的新票仍会切到 Finnhub", async () => {
  const now = Date.now();
  const records = new Map([
    ["config:portfolio-symbols:v3", { cachedAt: now, body: JSON.stringify({ symbols: ["SSPC"] }) }],
    ["provider:twelve:backoff", { cachedAt: now, body: JSON.stringify({ until: now + 60_000, message: "Twelve temporarily backed off" }) }],
    ["quote:live:SSPC", {
      cachedAt: now - 6 * 60 * 1000,
      source: "twelve",
      body: JSON.stringify({ symbol: "SSPC", close: "10.01", timestamp: Math.floor((now - 24 * 60 * 60 * 1000) / 1000), source: "twelve" }),
    }],
  ]);
  const env = {
    TWELVE_DATA_KEY: "configured-twelve-key",
    FINNHUB_API_KEY: "configured-finnhub-key",
    TWELVE_PRIORITY_SYMBOLS: "SSPC",
    MYH88_CACHE: {
      async get(key) { return records.get(key) || null; },
      async put() {},
    },
    MYH88_QUOTE_LIMITER: { async limit() { return { success: true }; } },
  };
  const pending = [];
  const originalFetch = globalThis.fetch;
  let finnhubRequests = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    assert.match(target, /finnhub\.io\/api\/v1\/quote/);
    finnhubRequests += 1;
    return new Response(JSON.stringify({ c: 10.71, pc: 10.01, t: Math.floor(now / 1000), o: 10.2, h: 10.8, l: 10.1 }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/quotes?symbols=SSPC"), env, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(response.status, 200);
    assert.equal(finnhubRequests, 1);
    assert.equal((await response.json()).SSPC.close, "10.71");
    assert.equal(response.headers.get("X-MYH88-Source"), "finnhub");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await Promise.all(pending);
});

test("没有逐股缓存记录时仍能请求 Provider", async () => {
  const now = Date.now();
  const records = new Map([
    ["config:portfolio-symbols:v3", { cachedAt: now, body: JSON.stringify({ symbols: ["SPCH"] }) }],
  ]);
  const env = {
    TWELVE_DATA_KEY: "configured-twelve-key",
    FINNHUB_API_KEY: "configured-finnhub-key",
    TWELVE_PRIORITY_SYMBOLS: "SPCH",
    MYH88_CACHE: {
      async get(key) { return records.get(key) || null; },
      async put() {},
    },
    MYH88_QUOTE_LIMITER: { async limit() { return { success: true }; } },
  };
  const pending = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /twelvedata\.com/);
    return new Response(JSON.stringify({ SPCH: { symbol: "SPCH", close: "9.67", timestamp: Math.floor(now / 1000) } }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/quotes?symbols=SPCH"), env, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-MYH88-Source"), "twelve");
    assert.deepEqual((await response.json()).SPCH.close, "9.67");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await Promise.all(pending);
});

test("只读行情请求即使缓存过期也不会直接消耗上游额度", async () => {
  const now = Date.now();
  const records = new Map([
    ["config:portfolio-symbols:v3", { cachedAt: now, body: JSON.stringify({ symbols: ["SPCH"] }) }],
    ["quote:live:SPCH", {
      cachedAt: now - 30 * 60 * 1000,
      source: "twelve",
      body: JSON.stringify({ symbol: "SPCH", close: "9.88", timestamp: Math.floor((now - 30 * 60 * 1000) / 1000), source: "twelve" }),
    }],
  ]);
  const env = {
    TWELVE_DATA_KEY: "configured-twelve-key",
    FINNHUB_API_KEY: "configured-finnhub-key",
    TWELVE_PRIORITY_SYMBOLS: "SPCH",
    MYH88_CACHE: {
      async get(key) { return records.get(key) || null; },
      async put() {},
    },
    MYH88_QUOTE_LIMITER: { async limit() { return { success: true }; } },
  };
  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error("cache-only request must not call a provider");
  };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/quotes?symbols=SPCH&cache=only"), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(providerRequests, 0);
    assert.equal(response.headers.get("X-MYH88-Cache"), "CACHE-ONLY-STALE");
    assert.equal((await response.json()).SPCH.close, "9.88");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("定时刷新只抓当前持仓和定投，不浪费额度刷新历史已卖出股票", async () => {
  const writes = new Map();
  let writeCount = 0;
  const env = {
    TWELVE_DATA_KEY: "configured-twelve-key",
    FINNHUB_API_KEY: "configured-finnhub-key",
    TWELVE_PRIORITY_SYMBOLS: "NVDA,VOO",
    MYH88_CACHE: {
      async get(key) { return writes.get(key) || null; },
      async put(key, value) { writeCount += 1; writes.set(key, JSON.parse(value)); },
    },
  };
  const originalFetch = globalThis.fetch;
  const providerSymbols = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    if (target.hostname === "myh88.com") {
      return new Response(JSON.stringify({
        positions: [
          { symbol: "NVDA", source: "twelve" },
          { symbol: "XFAB", source: "manual" },
        ],
        transactions: [{ symbol: "SOLD", source: "twelve" }],
        dcaPlan: { funds: [{ symbol: "VOO", source: "twelve" }] },
      }), { status: 200 });
    }
    if (target.hostname === "api.twelvedata.com") {
      const symbols = target.searchParams.get("symbol").split(",");
      providerSymbols.push(...symbols);
      return new Response(JSON.stringify(Object.fromEntries(symbols.map((symbol) => [symbol, {
        symbol,
        close: symbol === "NVDA" ? "225" : "714",
        timestamp: Math.floor(Date.parse("2026-08-20T14:35:00Z") / 1000),
      }]))), { status: 200 });
    }
    throw new Error(`unexpected request: ${target}`);
  };
  try {
    await worker.scheduled({ scheduledTime: Date.parse("2026-08-20T14:35:00Z"), cron: "*/5 * * * *" }, env, { waitUntil() {} });
    assert.deepEqual(providerSymbols.sort(), ["NVDA", "VOO"]);
    assert.equal(writeCount, 1);
    const bundle = writes.get("quotes:scheduled:current:v1");
    assert.equal(bundle.quotes.NVDA.close, "225");
    assert.equal(bundle.quotes.VOO.close, "714");
    assert.equal(writes.has("quote:live:SOLD"), false);
    assert.equal(writes.has("quote:live:XFAB"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Twelve 返回旧的新标的且 Finnhub 限流时由腾讯行情救援", async () => {
  const writes = new Map();
  const env = {
    TWELVE_DATA_KEY: "configured-twelve-key",
    FINNHUB_API_KEY: "configured-finnhub-key",
    TWELVE_PRIORITY_SYMBOLS: "SSPC",
    MYH88_CACHE: {
      async get(key) { return writes.get(key) || null; },
      async put(key, value) { writes.set(key, JSON.parse(value)); },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    if (target.hostname === "myh88.com") {
      return new Response(JSON.stringify({ positions: [{ symbol: "SSPC", source: "twelve" }] }), { status: 200 });
    }
    if (target.hostname === "api.twelvedata.com") {
      return new Response(JSON.stringify({
        symbol: "SSPC",
        close: "10.93",
        timestamp: Math.floor(Date.parse("2026-08-19T20:00:00Z") / 1000),
      }), { status: 200 });
    }
    if (target.hostname === "finnhub.io") {
      return new Response("429 Too Many Requests", { status: 429 });
    }
    if (target.hostname === "qt.gtimg.cn") {
      const fields = Array(50).fill("");
      Object.assign(fields, { 0: "200", 1: "2X Short SpaceX", 2: "SSPC.AM", 3: "12.05", 4: "10.93", 5: "11.30", 30: "2099-08-20 11:12:59", 31: "1.12", 32: "10.25", 33: "12.10", 34: "11.23", 35: "USD" });
      return new Response(`v_usSSPC="${fields.join("~")}";`, { status: 200 });
    }
    throw new Error(`unexpected request: ${target}`);
  };
  try {
    const summary = await worker.scheduled({ scheduledTime: Date.parse("2026-08-20T15:13:00Z"), cron: "*/5 * * * *" }, env, { waitUntil() {} });
    assert.equal(summary.updated, 1);
    assert.equal(summary.source, "tencent");
    const cached = writes.get("quotes:scheduled:current:v1");
    const quote = cached.quotes.SSPC;
    assert.equal(quote.close, "12.05");
    assert.equal(quote.source, "tencent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("休市时定时任务不写 KV", async () => {
  let writeCount = 0;
  const env = {
    MYH88_CACHE: {
      async get() { return null; },
      async put() { writeCount += 1; },
    },
  };
  const summary = await worker.scheduled(
    { scheduledTime: Date.parse("2026-08-22T15:00:00Z"), cron: "*/5 * * * *" },
    env,
    { waitUntil() {} },
  );
  assert.equal(summary.status, "skipped");
  assert.equal(writeCount, 0);
});

test("只读行情一次读取整包 KV，不按股票数量放大", async () => {
  const now = Date.now();
  let readCount = 0;
  const bundle = {
    cachedAt: now,
    summary: { status: "ok", checkedAt: new Date(now).toISOString(), requested: 2, updated: 2 },
    quotes: {
      NVDA: { symbol: "NVDA", close: "225", timestamp: Math.floor(now / 1000), source: "twelve" },
      VOO: { symbol: "VOO", close: "714", timestamp: Math.floor(now / 1000), source: "twelve" },
    },
  };
  const env = {
    TWELVE_PRIORITY_SYMBOLS: "NVDA,VOO",
    MYH88_CACHE: {
      async get(key) {
        readCount += 1;
        if (key === "config:portfolio-symbols:v3") return { cachedAt: now, body: JSON.stringify({ symbols: ["NVDA", "VOO"] }) };
        if (key === "quotes:scheduled:current:v1") return bundle;
        return null;
      },
      async put() {},
    },
  };
  const response = await worker.fetch(
    new Request("https://quote.myh88.com/quotes?symbols=NVDA,VOO&cache=only"),
    env,
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.equal(readCount, 2);
  assert.deepEqual(await response.json(), bundle.quotes);
});
