import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, '.wrangler/quote-ui-check');
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
    document.body.classList.remove('viewer-mode');
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    quoteIssues[state.positions[0].symbol] = '持仓名单尚未同步，保留原价';
    recordQuoteRequest({ symbols: ['MSTU'], mode: 'last-close', status: 400, elapsed: 130, error: '持仓名单尚未同步：MSTU' });
    renderAll();
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.map-holding-table').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.map-holding-table').closest('section,article,.card')).opacity === '1');
    const rows = await page.locator('.map-holding-table tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].filter(c => getComputedStyle(c).display !== 'none').map(c => ({ bottom: c.getBoundingClientRect().bottom, display: getComputedStyle(c).display }))));
    assert.ok(rows.length > 0);
    for (const cells of rows) {
      assert.equal(cells[0].display, 'table-cell');
      assert.ok(Math.max(...cells.map(c => c.bottom)) - Math.min(...cells.map(c => c.bottom)) < 1, 'cell borders must align');
    }
    await page.screenshot({ path: resolve(output, `holdings-${width}.png`) });
    await page.locator('#quoteDiagnosticDetails').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `diagnostics-${width}.png`) });
    assert.ok(await page.locator('#quoteDiagnosticDetails').isVisible());
    console.log(JSON.stringify({ width, rows: rows.length, aligned: true }));
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
