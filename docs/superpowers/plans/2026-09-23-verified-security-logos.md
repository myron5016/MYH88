# 真实证券 Logo 实施计划

> **供自动化开发代理使用：** 必须按任务逐项执行，并使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 技能。所有步骤均使用复选框跟踪。

**目标：** 用自动解析且经过验证的真实 Logo 替代近似图和硬编码持仓 Logo，同时为所有不支持的证券保留安全、清晰的股票代码回退。

**架构：** 现有 Cloudflare Worker 负责解析 Finnhub 公司资料，并把经过验证的元数据缓存在 `MYH88_CACHE`；受限图片接口只代理这些元数据中已确认的地址。浏览器端新增一个小型解析器，批量获取当前持仓 Logo，同时更新持仓地图和表格；任何解析或加载失败都继续显示股票代码缩写。

**技术栈：** Cloudflare Workers ES Modules、Cloudflare KV 与 Cache API、原生浏览器 JavaScript、Cloudflare Pages Functions、Node.js 20 内置测试框架。

**设计文档：** `docs/plans/2026-09-23-verified-security-logos-design.md`

## 全局约束

- 只展示来自 Finnhub 公司资料或人工核验例外配置的 Logo。
- ETF 产品 Logo 不可用时，不得用发行商 Logo 替代。
- `FINNHUB_API_KEY` 只能存在于 Worker 环境中。
- 强制使用 HTTPS，拒绝本地或私有地址，只接受图片内容，并把代理图片限制在 512 KiB 以内。
- 成功元数据缓存 30 天，缺失元数据缓存 24 小时。
- `CASH` 是唯一保留的应用自有 Logo；无法解析的上市证券显示股票代码缩写。
- 保存后的新持仓必须能自动解析，无需重新部署代码。

## 重点审查项

- 带点号或连字符的证券代码必须有效，但路径穿越和编码斜杠必须被拒绝；任务 2 覆盖这两类输入。
- 提供商可能返回资料记录但 `logo` 为空或格式错误；任务 1 必须将其缓存为 `missing`，不能标记为 `verified`。
- 上游可能声明合规的 `Content-Length`，实际响应却超过 512 KiB；任务 2 同时检查实际字节数。
- 地图和表格可能在同一渲染周期请求同一代码；任务 3 验证只发送一次元数据请求，并更新所有匹配位置。
- 刚新增但尚未保存的持仓还不在服务端持仓白名单中；任务 3 验证其在下次成功保存和部署前保持可读的代码回退。

---

## 文件职责

- `cloudflare-worker.js`：增加元数据规范化、KV 解析、可信图片代理和两条新路由。
- `functions/api/[[path]].js`：通过同源 Pages 桥接转发 `logos` 与 `logo/:symbol`，且不把图片响应转换成 JSON。
- `security-logo.js`：隔离浏览器端批量请求、缓存、DOM 更新和图片失败回退逻辑。
- `script.part3.js`：渲染惰性 Logo 位置并调用共享解析器，删除近似 Logo 映射。
- `index.html`：在 `script.part3.js` 之前加载 `security-logo.js`，并更新受影响资源指纹。
- `service-worker.js`：缓存新运行时文件并更新应用壳缓存版本。
- `tests/security-logo-worker.test.mjs`：验证 Worker 元数据和图片安全行为。
- `tests/security-logo.test.mjs`：使用最小 DOM 测试浏览器解析器。
- `tests/same-origin-proxy.test.mjs`：验证 Pages 桥接路由和二进制响应。
- `tests/brand-v11.7.test.mjs`：验证发布指纹并确认近似 Logo 映射已移除。

### 任务 1：真实 Logo 元数据解析与 KV 缓存

**文件：**

- 修改：`cloudflare-worker.js:1-150,465-510`
- 新建：`tests/security-logo-worker.test.mjs`

**接口：**

- 使用：`normalizeSymbols(value)`、`readSharedCache(env, key)`、`FINNHUB_BASE` 和 `env.FINNHUB_API_KEY`。
- 产出：`logoProfileCacheKey(symbol) -> string`、`normalizeLogoProfile(symbol, profile) -> LogoRecord`、`resolveLogoProfiles(env, symbols) -> Promise<Record<string, LogoRecord>>` 和 `GET /logos?symbols=...`。
- `LogoRecord` 为 `{symbol, status:"verified", source:"finnhub"|"override", name, upstreamUrl, cachedAt}` 或 `{symbol, status:"missing", source:"finnhub", cachedAt}`。公开 JSON 不得包含 `upstreamUrl`；已验证记录返回 `path:"/logo/<编码后的代码>"`。
- `VERIFIED_LOGO_OVERRIDES` 是初始为空、经过审核的 `{name, upstreamUrl}` 映射；`LOGO_SUPPRESSIONS` 收录 `MSTU` 等已知 ETF 或合成证券，直到产品自身 Logo 经过核验。

