import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");
const count = (source, pattern) => [...source.matchAll(pattern)].length;

test("V11.7 loads one visual stylesheet and one visual motion layer", async () => {
  const index = await read("../index.html");
  assert.equal(count(index, /brand-v11\.7\.css/g), 1);
  assert.equal(count(index, /brand-v11\.7\.js/g), 1);
});

test("V11.7 preserves the public functional shell", async () => {
  const index = await read("../index.html");
  for (const id of [
    "refreshButton", "installAppButton", "syncStrip", "allocationMap",
    "analytics", "ledgerPanel", "dcaZone", "treemap", "mapHoldingBody",
  ]) {
    assert.equal(count(index, new RegExp(`id=["']${id}["']`, "g")), 1, `${id} must occur once`);
  }
  assert.match(index, /onclick="refreshPricesSmart\(\)"/);
  assert.match(index, /onclick="installApp\(\)"/);
});

test("V11.7 hooks the real dashboard surfaces into the new visual skeleton", async () => {
  const [index, css] = await Promise.all([
    read("../index.html"),
    read("../brand-v11.7.css"),
  ]);
  for (const hook of [
    "v117-container", "v117-hero", "v117-kpi-deck", "v117-map-layout",
    "v117-map-shell", "v117-position-panel", "v117-return-shell",
    "v117-ledger", "v117-dca", "v117-closing",
  ]) {
    assert.match(index, new RegExp(`class=\"[^\"]*${hook}`), `missing ${hook} in index.html`);
    assert.match(css, new RegExp(`\\.${hook}\\b`), `missing .${hook} in brand-v11.7.css`);
  }
});

test("V11.7 defines the green archive visual contract", async () => {
  const css = await read("../brand-v11.7.css");
  for (const token of [
    "--v117-canvas", "--v117-surface", "--v117-ink", "--v117-green",
    "--v117-gain", "--v117-loss", "--v117-map-gap", "font-variant-numeric",
  ]) assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), token);
  assert.match(css, /#treemap/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("V11.7 keeps the photo composition readable across desktop and mobile", async () => {
  const css = await read("../brand-v11.7.css");
  assert.match(css, /\.v117-hero\s+\.brand-hero-media\s*\{[^}]*transform:\s*scale\(/s);
  assert.match(css, /\.v117-hero-copy\s*\{[^}]*width:\s*min\(620px,/s);
  assert.match(css, /@media\s*\(min-width:\s*701px\)[\s\S]*?\.v117-closing\s+\.brand-closing-media\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(css, /@media\s*\(max-width:\s*700px\)[\s\S]*?\.v117-closing\s+\.brand-closing-media\s*\{[^}]*object-fit:\s*cover/s);
});

test("V11.7 uses the China-market red-up green-down convention", async () => {
  const [css, runtime] = await Promise.all([
    read("../brand-v11.7.css"),
    read("../script.part1.js"),
  ]);
  assert.match(runtime, /function cls\(v\)\{return num\(v\)>0\?"red":num\(v\)<0\?"green":"muted"\}/);
  assert.match(css, /\.red,\s*\.gain,\s*\.positive,\s*\.pnl-positive\s*\{\s*color:\s*var\(--v117-gain\)/);
  assert.match(css, /\.green,\s*\.loss,\s*\.negative,\s*\.pnl-negative\s*\{\s*color:\s*var\(--v117-loss\)/);
});

test("V11.7 motion layer is observer based and non-blocking", async () => {
  const js = await read("../brand-v11.7.js");
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /prefers-reduced-motion/);
  assert.doesNotMatch(js, /addEventListener\(["']scroll["']/);
  assert.doesNotMatch(js, /setInterval\(/);
});

test("V11.7 map renderer exposes stable visual metadata", async () => {
  const source = await read("../script.part3.js");
  for (const attribute of ["data-symbol", "data-sector", "data-tile-size", "tabIndex"]) {
    assert.match(source, new RegExp(attribute));
  }
  assert.match(source, /aria-label/);
});

test("V11.7 release fingerprint is consistent and keeps Worker 10.56", async () => {
  const [index, runtime, worker, meta, pkg] = await Promise.all([
    read("../index.html"),
    read("../script.part1.js"),
    read("../service-worker.js"),
    read("../build-meta.json"),
    read("../package.json"),
  ]);
  assert.match(runtime, /const VERSION=["']V11\.7\.1 果园生长版["']/);
  assert.match(runtime, /const RELEASE=["']11\.7\.1["']/);
  assert.match(worker, /const RELEASE=["']11\.7\.1["']/);
  assert.match(worker, /brand-v11\.7\.css/);
  assert.match(worker, /brand-v11\.7\.js/);
  for (const [name, version] of Object.entries({
    "script.part1.js": "11.7.1",
    "script.part2.js": "11.6.0",
    "script.part3.js": "11.7.1",
    "script.part4.js": "11.7.1",
    "script.part5.js": "11.6.0",
    "script.part6.js": "11.6.0",
  })) {
    const escaped = name.replaceAll(".", "\\.");
    assert.match(index, new RegExp(`${escaped}\\?v=${version.replaceAll(".", "\\.")}`));
    assert.match(worker, new RegExp(`\\./${escaped}\\?v=${version.replaceAll(".", "\\.")}`));
  }
  assert.match(meta, /"release":\s*"11\.7\.1"/);
  assert.match(meta, /"worker":\s*"10\.56"/);
  assert.match(pkg, /"version":\s*"11\.7\.1"/);
});

test("ledger summary ships as a separately cached runtime chunk", async () => {
  const [index, worker] = await Promise.all([
    read("../index.html"),
    read("../service-worker.js"),
  ]);

  assert.match(index, /ledger-summary-v11\.7\.js\?v=11\.7\.1/);
  assert.match(worker, /\.\/ledger-summary-v11\.7\.js\?v=11\.7\.1/);
});
