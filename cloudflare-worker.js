const CACHE_SECONDS = 30 * 60;
const STALE_SECONDS = 6 * 60 * 60;
const TWELVE_DISABLED = false;
const TWELVE_BASE = "https://api.twelvedata.com";
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeSymbols(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);
}

function responseFromCached(record, cacheLabel) {
  return new Response(record.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": record.contentType || "application/json; charset=utf-8",
      "X-MYH88-Cache": cacheLabel,
      "X-MYH88-Cached-At": String(record.cachedAt || ""),
    },
  });
}

async function readSharedCache(env, key) {
  if (!env.MYH88_CACHE) return null;
  return env.MYH88_CACHE.get(key, { type: "json" }).catch(() => null);
}

async function writeSharedCache(env, key, response) {
  if (!env.MYH88_CACHE || !response.ok) return;
  const body = await response.clone().text();
  await env.MYH88_CACHE.put(
    key,
    JSON.stringify({
      cachedAt: Date.now(),
      contentType: response.headers.get("Content-Type") || "application/json; charset=utf-8",
      body,
    }),
    { expirationTtl: CACHE_SECONDS + STALE_SECONDS }
  ).catch(() => {});
}

function jsonResponse(data, cacheLabel = "MISS") {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "X-MYH88-Cache": cacheLabel,
    },
  });
}

async function fetchJsonUpstream(url) {
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });
  const data = await response.clone().json().catch(() => ({}));
  if (!response.ok || data.code || data.status === "error") {
    throw new Error(data.message || `Upstream error ${response.status}`);
  }
  return data;
}

function normalizeYahooQuote(symbol, result) {
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close.filter((v) => Number(v) > 0) : [];
  const close = Number(meta.regularMarketPrice || closes.at(-1) || meta.previousClose || 0);
  const previous = Number(meta.previousClose || close || 0);
  const change = close && previous ? close - previous : 0;
  const percent = previous ? (change / previous) * 100 : 0;
  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    currency: meta.currency || "USD",
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    datetime: new Date(Number(meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
    timestamp: Number(meta.regularMarketTime || Date.now() / 1000),
    open: String(meta.regularMarketOpen || close),
    high: String(meta.regularMarketDayHigh || close),
    low: String(meta.regularMarketDayLow || close),
    close: String(close),
    previous_close: String(previous),
    change: String(change),
    percent_change: String(percent),
    is_market_open: Boolean(meta.currentTradingPeriod?.regular),
    source: "yahoo",
  };
}

async function fetchYahooQuotes(symbols) {
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      const url = new URL(`${YAHOO_BASE}/${encodeURIComponent(symbol)}`);
      url.searchParams.set("interval", "1m");
      url.searchParams.set("range", "1d");
      const data = await fetchJsonUpstream(url);
      const result = data.chart?.result?.[0];
      if (!result) throw new Error(`Yahoo quote missing for ${symbol}`);
      return [symbol, normalizeYahooQuote(symbol, result)];
    })
  );
  const quotes = Object.fromEntries(entries);
  return symbols.length === 1 ? quotes[symbols[0]] : quotes;
}

async function fetchTwelveQuotes(symbols, apiKey) {
  if (TWELVE_DISABLED) throw new Error("Twelve Data upstream disabled");
  const url = new URL(`${TWELVE_BASE}/quote`);
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("apikey", apiKey);
  return fetchJsonUpstream(url);
}

async function fetchQuotesWithFallback(symbols, apiKey) {
  try {
    const data = await fetchTwelveQuotes(symbols, apiKey);
    return { data, source: "twelve" };
  } catch (twelveError) {
    const data = await fetchYahooQuotes(symbols);
    return { data, source: "yahoo", fallbackReason: twelveError.message };
  }
}

async function fetchQuotesWithCache(request, env, cacheName, symbols, apiKey) {
  const shared = await readSharedCache(env, cacheName);
  if (shared?.body && Date.now() - Number(shared.cachedAt || 0) < CACHE_SECONDS * 1000) {
    return responseFromCached(shared, "HIT-KV");
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL(`/cache/${cacheName}`, request.url).toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      headers: { ...Object.fromEntries(cached.headers), "X-MYH88-Cache": "HIT" },
    });
  }

  try {
    const result = await fetchQuotesWithFallback(symbols, apiKey);
    const response = jsonResponse(result.data, result.source === "twelve" ? "MISS-TWELVE" : "MISS-YAHOO");
    response.headers.set("X-MYH88-Source", result.source);
    if (result.fallbackReason) response.headers.set("X-MYH88-Fallback-Reason", result.fallbackReason.slice(0, 120));
    response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`);
    await writeSharedCache(env, cacheName, response.clone());
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    if (shared?.body) return responseFromCached(shared, "STALE-KV");
    return json({ error: error.message || "Quote request failed" }, 502);
  }
}

async function fetchFxRateWithCache(request, env, currency, apiKey) {
  const cacheName = `fx:${currency}`;
  const shared = await readSharedCache(env, cacheName);
  if (shared?.body && Date.now() - Number(shared.cachedAt || 0) < 24 * 60 * 60 * 1000) {
    return JSON.parse(shared.body);
  }

  try {
    if (TWELVE_DISABLED) throw new Error("Twelve Data upstream disabled");
    const url = new URL(`${TWELVE_BASE}/exchange_rate`);
    url.searchParams.set("symbol", `${currency}/USD`);
    url.searchParams.set("apikey", apiKey);
    const data = await fetchJsonUpstream(url);
    const rate = Number(data.rate);
    if (!(rate > 0)) throw new Error(`FX rate missing for ${currency}`);
    const response = jsonResponse({ symbol: `${currency}/USD`, rate }, "MISS-TWELVE");
    await writeSharedCache(env, cacheName, response.clone());
    return { symbol: `${currency}/USD`, rate };
  } catch (error) {
    if (shared?.body) return JSON.parse(shared.body);
    throw error;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const incoming = new URL(request.url);
    const pathname = incoming.pathname.replace(/\/+$/, "");

    try {
      if (pathname === "" || pathname === "/") {
        const apiKey = String(env.TWELVE_DATA_KEY || "").trim();
        return json({
          ok: true,
          service: "MYH88 price proxy",
          cacheSeconds: CACHE_SECONDS,
          staleSeconds: STALE_SECONDS,
          sharedCache: Boolean(env.MYH88_CACHE),
          secretConfigured: Boolean(apiKey),
          secretLength: apiKey.length,
          twelveDisabled: TWELVE_DISABLED,
          fallbackProvider: "yahoo",
        });
      }

      const apiKey = String(env.TWELVE_DATA_KEY || "").trim();
      if (!apiKey) return json({ error: "TWELVE_DATA_KEY is not configured" }, 500);

      if (pathname === "/quotes") {
        const symbols = normalizeSymbols(incoming.searchParams.get("symbols"));
        if (!symbols.length) return json({ error: "Missing symbols" }, 400);
        return fetchQuotesWithCache(request, env, `quotes:${symbols.join(",")}`, symbols, apiKey);
      }

      if (pathname === "/fx") {
        const currencies = normalizeSymbols(incoming.searchParams.get("currencies")).filter((c) => c !== "USD");
        if (!currencies.length) return json({ rates: { USD: 1 } });

        const rates = { USD: 1 };
        await Promise.all(
          currencies.map(async (currency) => {
            const data = await fetchFxRateWithCache(request, env, currency, apiKey);
            if (Number(data.rate) > 0) rates[currency] = Number(data.rate);
          })
        );
        return json({ rates });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message || "Proxy failed" }, 502);
    }
  },
};
