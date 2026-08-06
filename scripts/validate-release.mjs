import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(await readFile(resolve(root, "build-meta.json"), "utf8"));
const scriptParts = ["script.part1.js", "script.part2.js", "script.part3.js", "script.part4.js", "script.part5.js"];
const files = Object.fromEntries(await Promise.all(
  ["index.html", "service-worker.js", "cloudflare-worker.js", ...scriptParts]
    .map(async (name) => [name, await readFile(resolve(root, name), "utf8")]),
));
const frontendSource = scriptParts.map((name) => files[name]).join("");

assert.equal(meta.release, "10.49");
for (const name of scriptParts) {
  assert.match(files["index.html"], new RegExp(`${name.replace(".", "\\.")}\\?v=10\\.49`));
  assert.ok((await stat(resolve(root, name))).size < 30_000, `${name} exceeds direct-publish limit`);
}
assert.match(files["index.html"], /myh88-core\.js\?v=10\.49/);
assert.match(files["index.html"], /returns-v10\.49\.css\?v=10\.49/);
assert.doesNotMatch(files["index.html"], /资产成长记录/);
assert.match(frontendSource, /const VERSION="V10\.49 PWA家庭版"/);
assert.match(files["service-worker.js"], /const RELEASE="10\.49"/);
assert.match(files["cloudflare-worker.js"], new RegExp(`const WORKER_VERSION = "${meta.worker.replace(".", "\\.")}"`));
console.log("Release fingerprint is consistent: 10.49 (Worker 10.47 unchanged)");
