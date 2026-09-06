import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import worker, { previousTradingDate } from '../cloudflare-worker.js';

function fixture(age = 0, symbol = 'NVDA') {
  const records = new Map([
    ['config:portfolio-symbols:v3', { cachedAt: Date.now() - age, body: JSON.stringify({ symbols: [symbol] }) }],
    [`quote:last-close:${previousTradingDate()}:${symbol}`, { cachedAt: Date.now(), body: JSON.stringify({ symbol, close: '230', source: 'finnhub' }) }],
    ['quotes:scheduled:current:v1', { quotes: { NVDA: { symbol: 'NVDA', close: '230', timestamp: Date.now() / 1000 } } }],
  ]);
  const counts = { reads: 0, writes: 0, network: 0 };
  const env = { MYH88_CACHE: {
    async get(key) { counts.reads++; return records.get(key); },
    async put(key, value) { counts.writes++; records.set(key, JSON.parse(value)); },
  } };
  return { env, counts };
}
const context = { waitUntil() {} };

test('one unknown symbol does not reject valid closing quotes', async () => {
  const { env } = fixture();
  const response = await worker.fetch(new Request('https://test/quotes?symbols=NVDA,NEW&mode=last-close'), env, context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).NVDA.close, '230');
  assert.equal(response.headers.get('X-MYH88-Rejected-Symbols'), 'NEW');
});

test('portfolio download failure retains last verified symbols', async (t) => {
  const { env } = fixture(6 * 60_000, 'MSTU');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('portfolio unavailable'); });
  // NEW is intentionally absent: the cached trusted list must survive, not a hard-coded list.
  const response = await worker.fetch(new Request('https://test/quotes?symbols=MSTU,NEW&mode=last-close'), env, context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).MSTU.close, '230');
});

test('unknown symbols report a specific error without calling a provider', async (t) => {
  const { env, counts } = fixture();
  t.mock.method(globalThis, 'fetch', async () => { counts.network++; throw new Error('unexpected network'); });
  const response = await worker.fetch(new Request('https://test/quotes?symbols=NEW&mode=last-close'), env, context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'PORTFOLIO_SYMBOLS_PENDING');
  assert.equal(counts.network, 0);
});

test('100 cache-only refreshes use zero provider requests and zero KV writes', async (t) => {
  const { env, counts } = fixture();
  t.mock.method(globalThis, 'fetch', async () => { counts.network++; throw new Error('unexpected network'); });
  for (let n = 0; n < 100; n++) {
    const response = await worker.fetch(new Request('https://test/quotes?symbols=NVDA&cache=only'), env, context);
    assert.equal(response.status, 200);
  }
  assert.deepEqual(counts, { reads: 200, writes: 0, network: 0 });
});

test('100 cached closing refreshes use zero provider requests and zero KV writes', async (t) => {
  const { env, counts } = fixture();
  t.mock.method(globalThis, 'fetch', async () => { counts.network++; throw new Error('unexpected network'); });
  for (let n = 0; n < 100; n++) {
    const response = await worker.fetch(new Request('https://test/quotes?symbols=NVDA&mode=last-close'), env, context);
    assert.equal(response.status, 200);
  }
  assert.deepEqual(counts, { reads: 200, writes: 0, network: 0 });
});

