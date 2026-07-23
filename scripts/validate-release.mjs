import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(await readFile(resolve(root, "build-meta.json"), "utf8"));
const scriptParts = ["script.part1.js", "script.part2.js", "script.part3.js", "script.part4.js"];
const files = Object.fromEntries(await Promise.all(
  ["index.html", "service-worker.js", "cloudflare-worker.js", ...scriptParts]
    .map(async (name) => [name, await readFile(resolve(root, name), "utf8")]),
));
const frontendSource = scriptParts.map((name) => files[name]).join("");

assert.equal(meta.release, "10.47");
for (const name of scriptParts) {
  assert.match(files["index.html"], new RegExp(`${name.replace(".", "\\.")}\\?v=10\\.47`));
  assert.ok((await stat(resolve(root, name))).size < 30_000, `${name} exceeds direct-publish limit`);
}
assert.match(files["index.html"], /myh88-core\.js\?v=10\.47/);
assert.match(frontendSource, /const VERSION="V10\.47 PWA家庭版"/);
assert.match(files["service-worker.js"], /const RELEASE="10\.47"/);
assert.match(files["cloudflare-worker.js"], /const WORKER_VERSION = "10\.47"/);
console.log("Release fingerprint is consistent: 10.47");
