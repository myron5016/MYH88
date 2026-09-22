import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const runtimeSource = await readFile(new URL("../security-logo.js", import.meta.url), "utf8");

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); },
  };
}

function fakeSlot(symbol) {
  const slot = {
    dataset: { logoSymbol: symbol },
    classList: classList(["logo-fallback-active"]),
    image: null,
    querySelector(selector) { return selector === "img" ? this.image : null; },
    appendChild(node) { this.image = node; node.parentElement = this; return node; },
  };
  slot.ownerDocument = {
    createElement(tag) {
      assert.equal(tag, "img");
      const listeners = new Map();
      return {
        src: "",
        alt: "",
        loading: "",
        decoding: "",
        addEventListener(type, handler, options = {}) { listeners.set(type, { handler, once: Boolean(options.once) }); },
        dispatch(type) {
          const entry = listeners.get(type);
          if (!entry) return;
          entry.handler({ type, target: this });
          if (entry.once) listeners.delete(type);
        },
        remove() {
          if (this.parentElement?.image === this) this.parentElement.image = null;
          this.parentElement = null;
        },
      };
    },
  };
  return slot;
}

function fakeRoot(slots) {
  return { querySelectorAll(selector) { return selector === "[data-logo-symbol]" ? slots : []; } };
}

function loadLogoRuntime() {
  const context = { console, URL, URLSearchParams, encodeURIComponent, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(runtimeSource, context, { filename: "security-logo.js" });
  return context.MYH88SecurityLogos;
}

function metadataResponse(logos, status = 200) {
  return new Response(JSON.stringify({ logos }), { status, headers: { "Content-Type": "application/json" } });
}

test("地图和表格的重复位置只触发一次批量请求", async () => {
  const slots = [fakeSlot("NVDA"), fakeSlot("NVDA"), fakeSlot("MSTU")];
  const fetches = [];
  const api = loadLogoRuntime();
  await api.hydrate(fakeRoot(slots), ["/api"], async (url) => {
    fetches.push(url);
    return metadataResponse({
      NVDA: { symbol: "NVDA", status: "verified", source: "finnhub", path: "/logo/NVDA" },
      MSTU: { symbol: "MSTU", status: "missing", source: "finnhub" },
    });
  });
  assert.deepEqual(fetches, ["/api/logos?symbols=NVDA%2CMSTU"]);
  assert.equal(slots[0].image.src, "/api/logo/NVDA");
  assert.equal(slots[1].image.src, "/api/logo/NVDA");
  assert.equal(slots[2].image, null);
});

test("并发 hydrate 共享同一个进行中请求", async () => {
  const slot = fakeSlot("NVDA");
  const api = loadLogoRuntime();
  let release;
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return new Promise((resolve) => {
      release = () => resolve(metadataResponse({
        NVDA: { symbol: "NVDA", status: "verified", source: "finnhub", path: "/logo/NVDA" },
      }));
    });
  };
  const first = api.hydrate(fakeRoot([slot]), ["/api"], fetchImpl);
  const second = api.hydrate(fakeRoot([slot]), ["/api"], fetchImpl);
  await Promise.resolve();
  assert.equal(fetchCount, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(slot.image.src, "/api/logo/NVDA");
});

test("第一个代理网络或 HTTP 失败后尝试第二个", async () => {
  const api = loadLogoRuntime();
  const calls = [];
  const records = await api.load(["NVDA"], ["/api", "https://quote.myh88.com"], async (url) => {
    calls.push(url);
    if (url.startsWith("/api/")) throw new Error("offline");
    return metadataResponse({
      NVDA: { symbol: "NVDA", status: "verified", source: "finnhub", path: "/logo/NVDA" },
    });
  });
  assert.deepEqual(calls, [
    "/api/logos?symbols=NVDA",
    "https://quote.myh88.com/logos?symbols=NVDA",
  ]);
  assert.equal(records.NVDA.imageUrl, "https://quote.myh88.com/logo/NVDA");

  api.resetForTests();
  calls.length = 0;
  const afterHttpFailure = await api.load(["NVDA"], ["/api", "https://quote.myh88.com"], async (url) => {
    calls.push(url);
    if (url.startsWith("/api/")) return metadataResponse({}, 502);
    return metadataResponse({ NVDA: { symbol: "NVDA", status: "missing", source: "finnhub" } });
  });
  assert.equal(calls.length, 2);
  assert.equal(afterHttpFailure.NVDA.status, "missing");
});

test("图片 error 后该元素永久回退为代码", async () => {
  const slot = fakeSlot("NVDA");
  const root = fakeRoot([slot]);
  const api = loadLogoRuntime();
  const fetchImpl = async () => metadataResponse({
    NVDA: { symbol: "NVDA", status: "verified", source: "finnhub", path: "/logo/NVDA" },
  });
  await api.hydrate(root, ["/api"], fetchImpl);
  const failedImage = slot.image;
  failedImage.dispatch("error");
  assert.equal(slot.image, null);
  assert.equal(slot.classList.contains("logo-fallback-active"), true);
  assert.equal(slot.dataset.logoFailed, "true");
  await api.hydrate(root, ["/api"], fetchImpl);
  assert.equal(slot.image, null);
});

test("CASH、非法代码和未知代码都保留可读回退", async () => {
  const slots = [fakeSlot("CASH"), fakeSlot("../BAD"), fakeSlot("FUTURE")];
  const calls = [];
  const api = loadLogoRuntime();
  await api.hydrate(fakeRoot(slots), ["/api"], async (url) => {
    calls.push(url);
    return metadataResponse({ FUTURE: { symbol: "FUTURE", status: "missing", source: "finnhub" } });
  });
  assert.deepEqual(calls, ["/api/logos?symbols=FUTURE"]);
  assert.equal(slots.every((slot) => slot.image === null), true);
  assert.equal(slots.every((slot) => slot.classList.contains("logo-fallback-active")), true);
});
