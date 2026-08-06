import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(await readFile(resolve(root, "build-meta.json"), "utf8"));
const scriptParts = ["script.part1.js", "script.part2.js", "script.part3.js", "script.part4.js", "script.part5.js", "script.part6.js"];
const files = Object.fromEntries(await Promise.all(
  ["index.html", "service-worker.js", "cloudflare-worker.js", "myh88-core.js", ...scriptParts]
    .map(async (name) => [name, await readFile(resolve(root, name), "utf8")]),
));
const frontendSource = scriptParts.map((name) => files[name]).join("");

assert.equal(meta.release, "10.55");
for (const name of scriptParts) {
  assert.match(files["index.html"], new RegExp(`${name.replace(".", "\\.")}\\?v=10\\.55`));
  assert.ok((await stat(resolve(root, name))).size < 30_000, `${name} exceeds direct-publish limit`);
}
assert.match(files["index.html"], /myh88-core\.js\?v=10\.55/);
assert.match(files["index.html"], /returns-v10\.49\.css\?v=10\.55/);
assert.match(files["index.html"], /dca-v10\.53\.css\?v=10\.55/);
assert.doesNotMatch(files["index.html"], /资产成长记录/);
assert.doesNotMatch(files["index.html"], /dcaMonthStatus|还差 \$/);
assert.ok(files["index.html"].indexOf('id="dcaZone"') > files["index.html"].indexOf('id="ledgerPanel"'), "Recurring investment zone must stay below the Dream Fund ledger");
assert.match(files["index.html"], /个股收益率曲线/);
assert.match(files["index.html"], /仅统计梦想金库主动持仓/);
assert.match(files["index.html"], /id="dcaReturnChart"/);
assert.match(frontendSource, /activeReturnSnapshots/);
assert.match(files["myh88-core.js"], /buildDcaReturnSeries/);
assert.match(frontendSource, /const VERSION="V10\.55 PWA家庭版"/);
assert.match(files["service-worker.js"], /const RELEASE="10\.55"/);
assert.match(files["cloudflare-worker.js"], new RegExp(`const WORKER_VERSION = "${meta.worker.replace(".", "\\.")}"`));
console.log("Release fingerprint is consistent: 10.55 (Worker 10.52 unchanged)");
