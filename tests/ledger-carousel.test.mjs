import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("ledger opens on overview and exposes lot management only to admins", async () => {
  const [html, controller] = await Promise.all([read("index.html"), read("script.part3.js")]);
  assert.match(html, /data-ledger-page="overview"/);
  assert.match(html, /data-ledger-page="positions"[^>]*admin-only/);
  assert.match(html, />持仓批次管理</);
  assert.match(controller, /const PUBLIC_LEDGER_PAGES=\["overview","transactions"\]/);
  assert.match(controller, /activeLedgerTab="overview"/);
});

test("only one holdings table is public", async () => {
  const html = await read("index.html");
  assert.equal((html.match(/id="mapHoldingBody"/g) || []).length, 1);
  assert.match(html, /id="positionsPane"[^>]*admin-only/);
});
