import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(await readFile(resolve(root, "build-meta.json"), "utf8"));
const files = Object.fromEntries(await Promise.all(
  ["index.html", "script.js", "service-worker.js", "cloudflare-worker.js"]
    .map(async (name) => [name, await readFile(resolve(root, name), "utf8")]),
));

assert.equal(meta.release, "10.47");
assert.match(files["index.html"], /script\.js\?v=10\.47/);
assert.match(files["index.html"], /myh88-core\.js\?v=10\.47/);
assert.match(files["script.js"], /const VERSION="V10\.47 PWA家庭版"/);
assert.match(files["service-worker.js"], /const RELEASE="10\.47"/);
assert.match(files["cloudflare-worker.js"], /const WORKER_VERSION = "10\.47"/);
console.log("Release fingerprint is consistent: 10.47");
