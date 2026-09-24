import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, '.wrangler/short-ui-check');
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
  if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.map-holding-table tbody tr').length > 0);

  await page.evaluate(() => {
    isAdminMode = true;
    state = structuredClone(defaultState);
    state.cashFlows = [{id:"test-cash",type:"deposit",date:"2026-01-01",amountUSD:10000}];
    document.body.classList.remove("viewer-mode");
    document.querySelectorAll(".admin-only").forEach(el=>el.classList.remove("hidden"));
    renderAll();
  });
  const alerts=[];page.on("dialog",async dialog=>{alerts.push(dialog.message());await dialog.dismiss();});
  async function trade(type,quantity,price) {
    await page.evaluate(type=>openTrade(type),type);
    await page.waitForTimeout(80);
    await page.locator("#tradeSymbol").fill("TQQQ");
    await page.locator("#tradeDate").fill("2026-09-25");
    await page.locator("#tradeShares").fill(String(quantity));
    await page.locator("#tradePrice").fill(String(price));
    await page.locator("#tradeFee").fill("1");
  }
  async function submit(){await page.locator("#tradeDialog button[type=submit]").click();}
  await trade("short",100,50);
  await submit();
  assert.equal(await page.evaluate(()=>state.positions[0].shares),-100);
  assert.equal(await page.evaluate(()=>MYH88Core.computeLedgerMetrics(state).cashBalance),14999);
  await page.evaluate(()=>{normalizeState(JSON.parse(JSON.stringify(state)));renderAll();});
  assert.equal(await page.evaluate(()=>state.positions[0].shares),-100);
  await trade("cover",40,45);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await page.screenshot({path:resolve(output,`cover-${width}.png`)});
  }
  assert.match(await page.locator("#tradePreview").innerText(),/198.6/);
  await submit();
  assert.equal(await page.evaluate(()=>state.positions[0].shares),-60);
  await trade("cover",61,40);
  await submit();
  assert.equal(await page.evaluate(()=>state.positions[0].shares),-60);
  assert.ok(alerts.length);
  await page.locator("#tradeShares").fill("60");
  await submit();
  assert.equal(await page.evaluate(()=>state.positions.length),0);
  assert.equal(await page.evaluate(()=>MYH88Core.computeLedgerMetrics(state).cashBalance),10797);
  assert.deepEqual(errors,[]);
  console.log("Browser PASS: short, normalized reload, partial cover, over-cover rejection, full cover; desktop/mobile screenshots.");
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
