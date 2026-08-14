import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const LEDGER_PAGES = ["overview", "transactions", "positions", "cashflows", "backup"];

test("ledger structure declares exact navigation and pane order", async () => {
  const [html, controller, renderer, brandCss] = await Promise.all([
    read("index.html"),
    read("script.part3.js"),
    read("script.part4.js"),
    read("brand-v11.7.css"),
  ]);
  const navigationPages = [...html.matchAll(/<(?:button|a)[^>]*data-ledger-page="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  const panePages = [...html.matchAll(/<[^>]*data-ledger-pane="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  const renderAllStart = renderer.indexOf("function renderAll");
  const renderAllEnd = renderer.indexOf("function hasAdminSession", renderAllStart);
  const renderAllSource = renderer.slice(renderAllStart, renderAllEnd);

  assert.deepEqual(navigationPages, LEDGER_PAGES);
  assert.deepEqual(panePages, LEDGER_PAGES);
  assert.match(html, /id="ledgerCarousel"/);
  assert.match(html, /id="ledgerOverviewPane"/);
  assert.match(html, />持仓批次管理</);
  assert.match(brandCss, /\.ledger-carousel/);
  assert.match(controller, /function renderLedgerOverview\(\)/);
  assert.match(renderAllSource, /renderLedgerOverview\(\)/);
  assert.match(renderAllSource, /switchLedgerTab\(activeLedgerTab/);
});

test("ledger page permissions expose exact visitor and administrator matrices", async () => {
  const [html, controller] = await Promise.all([read("index.html"), read("script.part3.js")]);
  assert.match(controller, /const PUBLIC_LEDGER_PAGES=\["overview","transactions"\]/);
  assert.match(controller, /const ADMIN_LEDGER_PAGES=\["overview","transactions","positions","cashflows","backup"\]/);
  assert.match(controller, /activeLedgerTab="overview"/);
  assert.match(controller, /const pages=allowedLedgerPages\(\)/);
  assert.match(controller, /!pages\.includes\(page\)/);
  assert.match(controller, /page="overview"/);

  for (const page of ["overview", "transactions"]) {
    const tag = html.match(new RegExp(`<[^>]+data-ledger-page="${page}"[^>]*>`))?.[0] || "";
    assert.doesNotMatch(tag, /admin-only/, `${page} navigation must remain public`);
  }
  for (const page of ["positions", "cashflows", "backup"]) {
    const tag = html.match(new RegExp(`<[^>]+data-ledger-page="${page}"[^>]*>`))?.[0] || "";
    assert.match(tag, /admin-only/, `${page} navigation must be admin-only`);
  }
  for (const page of ["positions", "cashflows", "backup"]) {
    assert.match(html, new RegExp(`data-ledger-pane="${page}"[^>]*admin-only`), `${page} pane must be admin-only`);
  }
});

test("holdings tables have explicit public and admin boundaries", async () => {
  const html = await read("index.html");
  const publicTables = [...html.matchAll(/<[^>]*data-holdings-table="public"[^>]*>/g)].map((match) => match[0]);
  const adminTables = [...html.matchAll(/<[^>]*data-holdings-table="admin"[^>]*>/g)].map((match) => match[0]);
  const publicTableRegion = html.match(/<[^>]*data-holdings-table="public"[^>]*>[\s\S]*?<\/table>/)?.[0] || "";
  const adminPositionsRegion = html.match(/<[^>]*data-ledger-pane="positions"[^>]*admin-only[\s\S]*?<\/table>/)?.[0] || "";

  assert.equal(publicTables.length, 1);
  assert.equal(adminTables.length, 1);
  assert.equal((html.match(/data-holdings-table=/g) || []).length, 2);
  assert.match(publicTableRegion, /id="mapHoldingBody"/);
  assert.match(adminPositionsRegion, /id="positionsPane"/);
  assert.match(adminPositionsRegion, /id="positionBody"/);
  assert.match(adminPositionsRegion, /admin-only/);
});

test("carousel navigation binds controls, dots, and guarded gestures to explicit interfaces", async () => {
  const [html, controller, renderer] = await Promise.all([read("index.html"), read("script.part3.js"), read("script.part4.js")]);
  const guardStart = controller.indexOf("function isLedgerGestureBlocked(target)");
  const guardEnd = controller.indexOf("function ", guardStart + 1);
  const guardSource = controller.slice(guardStart, guardEnd < 0 ? undefined : guardEnd);
  const dotPages = [...html.matchAll(/<button[^>]*data-ledger-dot="([^"]+)"[^>]*>/g)].map((match) => match[1]);

  assert.ok(guardStart >= 0, "gesture guard helper must be explicit");
  for (const excludedTarget of [".table-wrap", "input", "select", "button", "dialog"]) {
    assert.match(guardSource, new RegExp(excludedTarget.replace(".", "\\.")), `${excludedTarget} must be blocked by the gesture helper`);
  }
  assert.match(controller, /function switchLedgerTab\(page, options\)/);
  assert.match(controller, /function shiftLedgerPage\(direction\)/);
  assert.match(controller, /function initLedgerCarousel\(\)/);
  assert.match(controller, /Math\.abs\(dx\)\s*[<>]=?\s*56/);
  assert.match(controller, /Math\.abs\(dx\)\s*[<>]=?\s*Math\.abs\(dy\)/);
  assert.match(controller, /ArrowLeft/);
  assert.match(controller, /ArrowRight/);
  assert.match(html, /onclick="shiftLedgerPage\(-1\)"/);
  assert.match(html, /onclick="shiftLedgerPage\(1\)"/);
  assert.deepEqual(dotPages, LEDGER_PAGES);
  for (const page of LEDGER_PAGES) {
    assert.match(html, new RegExp(`data-ledger-dot="${page}"[^>]*onclick="switchLedgerTab\\(['"]${page}['"]\\)"`));
  }
  assert.match(renderer, /initLedgerCarousel\(\)/);
});
