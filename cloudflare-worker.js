const CACHE_SECONDS = 30 * 60;
const STALE_SECONDS = 6 * 60 * 60;
const TWELVE_BASE = "https://api.twelvedata.com";

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

async function fetchWithCache(request, env, cacheName, url) {
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

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
  } catch (error) {
    if (shared?.body) return responseFromCached(shared, "STALE-KV");
    return json({ error: error.message || "Twelve Data request failed" }, 502);
  }

  if (!upstream.ok && shared?.body) return responseFromCached(shared, "STALE-KV");

  const response = new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      "X-MYH88-Cache": "MISS",
    },
  });

  if (upstream.ok) {
    response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`);
    await writeSharedCache(env, cacheName, response.clone());
    await cache.put(cacheKey, response.clone());
  }
  return response;
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
        });
      }

      const apiKey = String(env.TWELVE_DATA_KEY || "").trim();
      if (!apiKey) return json({ error: "TWELVE_DATA_KEY is not configured" }, 500);

      if (pathname === "/quotes") {
        const symbols = normalizeSymbols(incoming.searchParams.get("symbols"));
        if (!symbols.length) return json({ error: "Missing symbols" }, 400);
        const url = new URL(`${TWELVE_BASE}/quote`);
        url.searchParams.set("symbol", symbols.join(","));
        url.searchParams.set("apikey", apiKey);
        return fetchWithCache(request, env, `quotes:${symbols.join(",")}`, url);
      }

      if (pathname === "/fx") {
        const currencies = normalizeSymbols(incoming.searchParams.get("currencies")).filter((c) => c !== "USD");
        if (!currencies.length) return json({ rates: { USD: 1 } });

        const rates = { USD: 1 };
        await Promise.all(
          currencies.map(async (currency) => {
            const url = new URL(`${TWELVE_BASE}/exchange_rate`);
            url.searchParams.set("symbol", `${currency}/USD`);
            url.searchParams.set("apikey", apiKey);
            const response = await fetchWithCache(request, env, `fx:${currency}`, url);
            const data = await response.clone().json().catch(() => ({}));
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
