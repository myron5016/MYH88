import test from "node:test";
import assert from "node:assert/strict";

import worker, {
  VERIFIED_LOGO_OVERRIDES,
  logoProfileCacheKey,
  normalizeLogoProfile,
  validateLogoUrl,
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
  for (const logo of [
    "https://localhost/a.png",
    "https://user:pass@static.example.test/a.png",
    "https://static.example.test:444/a.png",
    "https://[::ffff:127.0.0.1]/a.png",
  ]) assert.equal(normalizeLogoProfile("BAD", { logo, marketCapitalization: 100 }).status, "missing", logo);
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

test("非法人工例外按 missing 缓存且不请求上游", async () => {
  VERIFIED_LOGO_OVERRIDES.TEST = {
    name: "Unsafe Test Company",
    upstreamUrl: "https://localhost/logo.png",
  };
  const { env, puts } = logoEnv(["TEST"]);
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("invalid override must not fetch"); };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/logos?symbols=TEST"), env, { waitUntil() {} });
    assert.deepEqual((await response.json()).logos.TEST, { symbol: "TEST", status: "missing", source: "finnhub" });
    assert.equal(puts[0].options.expirationTtl, 86400);
    assert.equal(fetchCount, 0);
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

test("Logo URL 只允许无凭据的公网 HTTPS 443 地址", () => {
  assert.equal(validateLogoUrl("https://static.example.test/logo.png").hostname, "static.example.test");
  assert.equal(validateLogoUrl("https://static.example.test:443/logo.png").port, "");
  for (const value of [
    "http://static.example.test/logo.png",
    "https://user:pass@static.example.test/logo.png",
    "https://static.example.test:444/logo.png",
    "https://localhost/logo.png",
    "https://assets.localhost/logo.png",
    "https://127.0.0.1/logo.png",
    "https://10.0.0.1/logo.png",
    "https://172.16.0.1/logo.png",
    "https://192.168.1.1/logo.png",
    "https://169.254.1.1/logo.png",
    "https://[::1]/logo.png",
    "https://[::ffff:127.0.0.1]/logo.png",
    "https://[::ffff:192.168.1.1]/logo.png",
    "not a url",
  ]) assert.equal(validateLogoUrl(value), null, value);
});

function imageProxyEnv(symbol, record) {
  return {
    MYH88_CACHE: {
      async get(key) { return key === logoProfileCacheKey(symbol) ? record : null; },
    },
  };
}

test("logo 路由只返回缓存记录指定的已验证图片", async () => {
  const record = {
    symbol: "BRK.B",
    status: "verified",
    source: "finnhub",
    name: "Berkshire Hathaway",
    upstreamUrl: "https://static.example.test/brkb.png",
  };
  const env = imageProxyEnv("BRK.B", record);
  const originalFetch = globalThis.fetch;
  let accept = "";
  globalThis.fetch = async (_url, init) => {
    accept = init.headers.Accept;
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png", "Content-Length": "4", ETag: '"logo-v1"' },
    });
  };
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/logo/BRK.B"), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("Content-Length"), "4");
    assert.equal(response.headers.get("ETag"), '"logo-v1"');
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(response.headers.get("Cache-Control"), /max-age=2592000/);
    assert.match(accept, /image\/avif/);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logo 路由允许连字符代码，拒绝缺失资料、路径穿越和编码斜杠", async () => {
  const env = imageProxyEnv("ABC-D", {
    symbol: "ABC-D",
    status: "verified",
    source: "finnhub",
    name: "ABC",
    upstreamUrl: "https://static.example.test/logo.webp",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/webp" } });
  try {
    assert.equal((await worker.fetch(new Request("https://quote.myh88.com/logo/ABC-D"), env, { waitUntil() {} })).status, 200);
    assert.equal((await worker.fetch(new Request("https://quote.myh88.com/logo/MISSING"), env, { waitUntil() {} })).status, 404);
    assert.equal((await worker.fetch(new Request("https://quote.myh88.com/logo/..%2FSECRET"), env, { waitUntil() {} })).status, 404);
    assert.equal((await worker.fetch(new Request("https://quote.myh88.com/logo/%2FSECRET"), env, { waitUntil() {} })).status, 404);
    assert.equal((await worker.fetch(new Request("https://quote.myh88.com/logo/../SECRET"), env, { waitUntil() {} })).status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logo 代理拒绝非图片、超大声明和超大实际正文", async () => {
  const env = imageProxyEnv("NVDA", {
    symbol: "NVDA",
    status: "verified",
    source: "finnhub",
    name: "NVIDIA",
    upstreamUrl: "https://static.example.test/nvda.png",
  });
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      new Response("not an image", { headers: { "Content-Type": "text/html" } }),
      new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png", "Content-Length": String(512 * 1024 + 1) } }),
      new Response(new Uint8Array(512 * 1024 + 1), { headers: { "Content-Type": "image/png", "Content-Length": "1" } }),
    ]) {
      globalThis.fetch = async () => response.clone();
      const result = await worker.fetch(new Request("https://quote.myh88.com/logo/NVDA"), env, { waitUntil() {} });
      assert.equal(result.status, 502);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logo 代理为 SVG 响应设置同源文档隔离策略", async () => {
  const env = imageProxyEnv("SVG", {
    symbol: "SVG",
    status: "verified",
    source: "finnhub",
    name: "SVG Company",
    upstreamUrl: "https://static.example.test/logo.svg",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', {
    headers: { "Content-Type": "image/svg+xml" },
  });
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/logo/SVG"), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Security-Policy") || "", /sandbox/);
    assert.match(response.headers.get("Content-Security-Policy") || "", /default-src 'none'/);
    assert.match(response.headers.get("Content-Security-Policy") || "", /script-src 'none'/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logo 代理拒绝缓存中的非法上游地址和 missing 记录", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("invalid records must not fetch"); };
  try {
    for (const record of [
      { symbol: "NVDA", status: "missing", source: "finnhub" },
      { symbol: "NVDA", status: "verified", source: "finnhub", upstreamUrl: "https://127.0.0.1/logo.png" },
    ]) {
      const response = await worker.fetch(
        new Request("https://quote.myh88.com/logo/NVDA"),
        imageProxyEnv("NVDA", record),
        { waitUntil() {} },
      );
      assert.equal(response.status, 404);
    }
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
