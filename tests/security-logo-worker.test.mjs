import test from "node:test";
import assert from "node:assert/strict";

import worker, {
  VERIFIED_LOGO_OVERRIDES,
  logoProfileCacheKey,
  normalizeLogoProfile,
} from "../cloudflare-worker.js";

function portfolioRecord(symbols) {
  return { cachedAt: Date.now(), body: JSON.stringify({ symbols }) };
}

function logoEnv(symbols, records = new Map()) {
  records.set("config:portfolio-symbols:v3", portfolioRecord(symbols));
  const puts = [];
  return {
    records,
    puts,
    env: {
      FINNHUB_API_KEY: "server-secret",
      MYH88_CACHE: {
        async get(key) { return records.get(key) || null; },
        async put(key, value, options) {
          const parsed = JSON.parse(value);
          puts.push({ key, value: parsed, options });
          records.set(key, parsed);
        },
      },
    },
  };
}

test("只把具有运营公司证据的 HTTPS Finnhub Logo 规范化为已验证记录", () => {
  assert.deepEqual(normalizeLogoProfile("NVDA", {
    name: "NVIDIA Corp",
    logo: "https://static.example.test/nvda.png",
    marketCapitalization: 100,
  }), {
    symbol: "NVDA",
    status: "verified",
    source: "finnhub",
    name: "NVIDIA Corp",
    upstreamUrl: "https://static.example.test/nvda.png",
  });
  assert.equal(normalizeLogoProfile("MSTU", { name: "MSTU", logo: "" }).status, "missing");
  assert.equal(normalizeLogoProfile("MSTU", {
    name: "T-Rex 2X Long MSTR Daily Target ETF",
    logo: "https://issuer.example.test/logo.png",
    marketCapitalization: 0,
    finnhubIndustry: "",
    ipo: "",
  }).status, "missing");
  assert.equal(normalizeLogoProfile("BAD", {
    logo: "http://example.test/a.png",
    marketCapitalization: 100,
  }).status, "missing");
  assert.equal(normalizeLogoProfile("IPO", {
    name: "IPO Co",
    logo: "https://static.example.test/ipo.svg",
    ipo: "2020-01-01",
    finnhubIndustry: "Technology",
  }).status, "verified");
  assert.equal(logoProfileCacheKey("nvda"), "logo:profile:v1:NVDA");
});

test("logos 路由分别缓存已验证和受抑制的缺失资料，且不泄露密钥或上游地址", async () => {
  const { env, puts } = logoEnv(["NVDA", "MSTU"]);
  const originalFetch = globalThis.fetch;
  const fetches = [];
  globalThis.fetch = async (url) => {
    fetches.push(String(url));
    return new Response(JSON.stringify({
      name: "NVIDIA Corp",
      logo: "https://static.example.test/nvda.png",
      marketCapitalization: 100,
    }));
  };
  try {
    const response = await worker.fetch(
      new Request("https://quote.myh88.com/logos?symbols=NVDA,MSTU"),
      env,
      { waitUntil() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { logos: {
      NVDA: { symbol: "NVDA", status: "verified", source: "finnhub", name: "NVIDIA Corp", path: "/logo/NVDA" },
      MSTU: { symbol: "MSTU", status: "missing", source: "finnhub" },
    } });
    assert.equal(fetches.length, 1);
    assert.match(fetches[0], /stock\/profile2\?symbol=NVDA&token=server-secret/);
    assert.deepEqual(puts.map((item) => item.options.expirationTtl).sort((a, b) => a - b), [86400, 2592000]);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /server-secret|upstreamUrl|static\.example\.test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logos 路由拒绝空请求和超过 24 个代码的批量", async () => {
  const symbols = Array.from({ length: 25 }, (_, index) => `T${index}`);
  const { env } = logoEnv(symbols);
  const empty = await worker.fetch(new Request("https://quote.myh88.com/logos?symbols="), env, { waitUntil() {} });
  assert.equal(empty.status, 400);
  const oversized = await worker.fetch(new Request(`https://quote.myh88.com/logos?symbols=${symbols.join(",")}`), env, { waitUntil() {} });
  assert.equal(oversized.status, 400);
});

test("重复代码只请求一次 Finnhub，缓存命中时不请求上游", async () => {
  const cached = {
    symbol: "NVDA",
    status: "verified",
    source: "finnhub",
    name: "NVIDIA Corp",
    upstreamUrl: "https://static.example.test/nvda.png",
    cachedAt: Date.now(),
  };
  const records = new Map([[logoProfileCacheKey("NVDA"), cached]]);
  const { env } = logoEnv(["NVDA"], records);
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("cache hit must not fetch"); };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/logos?symbols=nvda,NVDA"), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(fetchCount, 0);
    assert.equal((await response.json()).logos.NVDA.path, "/logo/NVDA");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("经审核例外不请求 Finnhub", async () => {
  VERIFIED_LOGO_OVERRIDES.TEST = {
    name: "Test Company",
    upstreamUrl: "https://official.example.test/logo.png",
  };
  const { env } = logoEnv(["TEST"]);
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("override must not fetch"); };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/logos?symbols=TEST"), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(fetchCount, 0);
    assert.deepEqual((await response.json()).logos.TEST, {
      symbol: "TEST",
      status: "verified",
      source: "override",
      name: "Test Company",
      path: "/logo/TEST",
    });
  } finally {
    delete VERIFIED_LOGO_OVERRIDES.TEST;
    globalThis.fetch = originalFetch;
  }
});

test("未保存代码保持缺失回退且不消耗 Finnhub", async () => {
  const { env, puts } = logoEnv(["NVDA"]);
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("unsaved symbol must not fetch"); };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/logos?symbols=FUTURE"), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).logos.FUTURE, {
      symbol: "FUTURE",
      status: "missing",
      source: "finnhub",
    });
    assert.equal(fetchCount, 0);
    assert.equal(puts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
