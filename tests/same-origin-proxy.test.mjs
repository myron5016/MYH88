import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestGet } from "../functions/api/[[path]].js";

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

test("Pages 桥接精确转发 logos JSON 与 logo 二进制响应", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), accept: init.headers.Accept });
    if (String(url).includes("/logos?")) {
      return new Response(JSON.stringify({ logos: {} }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": "3",
        ETag: '"edge-logo"',
        "Cache-Control": "public, max-age=2592000",
      },
    });
  };
  try {
    const metadata = await onRequestGet({
      params: { path: ["logos"] },
      request: new Request("https://myh88.com/api/logos?symbols=NVDA"),
    });
    assert.equal(metadata.status, 200);
    assert.match(metadata.headers.get("Cache-Control"), /no-store/);

    const image = await onRequestGet({
      params: { path: ["logo", "BRK.B"] },
      request: new Request("https://myh88.com/api/logo/BRK.B", { headers: { Accept: "image/avif,image/webp" } }),
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("Content-Type"), "image/png");
    assert.equal(image.headers.get("Content-Length"), "3");
    assert.equal(image.headers.get("ETag"), '"edge-logo"');
    assert.equal(image.headers.get("Cache-Control"), "public, max-age=2592000");
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [1, 2, 3]);
    assert.deepEqual(calls, [
      { url: "https://quote.myh88.com/logos?symbols=NVDA", accept: "application/json" },
      { url: "https://quote.myh88.com/logo/BRK.B", accept: "image/avif,image/webp" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages 桥接拒绝未授权多段路由、穿越和编码斜杠", async () => {
  for (const path of [
    ["logo", "NVDA", "extra"],
    ["logo", ".."],
    ["logo", "%2FSECRET"],
    ["other", "NVDA"],
  ]) {
    const response = await onRequestGet({
      params: { path },
      request: new Request(`https://myh88.com/api/${path.join("/")}`),
    });
    assert.equal(response.status, 404, path.join("/"));
  }
});
