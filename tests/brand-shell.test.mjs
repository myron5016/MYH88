import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");
const count = (source, pattern) => [...source.matchAll(pattern)].length;

test("V11.6 brand shell preserves functional anchors", async () => {
  const index = await read("../index.html");
  for (const id of [
    "refreshButton", "installAppButton", "diagnosticsStrip", "versionStatus",
    "marketRouteStatus", "marketClockStatus", "cloudFreshStatus", "syncStrip",
    "allocationMap", "analytics", "ledgerPanel", "dcaZone",
  ]) {
    assert.equal(count(index, new RegExp(`id=["']${id}["']`, "g")), 1, `${id} must occur once`);
  }
  assert.match(index, /onclick="refreshPricesSmart\(\)"/);
  assert.match(index, /onclick="installApp\(\)"/);
});

test("V11.6 brand shell contains photo Hero and closing page", async () => {
  const index = await read("../index.html");
  assert.match(index, /class="[^"]*\bbrand-hero\b[^"]*"/);
  assert.match(index, /assets\/hero-orchard\.jpg/);
  assert.match(index, /class="[^"]*\bbrand-closing\b[^"]*\breveal-on-enter\b[^"]*"/);
  assert.match(index, /assets\/closing-path\.jpg/);
  assert.match(index, /把今天的认真，留给她的未来。/);
  assert.doesNotMatch(index, /<footer class="footer">/);
});

test("brand motion uses observer and supports reduced motion", async () => {
  const [css, js] = await Promise.all([
    read("../brand-v11.6.css"),
    read("../brand-v11.6.js"),
  ]);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /100dvh/);
  assert.match(js, /IntersectionObserver/);
  assert.doesNotMatch(js, /addEventListener\(["']scroll["']/);
});

test("service worker pre-caches the new brand shell", async () => {
  const worker = await read("../service-worker.js");
  for (const asset of [
    "brand-v11.6.css", "brand-v11.6.js",
    "assets/hero-orchard.jpg", "assets/closing-path.jpg",
  ]) assert.match(worker, new RegExp(asset.replaceAll(".", "\\.")));
});
