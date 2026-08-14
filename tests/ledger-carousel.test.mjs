import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("ledger structure declares the overview-first page order", async () => {
  const [html, controller, renderer, brandCss] = await Promise.all([
    read("index.html"),
    read("script.part3.js"),
    read("script.part4.js"),
    read("brand-v11.7.css"),
  ]);
  const pagePositions = ["overview", "transactions", "positions", "cashflows", "backup"].map((page) => html.indexOf(`data-ledger-page="${page}"`));

  assert.ok(pagePositions.every((position) => position >= 0), "all five ledger pages must be declared");
  assert.deepEqual(pagePositions, [...pagePositions].sort((a, b) => a - b), "ledger pages must stay in canonical order");
  assert.match(html, /id="ledgerCarousel"/);
  assert.match(html, /id="ledgerOverviewPane"/);
  assert.match(html, />持仓批次管理</);
  assert.match(brandCss, /\.v117-ledger/);
  assert.match(controller, /function renderLedgerOverview\(\)/);
  assert.match(renderer, /renderLedgerOverview\(\)/);
});

test("ledger page permissions expose the exact visitor and administrator matrices", async () => {
  const [html, controller] = await Promise.all([read("index.html"), read("script.part3.js")]);
  assert.match(controller, /const PUBLIC_LEDGER_PAGES=\["overview","transactions"\]/);
  assert.match(controller, /const ADMIN_LEDGER_PAGES=\["overview","transactions","positions","cashflows","backup"\]/);
  assert.match(controller, /activeLedgerTab="overview"/);

  for (const page of ["overview", "transactions"]) {
    const tag = html.match(new RegExp(`<[^>]+data-ledger-page="${page}"[^>]*>`))?.[0] || "";
    assert.doesNotMatch(tag, /admin-only/, `${page} must remain public`);
  }
  for (const page of ["positions", "cashflows", "backup"]) {
    const tag = html.match(new RegExp(`<[^>]+data-ledger-page="${page}"[^>]*>`))?.[0] || "";
    assert.match(tag, /admin-only/, `${page} navigation control must be admin-only`);
  }
  for (const pane of ["positionsPane", "cashflowsPane", "backupPane"]) {
    assert.match(html, new RegExp(`id="${pane}"[^>]*admin-only`), `${pane} must be admin-only`);
  }
});

test("the public holdings table is separate from the admin ledger positions page", async () => {
  const html = await read("index.html");
  const publicMap = html.match(/<section id="allocationMap"[\s\S]*?<tbody id="mapHoldingBody">[\s\S]*?<\/table>/)?.[0] || "";
  const ledgerPositions = html.match(/<div id="positionsPane"[\s\S]*?<div id="transactionsPane"/)?.[0] || "";

  assert.equal((html.match(/id="mapHoldingBody"/g) || []).length, 1);
  assert.match(publicMap, /class="map-holding-table"/);
  assert.match(publicMap, /id="mapHoldingBody"/);
  assert.doesNotMatch(publicMap, /id="ledgerPanel"/);
  assert.match(html, /id="positionsPane"[^>]*admin-only/);
  assert.match(ledgerPositions, /id="positionBody"/);
  assert.match(ledgerPositions, /class="compact-table"/);
});

test("ledger carousel exposes guarded touch and keyboard navigation", async () => {
  const [controller, renderer] = await Promise.all([read("script.part3.js"), read("script.part4.js")]);

  assert.match(controller, /function switchLedgerTab\(page, options\)/);
  assert.match(controller, /function shiftLedgerPage\(direction\)/);
  assert.match(controller, /function initLedgerCarousel\(\)/);
  const targetGuards = [...controller.matchAll(/(?:closest|matches)\(([^)]*)\)/g)].map((match) => match[1]).join(" ");
  assert.match(targetGuards, /\.table-wrap/);
  for (const excludedTarget of ["input", "select", "button", "dialog"]) {
    assert.match(targetGuards, new RegExp(`\\b${excludedTarget}\\b`), `${excludedTarget} must not trigger page shifts`);
  }
  assert.match(controller, /Math\.abs\(dx\)\s*[<>]=?\s*56/);
  assert.match(controller, /Math\.abs\(dx\)\s*[<>]=?\s*Math\.abs\(dy\)/);
  assert.match(controller, /ArrowLeft/);
  assert.match(controller, /ArrowRight/);
  assert.match(renderer, /initLedgerCarousel\(\)/);
});
