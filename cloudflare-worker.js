const CACHE_SECONDS = 60;
const TWELVE_BASE = "https://api.twelvedata.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
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

async function fetchWithCache(request, url) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });

  const response = new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      "X-MYH88-Cache": "MISS",
    },
  });

  if (upstream.ok) await cache.put(cacheKey, response.clone());
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
        return json({ ok: true, service: "MYH88 price proxy", cacheSeconds: CACHE_SECONDS });
      }

      const apiKey = env.TWELVE_DATA_KEY;
      if (!apiKey) return json({ error: "TWELVE_DATA_KEY is not configured" }, 500);

      if (pathname === "/quotes") {
        const symbols = normalizeSymbols(incoming.searchParams.get("symbols"));
        if (!symbols.length) return json({ error: "Missing symbols" }, 400);
        const url = new URL(`${TWELVE_BASE}/quote`);
        url.searchParams.set("symbol", symbols.join(","));
        url.searchParams.set("apikey", apiKey);
        return fetchWithCache(request, url);
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
            const response = await fetchWithCache(request, url);
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