- [ ] **步骤 1：先编写会失败的元数据测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import worker, { logoProfileCacheKey, normalizeLogoProfile } from "../cloudflare-worker.js";

test("只把 HTTPS Finnhub Logo 规范化为已验证记录", () => {
  assert.deepEqual(normalizeLogoProfile("NVDA", {
    name: "NVIDIA Corp", logo: "https://static.example.test/nvda.png",
    marketCapitalization: 100,
  }), {
    symbol: "NVDA", status: "verified", source: "finnhub",
    name: "NVIDIA Corp", upstreamUrl: "https://static.example.test/nvda.png",
  });
  assert.equal(normalizeLogoProfile("MSTU", { name: "MSTU", logo: "" }).status, "missing");
  assert.equal(normalizeLogoProfile("MSTU", {
    name: "T-Rex 2X Long MSTR Daily Target ETF",
    logo: "https://issuer.example.test/logo.png",
    marketCapitalization: 0, finnhubIndustry: "", ipo: "",
  }).status, "missing");
  assert.equal(normalizeLogoProfile("BAD", { logo: "http://example.test/a.png" }).status, "missing");
  assert.equal(logoProfileCacheKey("nvda"), "logo:profile:v1:NVDA");
});

test("logos 路由分别缓存已验证和缺失资料", async () => {
  const records = new Map();
  const puts = [];
  const env = {
    FINNHUB_API_KEY: "server-secret",
    MYH88_CACHE: {
      async get(key) { return records.get(key) || null; },
      async put(key, value, options) { puts.push({ key, value: JSON.parse(value), options }); },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(
    String(url).includes("NVDA")
      ? { name: "NVIDIA Corp", logo: "https://static.example.test/nvda.png", marketCapitalization: 100 }
      : { name: "MSTU", logo: "" },
  ));
  try {
    const response = await worker.fetch(
      new Request("https://quote.myh88.com/logos?symbols=NVDA,MSTU"), env, { waitUntil() {} },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { logos: {
      NVDA: { symbol: "NVDA", status: "verified", source: "finnhub", name: "NVIDIA Corp", path: "/logo/NVDA" },
      MSTU: { symbol: "MSTU", status: "missing", source: "finnhub" },
    }});
    assert.deepEqual(puts.map((item) => item.options.expirationTtl).sort((a, b) => a - b), [86400, 2592000]);
  } finally { globalThis.fetch = originalFetch; }
});
```

- [ ] **步骤 2：运行测试，确认测试按预期失败**

运行：`node --test tests/security-logo-worker.test.mjs`

预期：失败，因为 `logoProfileCacheKey`、`normalizeLogoProfile` 和 `/logos` 尚不存在。

- [ ] **步骤 3：实现最小可用的元数据解析器**

新增常量 `LOGO_PROFILE_TTL_SECONDS = 30 * 24 * 60 * 60`、`LOGO_MISSING_TTL_SECONDS = 24 * 60 * 60` 和 `LOGO_BATCH_LIMIT = 24`。规范化函数只接受可解析的 `https:` 地址，并要求存在运营公司证据：`marketCapitalization > 0`，或 `ipo` 与 `finnhubIndustry` 同时非空。这样可防止把普通 ETF 发行商图标标成基金产品 Logo。

解析顺序为 `LOGO_SUPPRESSIONS`、`VERIFIED_LOGO_OVERRIDES`、Finnhub。仅在缓存未命中时请求 `${FINNHUB_BASE}/stock/profile2?symbol=<symbol>&token=<secret>`，把每条结果直接写入 KV，并在现有 `/quotes` 路由拦截之前处理 `/logos`。

```js
function publicLogoRecord(record) {
  if (record.status !== "verified") return { symbol: record.symbol, status: "missing", source: record.source };
  return { symbol: record.symbol, status: "verified", source: record.source, name: record.name, path: `/logo/${encodeURIComponent(record.symbol)}` };
}
```

- [ ] **步骤 4：补充非法批量请求与缓存命中测试**

断言空请求返回 400、超过 24 个规范化代码返回 400、重复代码只请求一次 Finnhub、例外配置不会请求 Finnhub、受抑制 ETF 即使返回发行商 Logo 也保持 `missing`、缓存命中时上游请求数为零。另需断言 JSON 正文不包含 API Key 或 `upstreamUrl`。

- [ ] **步骤 5：运行本任务测试**

运行：`node --test tests/security-logo-worker.test.mjs tests/worker-routing.test.mjs`

预期：全部通过。

- [ ] **步骤 6：提交元数据解析功能**

```bash
git add cloudflare-worker.js tests/security-logo-worker.test.mjs
git commit -m "feat: resolve verified security logo metadata"
```

### 任务 2：受限图片代理与同源桥接

**文件：**

- 修改：`cloudflare-worker.js`
- 修改：`functions/api/[[path]].js`
- 修改：`tests/security-logo-worker.test.mjs`
- 修改：`tests/same-origin-proxy.test.mjs`

**接口：**

- 使用：任务 1 缓存的 `LogoRecord`。
- 产出：`validateLogoUrl(value) -> URL|null`、`proxySecurityLogo(env, symbol) -> Promise<Response>`、`GET /logo/:symbol`，以及 Pages 路由 `/api/logos` 和 `/api/logo/:symbol`。

- [ ] **步骤 1：先编写会失败的图片代理测试**

```js
test("logo 路由只返回缓存记录指定的已验证图片", async () => {
  const record = { symbol: "BRK.B", status: "verified", source: "finnhub", name: "Berkshire Hathaway", upstreamUrl: "https://static.example.test/brkb.png" };
  const env = { MYH88_CACHE: { async get(key) { return key.endsWith("BRK.B") ? record : null; } } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), {
    headers: { "Content-Type": "image/png", "Content-Length": "4" },
  });
  try {
    const response = await worker.fetch(new Request("https://quote.myh88.com/logo/BRK.B"), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.match(response.headers.get("Cache-Control"), /max-age=2592000/);
  } finally { globalThis.fetch = originalFetch; }
});
```

增加拒绝用例：`localhost`、`127.0.0.1`、`[::1]`、私有 IPv4、带用户名或密码的 URL、非 HTTPS、缺失元数据、非图片内容、声明大小超过 512 KiB、实际正文超过 512 KiB、`../` 和 `%2F`。同时加入合法连字符代码测试。

- [ ] **步骤 2：运行测试，确认测试按预期失败**

运行：`node --test tests/security-logo-worker.test.mjs tests/same-origin-proxy.test.mjs`

预期：失败，因为 `/logo/:symbol` 和多段 Pages 转发尚未实现。

- [ ] **步骤 3：实现 URL 与图片校验**

`validateLogoUrl` 必须要求 `https:`、不得包含用户名或密码、端口只能为空或 `443`，并显式拒绝本地和私有主机。`proxySecurityLogo` 只能读取 `logo:profile:v1:<symbol>`，请求头使用 `Accept: image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*`，内容类型只允许 `image/(png|jpeg|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)`，同时检查声明长度和实际字节长度，并返回 `X-Content-Type-Options: nosniff`。

可用时使用 `caches.default`，缓存键只基于规范化证券代码；否则依靠 `Cache-Control: public, max-age=2592000, stale-while-revalidate=604800`。

- [ ] **步骤 4：扩展 Pages API 桥接**

将单段路径限制替换成精确路由解析：

```js
const singleRoutes = new Set(["", "quotes", "market-clock", "fx", "logos"]);
const isLogoImage = segments.length === 2 && segments[0] === "logo" && /^[A-Z0-9.-]{1,12}$/i.test(segments[1]);
if (!(segments.length <= 1 && singleRoutes.has(path)) && !isLogoImage) return notFound();
```

转发客户端 `Accept`，保留上游的 `Content-Type`、`Content-Length`、`ETag` 和 `Cache-Control`。仅 JSON 行情及元数据桥接响应使用 `no-store`；`/api/logo/:symbol` 图片响应不得强制 `no-store`。

- [ ] **步骤 5：运行局部和完整测试**

运行：`node --test tests/security-logo-worker.test.mjs tests/same-origin-proxy.test.mjs`

预期：全部通过。

运行：`npm test`

预期：全部通过，现有行情路由无回归。

- [ ] **步骤 6：提交安全图片代理**

```bash
git add cloudflare-worker.js functions/api/[[path]].js tests/security-logo-worker.test.mjs tests/same-origin-proxy.test.mjs
git commit -m "feat: proxy verified security logo images"
```

### 任务 3：浏览器批量加载、DOM 更新与代码回退

**文件：**

- 新建：`security-logo.js`
- 新建：`tests/security-logo.test.mjs`
- 修改：`script.part3.js:31-58,58-82`
- 修改：`script.part4.js:118-132`
- 修改：`index.html:468-478`

**接口：**

- 使用：`priceProxyUrls() -> string[]`、任务 1 的 `{logos: Record<string, PublicLogoRecord>}` 响应，以及任务 2 的图片路径。
- 产出：全局对象 `MYH88SecurityLogos`，包含 `normalizeSymbols(values)`、`load(symbols, proxyUrls, fetchImpl)`、`hydrate(root, proxyUrls, fetchImpl)` 和 `resetForTests()`。
- DOM 约定：所有非现金位置均为 `<span class="company-logo-card logo-fallback-active" data-logo-symbol="NVDA"><span class="logo-fallback">NV</span></span>`。

- [ ] **步骤 1：先编写会失败的浏览器解析器测试**

使用 `node:vm` 执行 `security-logo.js`，并提供伪造的 `document`、Logo 元素和 fetch 监视器。固定以下行为：

```js
test("地图和表格的重复位置只触发一次批量请求", async () => {
  const slots = [fakeSlot("NVDA"), fakeSlot("NVDA"), fakeSlot("MSTU")];
  const fetches = [];
  const api = loadLogoRuntime(slots);
  await api.hydrate(fakeRoot(slots), ["/api"], async (url) => {
    fetches.push(url);
    return new Response(JSON.stringify({ logos: {
      NVDA: { symbol: "NVDA", status: "verified", source: "finnhub", path: "/logo/NVDA" },
      MSTU: { symbol: "MSTU", status: "missing", source: "finnhub" },
    }}));
  });
  assert.deepEqual(fetches, ["/api/logos?symbols=NVDA%2CMSTU"]);
  assert.equal(slots[0].image.src, "/api/logo/NVDA");
  assert.equal(slots[1].image.src, "/api/logo/NVDA");
  assert.equal(slots[2].image, null);
});
```

另需测试：并发 `hydrate` 去重、第一个代理网络或 HTTP 失败后尝试第二个代理、图片 `error` 后永久回退、排除 `CASH`、排除非法证券代码，以及新增未知代码继续显示缩写。

- [ ] **步骤 2：运行测试，确认测试按预期失败**

运行：`node --test tests/security-logo.test.mjs`

预期：失败，因为 `security-logo.js` 尚不存在。

- [ ] **步骤 3：实现隔离的浏览器解析器**

使用闭包保存 `metadataCache` 和 `pendingSymbols`。批量处理去重且规范化的代码，依次尝试代理地址，并通过 `ownerDocument.createElement("img")` 创建图片元素。图片地址只能由代理基础地址与 `record.path` 拼接，不信任 JSON 中返回的完整 URL。注册一次性 `error` 监听器，失败时移除图片并恢复 `logo-fallback-active`。

```js
function logoImageUrl(proxy, path) {
  const suffix = String(path || "").replace(/^\/logo\//, "/logo/");
  return `${String(proxy).replace(/\/$/, "")}${suffix}`;
}
```

- [ ] **步骤 4：替换硬编码及近似 Logo 渲染**

删除 `COMPANY_LOGO_ASSETS`、`COMPANY_LOGO_DOMAINS` 和 `COMPANY_LOGO_GLYPHS`。只保留纯代码回退函数和本地 `CASH` 分支：

```js
function companyLogoMarkup(label) {
  const key = String(label || "").toUpperCase().trim();
  if (key === "CASH") return '<span class="company-logo-card logo-cash"><img src="logos/cash.svg" alt=""><span class="logo-fallback">$</span></span>';
  const safe = escapeHtml(key);
  return `<span class="company-logo-card logo-fallback-active" data-logo-symbol="${safe}" aria-hidden="true"><span class="logo-fallback">${escapeHtml(key.slice(0, 3) || ".")}</span></span>`;
}
```

地图和表格 HTML 插入后，安排执行 `MYH88SecurityLogos.hydrate(document, priceProxyUrls())`。解析器缓存和进行中任务映射必须保证两个渲染器不会重复请求提供商。

- [ ] **步骤 5：在地图渲染器之前加载解析器**

在 `script.part3.js` 之前加入 `<script src="security-logo.js?v=11.7.3"></script>`，并将 `script.part3.js` 和 `script.part4.js` 的查询版本更新为 `11.7.3`。

- [ ] **步骤 6：运行前端相关测试**

运行：`node --test tests/security-logo.test.mjs tests/ledger-carousel.test.mjs tests/brand-v11.7.test.mjs`

预期：全部通过，布局和账本功能无回归。

- [ ] **步骤 7：提交前端更新功能**

```bash
git add security-logo.js script.part3.js script.part4.js index.html tests/security-logo.test.mjs
git commit -m "feat: hydrate holdings with verified logos"
```

### 任务 4：移除假 Logo、更新版本并验证完整流程

**文件：**

- 删除：`logos/aaoi.svg`
- 删除：`logos/dram.svg`
- 删除：`logos/googl.svg`
- 删除：`logos/mrvl.svg`
- 删除：`logos/mu.svg`
- 删除：`logos/nvda.svg`
- 删除：`logos/rklb.svg`
- 删除：`logos/spcx.svg`
- 删除：`logos/vrt.svg`
- 删除：`logos/xfab.svg`
- 修改：`service-worker.js`
- 修改：`build-meta.json`
- 修改：`package.json`
- 修改：`tests/brand-v11.7.test.mjs`

**接口：**

- 使用：任务 1 至任务 3 的全部 Worker 与浏览器功能。
- 产出：版本 `11.7.3`，并只保留 `logos/cash.svg` 作为应用自有 Logo。

- [ ] **步骤 1：增加会失败的发布完整性断言**

扩展 `tests/brand-v11.7.test.mjs`，断言 `security-logo.js?v=11.7.3`、`script.part3.js?v=11.7.3` 和 `script.part4.js?v=11.7.3` 同时存在于 `index.html` 与 Service Worker 应用壳清单。断言 `package.json` 和 `build-meta.json` 使用 `11.7.3`；断言 `script.part3.js` 不再包含 `COMPANY_LOGO_ASSETS`、Google favicon 或 DuckDuckGo 图标地址。

- [ ] **步骤 2：运行发布测试，确认测试按预期失败**

运行：`node --test tests/brand-v11.7.test.mjs`

预期：因发布指纹和缓存清单仍为旧版本而失败。

- [ ] **步骤 3：更新版本并移除近似图片**

把应用、软件包及构建版本更新为 `11.7.3`，递增 Service Worker 缓存名称，将 `security-logo.js?v=11.7.3` 加入应用壳，更新受影响的查询字符串，并删除上方列出的所有过时 Logo 文件。保留 `logos/cash.svg`。

- [ ] **步骤 4：运行自动化验证**

运行：`npm test`

预期：`node scripts/validate-release.mjs` 及所有 `tests/*.test.mjs` 全部通过。

运行：`git diff --check`

预期：无输出。

- [ ] **步骤 5：执行本地界面验证**

使用仓库现有 Wrangler 配置在本地启动网站和 Worker，并分别在桌面宽度与 390 px 移动端宽度验证：

1. 提供商有资料时，NVDA、GOOGL、RKLB 显示经过验证的图片。
2. MSTU 及任何不支持的 ETF 显示清晰缩写，不显示发行商或虚构图形。
3. 一个故意添加的未知代码保持缩写，且不破坏地图布局。
4. 同一代码在地图和持仓表中显示一致。
5. 离线状态、元数据接口返回 502、图片损坏时，看板其他部分继续工作。
6. 浏览器网络请求不包含 Finnhub Token，只访问 `/api/logos` 与 `/api/logo/<symbol>`。

- [ ] **步骤 6：提交清理和版本更新**

```bash
git add -A logos service-worker.js build-meta.json package.json tests/brand-v11.7.test.mjs
git commit -m "chore: release verified holding logos"
```

- [ ] **步骤 7：检查最终历史和工作区**

运行：`git status --short --branch && git log --oneline -6`

预期：只剩原有未跟踪的 `.wrangler/` 目录；四个功能提交位于架构设计与实施计划提交之后。
