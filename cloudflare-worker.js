const WORKER_VERSION = "10.54";
const WORKER_BUILT_AT = "2026-08-07T03:45:00.000Z";
const CACHE_SECONDS = 30 * 60;
const STALE_SECONDS = 6 * 60 * 60;
const LAST_CLOSE_CACHE_SECONDS = 8 * 24 * 60 * 60;
const HISTORICAL_CACHE_SECONDS = 365 * 24 * 60 * 60;
const MARKET_CLOCK_CACHE_SECONDS = 15 * 60;
const PORTFOLIO_CACHE_SECONDS = 5 * 60;
const PROVIDER_BACKOFF_SECONDS = 30 * 60;
const FINNHUB_BACKOFF_SECONDS = 90;
const TWELVE_BATCH_LIMIT = 8;
const TWELVE_BASE = "https://api.twelvedata.com";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const PORTFOLIO_DATA_URL = "https://myh88.com/data.json";
const US_MARKET_TZ = "America/New_York";
const US_MARKET_OPEN_MIN = 9 * 60 + 30;
const US_MARKET_CLOSE_MIN = 16 * 60;
const US_EARLY_CLOSE_MIN = 13 * 60;
const FALLBACK_PORTFOLIO_SYMBOLS = ["NVDA", "MRVL", "AAOI", "XFAB", "RKLB", "VRT", "SPCX", "GOOGL", "LITE", "MU", "VOO", "QQQM"];
const DEFAULT_TWELVE_PRIORITY = ["NVDA", "RKLB", "SPCX", "GOOGL", "MU", "MRVL", "AAOI", "TSLA"];
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
function safeHeaderValue(value, maxLength = 240) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7E]/g, " ").slice(0, maxLength).trim();
}
function normalizeSymbols(value) {
  return [...new Set(String(value || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.-]{1,12}$/.test(s)))];
}
function buildProviderPlan(symbols, priority = [], limit = TWELVE_BATCH_LIMIT) {
  const available = normalizeSymbols(symbols.join(","));
  const preferred = normalizeSymbols(priority.join(",")).filter((symbol) => available.includes(symbol));
  const twelve = preferred.slice(0, limit);
  for (const symbol of available) {
    if (twelve.length >= limit) break;
    if (!twelve.includes(symbol)) twelve.push(symbol);
  }
  return { twelve, finnhub: available.filter((symbol) => !twelve.includes(symbol)) };
}
function configuredTwelvePriority(env) {
  return normalizeSymbols(env.TWELVE_PRIORITY_SYMBOLS || DEFAULT_TWELVE_PRIORITY.join(","));
}
function quoteCacheKey(symbol, mode = "live", asOf = "") {
  const ticker = normalizeSymbols(symbol)[0] || "";
  if (mode === "historical-close") return `quote:historical:${asOf}:${ticker}`;
  return mode === "last-close" ? `quote:last-close:${asOf}:${ticker}` : `quote:live:${ticker}`;
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
  await env.MYH88_CACHE.put(key, JSON.stringify({ cachedAt: Date.now(), contentType: response.headers.get("Content-Type") || "application/json; charset=utf-8", source: safeHeaderValue(response.headers.get("X-MYH88-Source")), asOf: safeHeaderValue(response.headers.get("X-MYH88-As-Of")), warnings: safeHeaderValue(response.headers.get("X-MYH88-Warnings")), fallbackReason: safeHeaderValue(response.headers.get("X-MYH88-Fallback-Reason")), body }), { expirationTtl: ttl }).catch((error) => console.error("KV write failed", key, error));
}
function responseFromCached(record, cacheLabel) {
  return new Response(record.body, { status: 200, headers: { ...corsHeaders, "Content-Type": record.contentType || "application/json; charset=utf-8", "X-MYH88-Cache": safeHeaderValue(cacheLabel), "X-MYH88-Cached-At": safeHeaderValue(record.cachedAt || ""), "X-MYH88-Source": safeHeaderValue(record.source), "X-MYH88-As-Of": safeHeaderValue(record.asOf), "X-MYH88-Warnings": safeHeaderValue(record.warnings), "X-MYH88-Fallback-Reason": safeHeaderValue(record.fallbackReason) } });
}
function jsonResponse(data, cacheLabel = "MISS", metadata = {}) {
  return json(data, 200, { "X-MYH88-Cache": safeHeaderValue(cacheLabel), "X-MYH88-Source": safeHeaderValue(metadata.source), "X-MYH88-As-Of": safeHeaderValue(metadata.asOf), ...(metadata.warnings ? { "X-MYH88-Warnings": safeHeaderValue(metadata.warnings) } : {}), ...(metadata.fallbackReason ? { "X-MYH88-Fallback-Reason": safeHeaderValue(metadata.fallbackReason, 120) } : {}) });
}
async function fetchJsonUpstream(url, timeoutMs = 8000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort("upstream timeout"), timeoutMs);
  try {
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal, cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
    const text = await response.text().catch(() => ""); let data = {};
    try { data = JSON.parse(text || "{}"); } catch {}
    if (!response.ok || data.code || data.status === "error") throw new Error(safeHeaderValue(data.message || data.error || text.slice(0, 160) || `Upstream error ${response.status}`, 320));
    return data;
  } finally { clearTimeout(timer); }
}
function portfolioSymbolsFromData(data = {}) {
  return normalizeSymbols([
    ...(data.positions || []).filter((item) => item?.source !== "manual").map((item) => item.symbol),
    ...(data.transactions || []).filter((item) => !item?.voided && item?.source !== "manual").map((item) => item.symbol),
    ...(data.dcaPlan?.funds || []).filter((item) => item?.source !== "manual").map((item) => item.symbol),
  ].join(","));
}
async function livePortfolioSymbols(env) {
  const key = "config:portfolio-symbols:v3", cached = await readSharedCache(env, key);
  if (cached?.body && Date.now() - Number(cached.cachedAt || 0) < PORTFOLIO_CACHE_SECONDS * 1000) return JSON.parse(cached.body).symbols;
  try {
    const data = await fetchJsonUpstream(PORTFOLIO_DATA_URL, 5000);
    const symbols = portfolioSymbolsFromData(data);
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
function normalizeHistoricalQuote(symbol, date, item, source) {
  const close = Number(item?.close || 0), open = Number(item?.open || close), high = Number(item?.high || close), low = Number(item?.low || close);
  if (!(close > 0)) throw new Error(`${source} historical close missing for ${symbol}`);
  return { symbol, name: symbol, currency: "USD", exchange: "", datetime: `${date}T20:00:00.000Z`, timestamp: Math.floor(Date.parse(`${date}T20:00:00.000Z`) / 1000), open: String(open), high: String(high), low: String(low), close: String(close), previous_close: String(close), change: "0", percent_change: "0", is_market_open: false, source, as_of: date };
}
async function fetchTwelveHistoricalClose(symbol, date, key) {
  if (!key || key.length < 10) throw new Error("TWELVE_DATA_KEY is missing or invalid");
  const url = new URL(`${TWELVE_BASE}/time_series`);
  url.searchParams.set("symbol", symbol);url.searchParams.set("interval", "1day");url.searchParams.set("start_date", date);url.searchParams.set("end_date", addDate(date, 1));url.searchParams.set("outputsize", "1");url.searchParams.set("apikey", key);
  const data = await fetchJsonUpstream(url), item = Array.isArray(data?.values) ? data.values.find((value) => String(value.datetime || "").slice(0, 10) === date) || data.values[0] : null;
  return normalizeHistoricalQuote(symbol, date, item, "twelve");
}
async function fetchFinnhubHistoricalClose(symbol, date, key) {
  if (!key) throw new Error("FINNHUB_API_KEY is not configured");
  const start = Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 1000), url = new URL(`${FINNHUB_BASE}/stock/candle`);
  url.searchParams.set("symbol", symbol);url.searchParams.set("resolution", "D");url.searchParams.set("from", String(start));url.searchParams.set("to", String(start + 86399));url.searchParams.set("token", key);
  const data = await fetchJsonUpstream(url);if(data?.s !== "ok" || !Array.isArray(data.c) || !data.c.length)throw new Error(`Finnhub historical close missing for ${symbol}`);
  const index = data.c.length - 1;return normalizeHistoricalQuote(symbol, date, { open: data.o?.[index], high: data.h?.[index], low: data.l?.[index], close: data.c[index] }, "finnhub");
}
function quoteMapFromProvider(data, symbols, source) { const quotes = {}; if (symbols.length === 1 && data && !data[symbols[0]]) quotes[symbols[0]] = { ...data, source }; for (const symbol of symbols) if (data?.[symbol] && !data[symbol].code && data[symbol].status !== "error") quotes[symbol] = { ...data[symbol], source }; return quotes; }
async function providerBackedOff(env, provider) { const item = await readSharedCache(env, `provider:${provider}:backoff`); return item?.body ? JSON.parse(item.body) : null; }
async function backoffProvider(env, provider, error) { if (!isQuotaError(error)) return; const seconds = provider === "finnhub" ? FINNHUB_BACKOFF_SECONDS : PROVIDER_BACKOFF_SECONDS; const response = json({ until: Date.now() + seconds * 1000, message: safeHeaderValue(error.message || error, 120) }); await writeSharedCache(env, `provider:${provider}:backoff`, response, seconds); }
async function fetchFinnhubPartial(symbols, key) {
  const quotes = {}, errors = [];
  for (let offset = 0; offset < symbols.length; offset += 3) {
    const batch = symbols.slice(offset, offset + 3);
    const settled = await Promise.allSettled(batch.map((symbol) => fetchFinnhubQuote(symbol, key)));
    settled.forEach((result, index) => {
      const symbol = batch[index];
      if (result.status === "fulfilled") quotes[symbol] = result.value;
      else errors.push(`${symbol}: ${result.reason?.message || "Finnhub failed"}`);
    });
  }
  return { quotes, errors };
}
async function fetchQuotesWithFallback(symbols, env, routingPlan) {
  const twelveKey = String(env.TWELVE_DATA_KEY || "").trim(), finnhubKey = String(env.FINNHUB_API_KEY || "").trim(), warnings = [], quotes = {};
  const twelveFirst = symbols.filter((symbol) => routingPlan.twelve.includes(symbol));
  const finnhubFirst = symbols.filter((symbol) => routingPlan.finnhub.includes(symbol));
  let twelveReason = "";
  const twelveBackoff = await providerBackedOff(env, "twelve");
  if (twelveFirst.length && !twelveBackoff) {
    try { Object.assign(quotes, quoteMapFromProvider(await fetchTwelveQuotes(twelveFirst, twelveKey), twelveFirst, "twelve")); }
    catch (error) { twelveReason = safeHeaderValue(error.message || "Twelve failed", 240); warnings.push(`Twelve: ${twelveReason}`); await backoffProvider(env, "twelve", error); }
  } else if (twelveFirst.length) { twelveReason = "Twelve temporarily backed off"; warnings.push(twelveReason); }
  const missing = [...finnhubFirst, ...twelveFirst.filter((symbol) => !quotes[symbol])];
  const finnhubBackoff = await providerBackedOff(env, "finnhub");
  if (missing.length && !finnhubBackoff) {
    const result = await fetchFinnhubPartial(missing, finnhubKey);
    Object.assign(quotes, result.quotes);
    warnings.push(...result.errors);
    if (result.errors.some((message) => isQuotaError(message))) await backoffProvider(env, "finnhub", new Error(result.errors.join("; ")));
  } else if (missing.length) warnings.push("Finnhub temporarily backed off");
  if (!Object.keys(quotes).length) throw new Error(warnings.join("; ") || "No usable quotes");
  const sources = new Set(Object.values(quotes).map((quote) => quote.source));
  return { quotes, source: sources.size > 1 ? "mixed" : sources.has("twelve") ? "twelve" : "finnhub", warnings, fallbackReason: twelveReason };
}
async function limitMiss(env, key) { return env.MYH88_QUOTE_LIMITER ? env.MYH88_QUOTE_LIMITER.limit({ key }) : { success: true }; }
async function fetchQuotesWithCache(request, env, ctx, canonicalSymbols, requestedSymbols, mode) {
  const isLastClose = mode === "last-close", asOf = isLastClose ? previousTradingDate() : "";
  const maxAge = isLastClose ? LAST_CLOSE_CACHE_SECONDS : CACHE_SECONDS;
  const ttl = isLastClose ? LAST_CLOSE_CACHE_SECONDS * 2 : CACHE_SECONDS + STALE_SECONDS;
  const records = await Promise.all(requestedSymbols.map(async (symbol) => {
    const key = quoteCacheKey(symbol, mode, asOf), record = await readSharedCache(env, key);
    let quote = null;
    try { quote = record?.body ? JSON.parse(record.body) : null; } catch {}
    const fresh = Boolean(quote && Date.now() - Number(record.cachedAt || 0) < maxAge * 1000);
    return { symbol, key, record, quote, fresh };
  }));
  const body = Object.fromEntries(records.filter((item) => item.fresh).map((item) => [item.symbol, item.quote]));
  const missing = records.filter((item) => !item.fresh).map((item) => item.symbol);
  if (!missing.length) {
    const sources = new Set(Object.values(body).map((quote) => quote.source).filter(Boolean));
    const source = sources.size > 1 ? "mixed" : [...sources][0] || "cache";
    return jsonResponse(body, isLastClose ? "HIT-LAST-CLOSE-PER-SYMBOL" : "HIT-KV-PER-SYMBOL", { source, asOf });
  }
  const limit = await limitMiss(env, `quotes:${mode}`);
  if (!limit.success) {
    const stale = records.filter((item) => !item.fresh && item.quote);
    stale.forEach((item) => { body[item.symbol] = item.quote; });
    if (Object.keys(body).length === requestedSymbols.length) return jsonResponse(body, "STALE-RATE-LIMIT", { source: "mixed", asOf, warnings: "Refresh rate limited; per-symbol stale cache used" });
    log("quote_rate_limited", { mode, missing: missing.join(",") });
    return noStoreJson({ error: "Quote refresh is temporarily busy. Please retry shortly." }, 429);
  }
  try {
    const routingPlan = buildProviderPlan(canonicalSymbols, configuredTwelvePriority(env), TWELVE_BATCH_LIMIT);
    const result = await fetchQuotesWithFallback(missing, env, routingPlan);
    Object.assign(body, result.quotes);
    const unresolved = records.filter((item) => !body[item.symbol] && item.quote);
    unresolved.forEach((item) => { body[item.symbol] = item.quote; });
    if (!Object.keys(body).length) throw new Error("No usable quotes");
    const cacheLabel = unresolved.length ? `PARTIAL-STALE-${result.source.toUpperCase()}` : `MISS-${result.source.toUpperCase()}`;
    const response = jsonResponse(body, `${cacheLabel}${isLastClose ? "-LAST-CLOSE" : ""}`, { source: result.source, asOf, warnings: result.warnings.join(" | "), fallbackReason: result.fallbackReason });
    response.headers.set("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${ttl}`);
    const writes = Object.entries(result.quotes).map(([symbol, quote]) => writeSharedCache(
      env,
      quoteCacheKey(symbol, mode, asOf),
      jsonResponse(quote, "STORE-PER-SYMBOL", { source: quote.source, asOf }),
      ttl,
    ));
    ctx.waitUntil(Promise.all(writes));
    log("quote_refresh", { source: result.source, fetched: Object.keys(result.quotes).join(","), served: Object.keys(body).length, mode });
    return response;
  } catch (error) {
    const stale = records.filter((item) => item.quote);
    stale.forEach((item) => { body[item.symbol] = item.quote; });
    log("quote_refresh_failed", { mode, missing: missing.join(","), message: error.message });
    if (Object.keys(body).length) return jsonResponse(body, "STALE-KV-PER-SYMBOL", { source: "mixed", asOf, warnings: error.message });
    return noStoreJson({ error: error.message || "Quote request failed" }, 502);
  }
}
async function fetchHistoricalCloseWithCache(env, ctx, canonicalSymbols, requestedSymbols, date) {
  const records = await Promise.all(requestedSymbols.map(async (symbol) => {
    const key = quoteCacheKey(symbol, "historical-close", date), record = await readSharedCache(env, key);let quote = null;
    try { quote = record?.body ? JSON.parse(record.body) : null; } catch {}
    return { symbol, key, quote };
  }));
  const body = Object.fromEntries(records.filter((item) => item.quote).map((item) => [item.symbol, item.quote])), missing = records.filter((item) => !item.quote).map((item) => item.symbol);
  if (!missing.length) return jsonResponse(body, "HIT-HISTORICAL-PER-SYMBOL", { source: "cache", asOf: date });
  const limit = await limitMiss(env, `quotes:historical:${date}`);if(!limit.success)return noStoreJson({ error: "Historical quote refresh is temporarily busy." }, 429);
  const plan = buildProviderPlan(missing, configuredTwelvePriority(env), TWELVE_BATCH_LIMIT), warnings = [], fetched = {};
  for (const symbol of missing) {
    let quote = null;
    if (plan.twelve.includes(symbol)) {
      try { quote = await fetchTwelveHistoricalClose(symbol, date, String(env.TWELVE_DATA_KEY || "").trim()); }
      catch (error) { warnings.push(`${symbol} Twelve: ${safeHeaderValue(error.message)}`); }
    }
    if (!quote) {
      try { quote = await fetchFinnhubHistoricalClose(symbol, date, String(env.FINNHUB_API_KEY || "").trim()); }
      catch (error) { warnings.push(`${symbol} Finnhub: ${safeHeaderValue(error.message)}`); }
    }
    if (quote) fetched[symbol] = body[symbol] = quote;
  }
  if (!Object.keys(body).length) return noStoreJson({ error: warnings.join("; ") || "No historical closes available" }, 502);
  ctx.waitUntil(Promise.all(Object.entries(fetched).map(([symbol, quote]) => writeSharedCache(env, quoteCacheKey(symbol, "historical-close", date), jsonResponse(quote, "STORE-HISTORICAL", { source: quote.source, asOf: date }), HISTORICAL_CACHE_SECONDS))));
  return jsonResponse(body, "MISS-HISTORICAL", { source: new Set(Object.values(fetched).map((quote) => quote.source)).size > 1 ? "mixed" : Object.values(fetched)[0]?.source || "cache", asOf: date, warnings: warnings.join(" | ") });
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
        const portfolio = await livePortfolioSymbols(env);
        const routing = buildProviderPlan(portfolio, configuredTwelvePriority(env), TWELVE_BATCH_LIMIT);
        const [twelveBackoff, finnhubBackoff] = await Promise.all([providerBackedOff(env, "twelve"), providerBackedOff(env, "finnhub")]);
        return json({
          ok: true,
          service: "MYH88 price proxy",
          version: WORKER_VERSION,
          builtAt: WORKER_BUILT_AT,
          cacheMode: "per-symbol",
          cacheSeconds: CACHE_SECONDS,
          staleSeconds: STALE_SECONDS,
          lastCloseCacheSeconds: LAST_CLOSE_CACHE_SECONDS,
          historicalCacheSeconds: HISTORICAL_CACHE_SECONDS,
          sharedCache: Boolean(env.MYH88_CACHE),
          providers: { twelve: Boolean(String(env.TWELVE_DATA_KEY || "").trim()), finnhub: Boolean(String(env.FINNHUB_API_KEY || "").trim()) },
          providerBackoff: { twelve: twelveBackoff || null, finnhub: finnhubBackoff || null },
          routing,
          rateLimitConfigured: Boolean(env.MYH88_QUOTE_LIMITER),
          portfolioSymbols: portfolio.length,
          fxMode: "manual",
        });
      }
      if (path === "/market-clock") return fetchMarketClockWithCache(env, ctx);
      if (path === "/fx") return noStoreJson({ error: "FX proxy is disabled. Exchange rates are managed manually in the ledger." }, 404);
      if (path !== "/quotes") return noStoreJson({ error: "Not found" }, 404);
      const requested = normalizeSymbols(url.searchParams.get("symbols")); if (!requested.length) return noStoreJson({ error: "Missing symbols" }, 400);
      const portfolio = await livePortfolioSymbols(env), blocked = requested.filter((symbol) => !portfolio.includes(symbol));
      if (blocked.length) return noStoreJson({ error: "Only current portfolio symbols may be requested", symbols: blocked }, 400);
      const mode = String(url.searchParams.get("mode") || "live").toLowerCase(); if (mode !== "live" && mode !== "last-close" && mode !== "historical-close") return noStoreJson({ error: "Unsupported quote mode" }, 400);
      if (mode === "historical-close") {
        const date = String(url.searchParams.get("date") || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isTradingDate(date) || date > previousTradingDate()) return noStoreJson({ error: "Invalid historical trading date" }, 400);
        return fetchHistoricalCloseWithCache(env, ctx, portfolio, requested, date);
      }
      return fetchQuotesWithCache(request, env, ctx, portfolio, requested, mode);
    } catch (error) { log("worker_error", { path, message: error.message || String(error) }); return noStoreJson({ error: error.message || "Proxy failed" }, 502); }
  },
};

export { buildProviderPlan, localMarketClock, portfolioSymbolsFromData, previousTradingDate, quoteCacheKey };
