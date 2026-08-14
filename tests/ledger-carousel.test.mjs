import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const LEDGER_PAGES = ["overview", "transactions", "positions", "cashflows", "backup"];

function extractFunctionBody(source, functionName) {
  const signatureStart = source.indexOf(`function ${functionName}`);
  if (signatureStart < 0) throw new Error(`Missing function: ${functionName}`);
  const bodyStart = source.indexOf("{", signatureStart);
  if (bodyStart < 0) throw new Error(`Missing function body: ${functionName}`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (["'", "\"", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  throw new Error(`Unclosed function body: ${functionName}`);
}

function extractPaneFragment(html, page) {
  const marker = `data-ledger-pane="${page}"`;
  const start = html.lastIndexOf("<", html.indexOf(marker));
  const nextPane = html.indexOf("data-ledger-pane=", start + marker.length);
  const boundary = nextPane < 0 ? html.length : html.lastIndexOf("<", nextPane);
  return html.slice(start, boundary);
}

function extractTableOpeningTag(fragment, boundary) {
  return fragment.match(new RegExp(`<table\\b(?=[^>]*data-holdings-table="${boundary}")[^>]*>`))?.[0] || "";
}

test("ledger structure declares exact navigation and pane order", async () => {
  const [html, controller, renderer, brandCss] = await Promise.all([
    read("index.html"),
    read("script.part3.js"),
    read("script.part4.js"),
    read("brand-v11.7.css"),
  ]);
  const navigationPages = [...html.matchAll(/<(?:button|a)[^>]*data-ledger-page="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  const panePages = [...html.matchAll(/<[^>]*data-ledger-pane="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  const renderAllBody = extractFunctionBody(renderer, "renderAll");

  assert.deepEqual(navigationPages, LEDGER_PAGES);
  assert.deepEqual(panePages, LEDGER_PAGES);
  assert.match(html, /id="ledgerCarousel"/);
  assert.match(html, /id="ledgerOverviewPane"/);
  assert.match(html, />持仓批次管理</);
  assert.match(brandCss, /\.ledger-carousel/);
  assert.match(controller, /function renderLedgerOverview\(\)/);
  assert.match(renderAllBody, /renderLedgerOverview\(\)/);
  assert.match(renderAllBody, /switchLedgerTab\(activeLedgerTab/);
});

test("ledger page permissions expose exact visitor and administrator matrices", async () => {
  const [html, controller] = await Promise.all([read("index.html"), read("script.part3.js")]);
  const switchBody = extractFunctionBody(controller, "switchLedgerTab");
  assert.match(controller, /const PUBLIC_LEDGER_PAGES=\["overview","transactions"\]/);
  assert.match(controller, /const ADMIN_LEDGER_PAGES=\["overview","transactions","positions","cashflows","backup"\]/);
  assert.match(controller, /activeLedgerTab="overview"/);
  assert.match(switchBody, /allowedLedgerPages\(\)/);
  assert.match(switchBody, /pages\.includes\(page\)/);
  assert.match(switchBody, /page\s*=\s*["']overview["']/);

  for (const page of ["overview", "transactions"]) {
    const tag = html.match(new RegExp(`<[^>]+data-ledger-page="${page}"[^>]*>`))?.[0] || "";
    assert.doesNotMatch(tag, /admin-only/, `${page} navigation must remain public`);
  }
  for (const page of ["positions", "cashflows", "backup"]) {
    const tag = html.match(new RegExp(`<[^>]+data-ledger-page="${page}"[^>]*>`))?.[0] || "";
    assert.match(tag, /admin-only/, `${page} navigation must be admin-only`);
    assert.match(html, new RegExp(`data-ledger-pane="${page}"[^>]*admin-only`), `${page} pane must be admin-only`);
  }
});

test("holdings tables have explicit public and admin boundaries", async () => {
  const html = await read("index.html");
  const publicMapStart = html.indexOf('<section id="allocationMap"');
  const publicMapEnd = html.indexOf('<section id="analytics"', publicMapStart);
  const publicMap = html.slice(publicMapStart, publicMapEnd < 0 ? html.length : publicMapEnd);
  const positionsPane = extractPaneFragment(html, "positions");
  const publicTables = [...publicMap.matchAll(/<table\b(?=[^>]*data-holdings-table="public")[^>]*>/g)].map((match) => match[0]);
  const adminTables = [...positionsPane.matchAll(/<table\b(?=[^>]*data-holdings-table="admin")[^>]*>/g)].map((match) => match[0]);
  const publicTable = extractTableOpeningTag(publicMap, "public");
  const adminTable = extractTableOpeningTag(positionsPane, "admin");

  assert.equal(publicTables.length, 1);
  assert.equal(adminTables.length, 1);
  assert.equal((html.match(/data-holdings-table=/g) || []).length, 2);
  assert.match(publicTable, /data-holdings-table="public"/);
  assert.match(publicMap, /data-holdings-table="public"[\s\S]*?id="mapHoldingBody"/);
  assert.match(adminTable, /data-holdings-table="admin"/);
  assert.match(positionsPane, /admin-only/);
  assert.match(positionsPane, /data-holdings-table="admin"[\s\S]*?id="positionBody"/);
});

test("carousel handlers use explicit gesture guards and navigation interfaces", async () => {
  const [html, controller, renderer] = await Promise.all([read("index.html"), read("script.part3.js"), read("script.part4.js")]);
  const guardBody = extractFunctionBody(controller, "isLedgerGestureBlocked");
  const initBody = extractFunctionBody(controller, "initLedgerCarousel");
  const switchBody = extractFunctionBody(controller, "switchLedgerTab");
  const dotPages = [...html.matchAll(/<button[^>]*data-ledger-dot="([^"]+)"[^>]*>/g)].map((match) => match[1]);

  for (const excludedTarget of [".table-wrap", "input", "select", "button", "dialog"]) {
    assert.match(guardBody, new RegExp(excludedTarget.replace(".", "\\.")), `${excludedTarget} must be blocked by the helper`);
  }
  assert.match(switchBody, /allowedLedgerPages\(\)/);
  assert.match(switchBody, /pages\.includes\(page\)/);
  assert.match(switchBody, /page\s*=\s*["']overview["']/);
  assert.match(initBody, /touchstart[\s\S]*isLedgerGestureBlocked\(/);
  assert.match(initBody, /touchend[\s\S]*isLedgerGestureBlocked\(/);
  assert.match(initBody, /ArrowLeft[\s\S]*shiftLedgerPage\(-1\)/);
  assert.match(initBody, /ArrowRight[\s\S]*shiftLedgerPage\(1\)/);
  assert.match(controller, /function shiftLedgerPage\(direction\)/);
  assert.match(html, /onclick="shiftLedgerPage\(-1\)"/);
  assert.match(html, /onclick="shiftLedgerPage\(1\)"/);
  assert.deepEqual(dotPages, LEDGER_PAGES);
  for (const page of LEDGER_PAGES) {
    assert.match(html, new RegExp(`data-ledger-dot="${page}"[^>]*onclick="switchLedgerTab\\(['"]${page}['"]\\)"`));
  }
  assert.match(renderer, /initLedgerCarousel\(\)/);
});