test('ticker cell preserves native table layout', async () => {
  const css = await fs.readFile(new URL('../v11-cockpit.css', import.meta.url), 'utf8');
  assert.match(css, /td\.position-code\{display:table-cell!important/);
});

async function frontend(extra = {}) {
  const context = vm.createContext({ console, Response, Headers, setTimeout, clearTimeout, AbortController, Date, ...extra });
  for (const file of ['quote-diagnostics.js', 'script.part2.js']) {
    vm.runInContext(await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  }
  return context;
}

test('HTTP 400 explains portfolio mismatch in Chinese', async () => {
  const ctx = await frontend();
  const error = await ctx.quoteHttpError(new Response(JSON.stringify({ error: 'Only current portfolio symbols may be requested', symbols: ['MSTU'] }), { status: 400 }));
  assert.equal(error.status, 400);
  assert.match(error.message, /持仓名单尚未同步：MSTU/);
});

test('closing refresh shares one pending request across repeated clicks', async () => {
  const ctx = await frontend({ priceRefreshPromise: null, marketClockState: {} });
  let calls = 0, finish;
  ctx.doRefreshLastClosePrices = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = ctx.refreshLastClosePrices();
  for (let n = 0; n < 100; n++) assert.equal(ctx.refreshLastClosePrices(), first);
  assert.equal(calls, 1);
  finish(); await first;
  assert.equal(ctx.priceRefreshPromise, null);
});

test('diagnostic request history is bounded and does not perform network requests', async () => {
  const ctx = await frontend({ fetch() { assert.fail('diagnostics must not fetch'); } });
  for (let n = 0; n < 100; n++) ctx.recordQuoteRequest({ status: 200, symbols: ['NVDA'] });
  assert.equal(vm.runInContext('quoteRequestHistory.length', ctx), 20);
});

test('partial quote response updates valid prices and keeps missing positions unchanged', async () => {
  const items = [{ symbol: 'NVDA', price: 200 }, { symbol: 'NEW', price: 10, priceUpdatedAt: 'old' }];
  const ctx = await frontend({ automaticQuoteGroups: () => [items], num: x => Number(x || 0), lastMarketError: '', lastQuoteWarnings: '', lastMarketRoute: 'proxy', lastMarketProvider: '' });
  ctx.fetchQuoteBatchResilient = async () => ({ NVDA: { close: '230', datetime: '2026-09-04', source: 'finnhub' } });
  assert.equal(await ctx.refreshAutomaticQuoteGroups('last-close'), 1);
  assert.equal(items[0].price, 230); assert.equal(items[1].price, 10);
  assert.equal(items[1].priceUpdatedAt, 'old');
  assert.match(ctx.lastQuoteWarnings, /NEW/);
});

test('static fallback is not labelled as a newly fetched close', async () => {
  const items = [{ symbol: 'NVDA', price: 200 }];
  const ctx = await frontend({ automaticQuoteGroups: () => [items], num: x => Number(x || 0), lastMarketError: '', lastQuoteWarnings: '', lastMarketRoute: 'static', lastMarketProvider: '' });
  ctx.fetchQuoteBatchResilient = async () => ({ NVDA: { close: '230', datetime: '2026-09-03', source: 'finnhub' } });
  await ctx.refreshAutomaticQuoteGroups('last-close');
  assert.equal(items[0].priceSource, 'static');
});

test('full regular-session scheduled budget: 624 Twelve symbol credits and 78 bundle writes', async (t) => {
  t.mock.method(console, 'log', () => {});
  const symbols = ['NVDA','RKLB','SPCX','GOOGL','MU','MRVL','AAOI','SPCH'];
  let credits = 0, writes = 0, fallbackCalls = 0, now;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const target = new URL(String(url));
    if (target.hostname === 'myh88.com') return Response.json({ positions: symbols.map(symbol => ({ symbol, source: 'twelve' })) });
    if (target.hostname === 'api.twelvedata.com') {
      const requested = target.searchParams.get('symbol').split(','); credits += requested.length;
      return Response.json(Object.fromEntries(requested.map(symbol => [symbol, { symbol, close: '100', timestamp: now / 1000 }])));
    }
    fallbackCalls++; throw new Error('unexpected fallback');
  });
  const env = { TWELVE_DATA_KEY: 'mock-configured-key', MYH88_CACHE: {
    async get() { return null; }, async put() { writes++; },
  } };
  for (let n = 0; n < 78; n++) {
    now = Date.parse('2026-09-04T13:30:00Z') + n * 300_000;
    await worker.scheduled({ scheduledTime: now }, env, context);
  }
  assert.equal(credits, 624); assert.equal(writes, 78); assert.equal(fallbackCalls, 0);
});
