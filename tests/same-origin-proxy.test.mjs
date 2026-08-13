import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("same-origin quote fallback is routed only to API paths", async () => {
  const [routes, functionSource, runtime, worker] = await Promise.all([
    read("../_routes.json"),
    read("../functions/api/[[path]].js"),
    read("../script.part1.js"),
    read("../cloudflare-worker.js"),
  ]);
  const parsedRoutes = JSON.parse(routes);
  assert.deepEqual(parsedRoutes, { version: 1, include: ["/api/*"], exclude: [] });
  assert.match(functionSource, /quote\.myh88\.com/);
  assert.match(functionSource, /params\?\.path/);
  assert.match(runtime, /DEFAULT_PRICE_PROXY_URLS=\["\/api","https:\/\/quote\.myh88\.com"\]/);
  assert.match(worker, /path !== "\/quotes"/);
  const serviceWorker = await read("../service-worker.js");
  assert.match(serviceWorker, /url\.pathname==="\/api"\|\|url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /fetch\(request,\{cache:"no-store"\}\)/);
});
