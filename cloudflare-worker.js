const CACHE_SECONDS = 30 * 60;
const STALE_SECONDS = 6 * 60 * 60;
const MARKET_CLOCK_CACHE_SECONDS = 15 * 60;
const PORTFOLIO_CACHE_SECONDS = 5 * 60;
const PROVIDER_BACKOFF_SECONDS = 30 * 60;
const TWELVE_BATCH_LIMIT = 8;
const TWELVE_BASE = "https://api.twelvedata.com";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const PORTFOLIO_DATA_URL = "https://myh88.com/data.json";
const US_MARKET_TZ = "America/New_York";
const US_MARKET_OPEN_MIN = 9 * 60 + 30;
const US_MARKET_CLOSE_MIN = 16 * 60;
const US_EARLY_CLOSE_MIN = 13 * 60;
const FALLBACK_PORTFOLIO_SYMBOLS = ["NVDA", "MRVL", "AAOI", "XFAB", "RKLB", "VRT", "SPCX", "GOOGL", "LITE", "MU"];
const US_STATIC_HOLIDAYS = {
  "2026-01-01": "New Year's Day", "2026-01-19": "Martin Luther King Jr. Day", "2026-02-16": "Presidents' Day", "2026-04-03": "Good Friday", "2026-05-25": "Memorial Day", "2026-06-19": "Juneteenth", "2026-07-03": "Independence Day observed", "2026-09-07": "Labor Day", "2026-11-26": "Thanksgiving Day", "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day", "2027-01-18": "Martin Luther King Jr. Day", "2027-02-15": "Presidents' Day", "2027-03-26": "Good Friday", "2027-05-31": "Memorial Day", "2027-06-18": "Juneteenth observed", "2027-07-05": "Independence Day observed", "2027-09-06": "Labor Day", "2027-11-25": "Thanksgiving Day", "2027-12-24": "Christmas Day observed",
  "2028-01-17": "Martin Luther King Jr. Day", "2028-02-21": "Presidents' Day", "2028-04-14": "Good Friday", "2028-05-29": "Memorial Day", "2028-06-19": "Juneteenth", "2028-07-04": "Independence Day", "2028-09-04": "Labor Day", "2028-11-23": "Thanksgiving Day", "2028-12-25": "Christmas Day",
};
const US_STATIC_EARLY_CLOSES = { "2026-11-27": "Day after Thanksgiving early close", "2026-12-24": "Christmas Eve early close" };
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-MYH88-Cache, X-MYH88-Source, X-MYH88-Fallback-Reason, X-MYH88-Warnings, X-MYH88-As-Of",
  "Cache-Control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", ...extraHeaders } });
}
function noStoreJson(data, status) { return json(data, status, { "Cache-Control": "no-store" }); }
function normalizeSymbols(value) {
  return [...new Set(String(value || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.-]{1,12}$/.test(s)))];
}
function nyParts(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: US_MARKET_TZ, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  if (p.hour === "24") p.hour = "00";
  return { weekday: p.weekday, date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
function addDate(dateString, days) { const d = new Date(`${dateString}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function weekdayFor(dateString) { return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${dateString}T12:00:00Z`)); }
function isTradingDate(dateString) { const weekday = weekdayFor(dateString); return weekday !== "Sat" && weekday !== "Sun" && !US_STATIC_HOLIDAYS[dateString]; }
function previousTradingDate(now = new Date()) {
  const ny = nyParts(now); const closeMinute = US_STATIC_EARLY_CLOSES[ny.date] ? US_EARLY_CLOSE_MIN : US_MARKET_CLOSE_MIN;
  let date = ny.date;
  if (!isTradingDate(date) || ny.hour * 60 + ny.minute < closeMinute) date = addDate(date, -1);
  while (!isTradingDate(date)) date = addDate(date, -1);
  return date;
}
function localMarketClock(now = new Date()) {
  const parts = nyParts(now), weekend = parts.weekday === "Sat" || parts.weekday === "Sun", holiday = US_STATIC_HOLIDAYS[parts.date], earlyClose = US_STATIC_EARLY_CLOSES[parts.date];
  const closeMinute = earlyClose ? US_EARLY_CLOSE_MIN : US_MARKET_CLOSE_MIN, minute = parts.hour * 60 + parts.minute, isOpen = !weekend && !holiday && minute >= US_MARKET_OPEN_MIN && minute < closeMinute;
  return { source: "local", exchange: "US", timezone: US_MARKET_TZ, date: parts.date, isOpen, phase: isOpen ? "open" : holiday ? "holiday" : weekend ? "weekend" : minute < US_MARKET_OPEN_MIN ? "pre" : "closed", holiday: holiday || "", earlyClose: earlyClose || "", openMinute: US_MARKET_OPEN_MIN, closeMinute, checkedAt: now.toISOString() };
}
function log(event, fields = {}) { console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields })); }
function isQuotaError(error) { return /429|credit|quota|limit|rate/i.test(String(error?.message || error)); }
async function readSharedCache(env, key) { return env.MYH88_CACHE ? env.MYH88_CACHE.get(key, { type: "json" }).catch(() => null) : null; }
async function writeSharedCache(env, key, response, ttl = CACHE_SECONDS + STALE_SECONDS) {
  if (!env.MYH88_CACHE || !response.ok) return;
  const body = await response.clone().text();
  await env.MYH88_CACHE.put(key, JSON.stringify({ cachedAt: Date.now(), contentType: response.headers.get("Content-Type") || "application/json; charset=utf-8", source: response.headers.get("X-MYH88-Source") || "", asOf: response.headers.get("X-MYH88-As-Of") || "", warnings: response.headers.get("X-MYH88-Warnings") || "", fallbackReason: response.headers.get("X-MYH88-Fallback-Reason") || "", body }), { expirationTtl: ttl }).catch((error) => console.error("KV write failed", key, error));
}
function responseFromCached(record, cacheLabel) {
  return new Response(record.body, { status: 200, headers: { ...corsHeaders, "Content-Type": record.contentType || "application/json; charset=utf-8", "X-MYH88-Cache": cacheLabel, "X-MYH88-Cached-At": String(record.cachedAt || ""), "X-MYH88-Source": record.source || "", "X-MYH88-As-Of": record.asOf || "", "X-MYH88-Warnings": record.warnings || "", "X-MYH88-Fallback-Reason": record.fallbackReason || "" } });
}
function jsonResponse(data, cacheLabel = "MISS", metadata = {}) {
  return json(data, 200, { "X-MYH88-Cache": cacheLabel, "X-MYH88-Source": metadata.source || "", "X-MYH88-As-Of": metadata.asOf || "", ...(metadata.warnings ? { "X-MYH88-Warnings": metadata.warnings.slice(0, 240) } : {}), ...(metadata.fallbackReason ? { "X-MYH88-Fallback-Reason": metadata.fallbackReason.slice(0, 120) } : {}) });
}
async function fetchJsonUpstream(url, timeoutMs = 8000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort("upstream timeout"), timeoutMs);
  try {
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal, cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
    const text = await response.text().catch(() => ""); let data = {};
    try { data = JSON.parse(text || "{}"); } catch {}
    if (!response.ok || data.code || data.status === "error") throw new Error(data.message || data.error || text.slice(0, 160) || `Upstream error ${response.status}`);
    return data;
  } finally { clearTimeout(timer); }
}
async function livePortfolioSymbols(env) {
  const key = "config:portfolio-symbols", cached = await readSharedCache(env, key);
  if (cached?.body && Date.now() - Number(cached.cachedAt || 0) < PORTFOLIO_CACHE_SECONDS * 1000) return JSON.parse(cached.body).symbols;
  try {
    const data = await fetchJsonUpstream(PORTFOLIO_DATA_URL, 5000);
    const symbols = normalizeSymbols((data.positions || []).filter((p) => p?.source !== "manual").map((p) => p.symbol).join(","));
    if (!symbols.length) throw new Error("No portfolio symbols in data.json");
    const response = json({ symbols }, 200); await writeSharedCache(env, key, response, PORTFOLIO_CACHE_SECONDS * 3); return symbols;
  } catch (error) { log("portfolio_config_fallback", { message: error.message }); return FALLBACK_PORTFOLIO_SYMBOLS; }
}
function normalizeFinnhubQuote(symbol, data) {
  const close = Number(data.c || 0), previous = Number(data.pc || close || 0), change = close && previous ? close - previous : 0;
  return { symbol, name: symbol, currency: "USD", exchange: "", datetime: new Date(Number(data.t || Date.now() / 1000) * 1000).toISOString(), timestamp: Number(data.t || Date.now() / 1000), open: String(data.o || close), high: String(data.h || close), low: String(data.l || close), close: String(close), previous_close: String(previous), change: String(change), percent_change: String(previous ? change / previous * 100 : 0), is_market_open: false, source: "finnhub" };
}
async function fetchFinnhubQuote(symbol, key) { if (!key) throw new Error("FINNHUB_API_KEY is not configured"); const url = new URL(`${FINNHUB_BASE}/quote`); url.searchParams.set("symbol", symbol); url.searchParams.set("token", key); const data = await fetchJsonUpstream(url); if (!(Number(data.c) > 0)) throw new Error(`Finnhub quote missing for ${symbol}`); return normalizeFinnhubQuote(symbol, data); }
async function fetchTwelveQuotes(symbols, key) { if (!key || key.length < 10) throw new Error("TWELVE_DATA_KEY is missing or invalid"); const url = new URL(`${TWELVE_BASE}/quote`); url.searchParams.set("symbol", symbols.join(",")); url.searchParams.set("apikey", key); return fetchJsonUpstream(url); }
function quoteMapFromProvider(data, symbols, source) { const quotes = {}; if (symbols.length === 1 && data && !data[symbols[0]]) quotes[symbols[0]] = { ...data, source }; for (const symbol of symbols) if (data?.[symbol] && !data[symbol].code && data[symbol].status !== "error") quotes[symbol] = { ...data[symbol], source }; return quotes; }
async function providerBackedOff(env, provider) { const item = await readSharedCache(env, `provider:${provider}:backoff`); return item?.body ? JSON.parse(item.body) : null; }
async function backoffProvider(env, provider, error, ctx) { if (!isQuotaError(error)) return; const response = json({ until: Date.now() + PROVIDER_BACKOFF_SECONDS * 1000, message: String(error.message || error).slice(0, 120) }); ctx.waitUntil(writeSharedCache(env, `provider:${provider}:backoff`, response, PROVIDER_BACKOFF_SECONDS)); }
async function fetchFinnhubPartial(symbols, key, warnings) {
  const settled = await Promise.allSettled(symbols.map((symbol) => fetchFinnhubQuote(symbol, key)));
  const quotes = {}; settled.forEach((result, index) => { if (result.status === "fulfilled") quotes[symbols[index]] = result.value; else warnings.push(`${symbols[index]}: ${result.reason?.message || "Finnhub failed"}`); }); return quotes;
}
async function fetchQuotesWithFallback(symbols, env, ctx) {
  const twelveKey = String(env.TWELVE_DATA_KEY || "").trim(), finnhubKey = String(env.FINNHUB_API_KEY || "").trim(), warnings = [], quotes = {};
  const firstEight = symbols.slice(0, TWELVE_BATCH_LIMIT), finnhubFirst = symbols.slice(TWELVE_BATCH_LIMIT); let twelveReason = "";
  const twelveBackoff = await providerBackedOff(env, "twelve");
  if (firstEight.length && !twelveBackoff) {
    try { Object.assign(quotes, quoteMapFromProvider(await fetchTwelveQuotes(firstEight, twelveKey), firstEight, "twelve")); }
    catch (error) { twelveReason = error.message || "Twelve failed"; warnings.push(`Twelve: ${twelveReason}`); await backoffProvider(env, "twelve", error, ctx); }
  } else if (firstEight.length) { twelveReason = "Twelve temporarily backed off"; warnings.push(twelveReason); }
  const missing = [...finnhubFirst, ...firstEight.filter((symbol) => !quotes[symbol])];
  if (missing.length) Object.assign(quotes, await fetchFinnhubPartial(missing, finnhubKey, warnings));
  if (!Object.keys(quotes).length) throw new Error(warnings.join("; ") || "No usable quotes");
  const sources = new Set(Object.values(quotes).map((quote) => quote.source));
  return { quotes, source: sources.size > 1 ? "mixed" : sources.has("twelve") ? "twelve" : "finnhub", warnings, fallbackReason: twelveReason };
}
async function limitMiss(env, key) { return env.MYH88_QUOTE_LIMITER ? env.MYH88_QUOTE_LIMITER.limit({ key }) : { success: true }; }
async function fetchQuotesWithCache(request, env, ctx, canonicalSymbols, requestedSymbols, mode) {
  const isLastClose = mode === "last-close", asOf = isLastClose ? previousTradingDate() : "", cacheName = `${isLastClose ? `last-close:${asOf}` : "quotes"}:${canonicalSymbols.join(",")}`;
  const maxAge = isLastClose ? 36 * 60 * 60 : CACHE_SECONDS, ttl = maxAge + STALE_SECONDS, shared = await readSharedCache(env, cacheName);
  const pick = (response) => { if (requestedSymbols.length === canonicalSymbols.length) return response; return response.json().then((all) => json(Object.fromEntries(requestedSymbols.filter((s) => all[s]).map((s) => [s, all[s]])), 200, Object.fromEntries(response.headers))); };
  if (shared?.body && Date.now() - Number(shared.cachedAt || 0) < maxAge * 1000) return pick(responseFromCached(shared, isLastClose ? "HIT-LAST-CLOSE" : "HIT-KV"));
  const cacheKey = new Request(new URL(`/cache/${cacheName}`, request.url)); const edge = await caches.default.match(cacheKey);
  if (edge) return pick(new Response(edge.body, { status: edge.status, headers: { ...Object.fromEntries(edge.headers), "X-MYH88-Cache": "HIT-EDGE" } }));
  const limit = await limitMiss(env, cacheName);
  if (!limit.success) { if (shared?.body) return pick(responseFromCached(shared, "STALE-RATE-LIMIT")); log("quote_rate_limited", { cacheName }); return noStoreJson({ error: "Quote refresh is temporarily busy. Please retry shortly." }, 429); }
  try {
    const result = await fetchQuotesWithFallback(canonicalSymbols, env, ctx), body = Object.fromEntries(canonicalSymbols.filter((s) => result.quotes[s]).map((s) => [s, result.quotes[s]]));
    const response = jsonResponse(body, `MISS-${result.source.toUpperCase()}${isLastClose ? "-LAST-CLOSE" : ""}`, { source: result.source, asOf, warnings: result.warnings.join(" | "), fallbackReason: result.fallbackReason });
    response.headers.set("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${ttl}`);
    ctx.waitUntil(Promise.all([writeSharedCache(env, cacheName, response.clone(), ttl), caches.default.put(cacheKey, response.clone())]));
    log("quote_refresh", { cacheName, source: result.source, count: Object.keys(body).length, mode }); return pick(response);
  } catch (error) { log("quote_refresh_failed", { cacheName, message: error.message }); if (shared?.body) return pick(responseFromCached(shared, "STALE-KV")); return noStoreJson({ error: error.message || "Quote request failed" }, 502); }
}
async function fetchMarketClockWithCache(env, ctx) {
  const key = "market-clock:US", shared = await readSharedCache(env, key);
  if (shared?.body && Date.now() - Number(shared.cachedAt || 0) < MARKET_CLOCK_CACHE_SECONDS * 1000) return responseFromCached(shared, "HIT-MARKET-CLOCK");
  const local = localMarketClock(), response = jsonResponse(local, "LOCAL-MARKET-CLOCK", { source: "local" }); response.headers.set("Cache-Control", `public, max-age=${MARKET_CLOCK_CACHE_SECONDS}`); ctx.waitUntil(writeSharedCache(env, key, response.clone(), 24 * 60 * 60)); return response;
}
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "GET") return noStoreJson({ error: "Method not allowed" }, 405);
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/") {
        const portfolio = await livePortfolioSymbols(env); return json({ ok: true, service: "MYH88 price proxy", cacheSeconds: CACHE_SECONDS, staleSeconds: STALE_SECONDS, sharedCache: Boolean(env.MYH88_CACHE), providers: { twelve: Boolean(String(env.TWELVE_DATA_KEY || "").trim()), finnhub: Boolean(String(env.FINNHUB_API_KEY || "").trim()) }, rateLimitConfigured: Boolean(env.MYH88_QUOTE_LIMITER), portfolioSymbols: portfolio.length, fxMode: "manual" });
      }
      if (path === "/market-clock") return fetchMarketClockWithCache(env, ctx);
      if (path === "/fx") return noStoreJson({ error: "FX proxy is disabled. Exchange rates are managed manually in the ledger." }, 404);
      if (path !== "/quotes") return noStoreJson({ error: "Not found" }, 404);
      const requested = normalizeSymbols(url.searchParams.get("symbols")); if (!requested.length) return noStoreJson({ error: "Missing symbols" }, 400);
      const portfolio = await livePortfolioSymbols(env), blocked = requested.filter((symbol) => !portfolio.includes(symbol));
      if (blocked.length) return noStoreJson({ error: "Only current portfolio symbols may be requested", symbols: blocked }, 400);
      const mode = String(url.searchParams.get("mode") || "live").toLowerCase(); if (mode !== "live" && mode !== "last-close") return noStoreJson({ error: "Unsupported quote mode" }, 400);
      return fetchQuotesWithCache(request, env, ctx, portfolio, requested, mode);
    } catch (error) { log("worker_error", { path, message: error.message || String(error) }); return noStoreJson({ error: error.message || "Proxy failed" }, 502); }
  },
};
