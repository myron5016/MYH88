# Verified Security Logos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace approximate and hard-coded holding logos with automatically resolved, verified logos while keeping a safe ticker fallback for every unsupported security.

**Architecture:** The existing Cloudflare Worker resolves Finnhub company profiles and caches verified metadata in `MYH88_CACHE`; a constrained image route proxies only URLs that came from that metadata. A small browser resolver batches current symbols, hydrates both map and table logo slots, and leaves ticker initials visible whenever resolution or loading fails.

**Tech Stack:** Cloudflare Workers ES modules, Cloudflare KV and Cache API, vanilla browser JavaScript, Cloudflare Pages Functions, Node.js 20 built-in test runner.

**Spec:** `docs/plans/2026-09-23-verified-security-logos-design.md`

## Global Constraints

- Display a logo only from Finnhub company-profile data or an explicit reviewed override.
- Do not substitute an ETF issuer logo when the product logo is unavailable.
- Keep the `FINNHUB_API_KEY` exclusively in the Worker environment.
- Require HTTPS, reject private/local hosts, accept only image content, and cap proxied images at 512 KiB.
- Cache successful metadata for 30 days and missing metadata for 24 hours.
- Keep `CASH` as the only local app-owned logo; unresolved listed securities show ticker initials.
- A new saved holding must resolve without a code deployment.

## Review Focus

- Symbols containing dots or hyphens must remain valid but path traversal and encoded slashes must be rejected; Task 2 pins both cases.
- A provider may return a company profile with an empty or malformed `logo`; Task 1 must cache this as `missing`, not `verified`.
- The upstream image can claim an acceptable `Content-Length` and still exceed 512 KiB; Task 2 checks the actual byte length.
- Map and table can request the same symbol during one render cycle; Task 3 verifies one metadata request and hydration of every matching slot.
- A newly added unsaved position is not yet in the server portfolio allowlist; Task 3 verifies it remains a readable ticker fallback until the next successful data save/deploy.

---

## File Structure

- `cloudflare-worker.js`: add metadata normalization, KV resolution, trusted image proxying, and two routes.
- `functions/api/[[path]].js`: forward `logos` and `logo/:symbol` through the same-origin Pages bridge without converting image responses to JSON.
- `security-logo.js`: isolated browser-side batching, cache, DOM hydration, and image-failure fallback.
- `script.part3.js`: render inert logo slots and invoke the shared resolver; remove approximate logo maps.
- `index.html`: load `security-logo.js` before `script.part3.js` and bump affected asset fingerprints.
- `service-worker.js`: cache the new runtime file and bump the shell cache identifier.
- `tests/security-logo-worker.test.mjs`: Worker metadata and image security behavior.
- `tests/security-logo.test.mjs`: browser resolver behavior with a minimal DOM fixture.
- `tests/same-origin-proxy.test.mjs`: Pages bridge routing and binary response assertions.
- `tests/brand-v11.7.test.mjs`: release fingerprint and removal of approximate-logo mappings.

### Task 1: Verified metadata resolution and KV caching

**Files:**
- Modify: `cloudflare-worker.js:1-150,465-510`
- Create: `tests/security-logo-worker.test.mjs`

**Interfaces:**
- Consumes: `normalizeSymbols(value)`, `readSharedCache(env, key)`, `FINNHUB_BASE`, and `env.FINNHUB_API_KEY`.
- Produces: `logoProfileCacheKey(symbol) -> string`, `normalizeLogoProfile(symbol, profile) -> LogoRecord`, `resolveLogoProfiles(env, symbols) -> Promise<Record<string, LogoRecord>>`, and `GET /logos?symbols=...`.
- `LogoRecord` is `{symbol, status:"verified", source:"finnhub"|"override", name, upstreamUrl, cachedAt}` or `{symbol, status:"missing", source:"finnhub", cachedAt}`. Public JSON omits `upstreamUrl` and returns `path:"/logo/<encoded symbol>"` for verified records.
- `VERIFIED_LOGO_OVERRIDES` is a reviewed, initially empty map of `{name, upstreamUrl}` records; `LOGO_SUPPRESSIONS` contains known ETF/synthetic symbols such as `MSTU` until a product-specific asset is reviewed.

- [ ] **Step 1: Write failing metadata tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import worker, { logoProfileCacheKey, normalizeLogoProfile } from "../cloudflare-worker.js";

test("normalizes only an HTTPS Finnhub logo as verified", () => {
  assert.deepEqual(normalizeLogoProfile("NVDA", {
    name: "NVIDIA Corp", logo: "https://static.example.test/nvda.png",
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

test("logos route caches verified and missing profiles with different TTLs", async () => {
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
      ? { name: "NVIDIA Corp", logo: "https://static.example.test/nvda.png" }
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/security-logo-worker.test.mjs`

Expected: FAIL because `logoProfileCacheKey`, `normalizeLogoProfile`, and `/logos` do not exist.

- [ ] **Step 3: Implement the minimal metadata resolver**

Add constants `LOGO_PROFILE_TTL_SECONDS = 30 * 24 * 60 * 60`, `LOGO_MISSING_TTL_SECONDS = 24 * 60 * 60`, and `LOGO_BATCH_LIMIT = 24`. Implement normalization that accepts only parseable `https:` URLs and requires operating-company evidence (`marketCapitalization > 0` or both a non-empty `ipo` and `finnhubIndustry`); this prevents a generic ETF issuer mark from being labelled as the product logo. Check `LOGO_SUPPRESSIONS`, then `VERIFIED_LOGO_OVERRIDES`, then Finnhub, and never emit `upstreamUrl` in public JSON. Query `${FINNHUB_BASE}/stock/profile2?symbol=<symbol>&token=<secret>` only on a cache miss, store each normalized record directly in KV, and route `/logos` before the existing `/quotes` guard.

```js
function publicLogoRecord(record) {
  if (record.status !== "verified") return { symbol: record.symbol, status: "missing", source: record.source };
  return { symbol: record.symbol, status: "verified", source: record.source, name: record.name, path: `/logo/${encodeURIComponent(record.symbol)}` };
}
```

- [ ] **Step 4: Add invalid batch and cache-hit tests**

Add assertions that an empty request returns 400, more than 24 normalized symbols returns 400, duplicate symbols call Finnhub once, an override skips Finnhub, a suppressed ETF stays missing even if Finnhub returns an issuer logo, and a cached record triggers zero provider calls. Also assert neither the API key nor `upstreamUrl` appears in the JSON body.

- [ ] **Step 5: Run the focused tests**

Run: `node --test tests/security-logo-worker.test.mjs tests/worker-routing.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit metadata resolution**

```bash
git add cloudflare-worker.js tests/security-logo-worker.test.mjs
git commit -m "feat: resolve verified security logo metadata"
```

### Task 2: Constrained image proxy and same-origin bridge

**Files:**
- Modify: `cloudflare-worker.js`
- Modify: `functions/api/[[path]].js`
- Modify: `tests/security-logo-worker.test.mjs`
- Modify: `tests/same-origin-proxy.test.mjs`

**Interfaces:**
- Consumes: cached `LogoRecord` from Task 1.
- Produces: `validateLogoUrl(value) -> URL|null`, `proxySecurityLogo(env, symbol) -> Promise<Response>`, `GET /logo/:symbol`, and Pages routes `/api/logos` plus `/api/logo/:symbol`.

- [ ] **Step 1: Write failing image-proxy tests**

```js
test("logo route serves only the cached verified upstream image", async () => {
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

Add rejection cases for `localhost`, `127.0.0.1`, `[::1]`, private IPv4 ranges, URL credentials, non-HTTPS schemes, missing metadata, non-image content type, declared size above 512 KiB, actual body above 512 KiB, `../`, and `%2F`. Add a valid hyphenated ticker assertion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/security-logo-worker.test.mjs tests/same-origin-proxy.test.mjs`

Expected: FAIL because `/logo/:symbol` and multi-segment Pages forwarding are absent.

- [ ] **Step 3: Implement URL and image validation**

Implement `validateLogoUrl` with `https:`, no credentials, port `""` or `"443"`, and explicit local/private host rejection. `proxySecurityLogo` must read only `logo:profile:v1:<symbol>`, request with `Accept: image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*`, verify `image/(png|jpeg|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)`, enforce both declared and actual byte limits, and return `X-Content-Type-Options: nosniff`.

Use `caches.default` when available with a cache key based only on the normalized symbol; otherwise rely on `Cache-Control: public, max-age=2592000, stale-while-revalidate=604800`.

- [ ] **Step 4: Extend the Pages API bridge**

Replace the one-segment restriction with exact route parsing:

```js
const singleRoutes = new Set(["", "quotes", "market-clock", "fx", "logos"]);
const isLogoImage = segments.length === 2 && segments[0] === "logo" && /^[A-Z0-9.-]{1,12}$/i.test(segments[1]);
if (!(segments.length <= 1 && singleRoutes.has(path)) && !isLogoImage) return notFound();
```

Forward the incoming `Accept` header, preserve upstream `Content-Type`, `Content-Length`, `ETag`, and `Cache-Control`, and apply `no-store` only to JSON quote/metadata bridge responses—not to `/api/logo/:symbol` image responses.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test tests/security-logo-worker.test.mjs tests/same-origin-proxy.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS with no existing quote-routing regression.

- [ ] **Step 6: Commit the safe image path**

```bash
git add cloudflare-worker.js functions/api/[[path]].js tests/security-logo-worker.test.mjs tests/same-origin-proxy.test.mjs
git commit -m "feat: proxy verified security logo images"
```

### Task 3: Browser batching, hydration, and ticker fallback

**Files:**
- Create: `security-logo.js`
- Create: `tests/security-logo.test.mjs`
- Modify: `script.part3.js:31-58,58-82`
- Modify: `script.part4.js:118-132`
- Modify: `index.html:468-478`

**Interfaces:**
- Consumes: `priceProxyUrls() -> string[]`, Task 1 response `{logos: Record<string, PublicLogoRecord>}`, and Task 2 image paths.
- Produces: global `MYH88SecurityLogos` with `normalizeSymbols(values)`, `load(symbols, proxyUrls, fetchImpl)`, `hydrate(root, proxyUrls, fetchImpl)`, and `resetForTests()`.
- DOM contract: every non-cash slot is `<span class="company-logo-card logo-fallback-active" data-logo-symbol="NVDA"><span class="logo-fallback">NV</span></span>`.

- [ ] **Step 1: Write failing browser resolver tests**

Use `node:vm` to evaluate `security-logo.js` with a fake `document`, fake logo slots, and a fetch spy. Pin these behaviors:

```js
test("hydrates duplicate map and table slots with one batched request", async () => {
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

Also test request de-duplication across concurrent `hydrate` calls, retry through the second proxy after a network/HTTP failure, permanent fallback after image `error`, `CASH` exclusion, invalid symbol exclusion, and an unknown newly added symbol remaining as initials.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/security-logo.test.mjs`

Expected: FAIL because `security-logo.js` does not exist.

- [ ] **Step 3: Implement the isolated browser resolver**

Use a closure with `metadataCache` and `pendingSymbols`. Batch unique normalized symbols, try proxy URLs in order, and create image elements through `ownerDocument.createElement("img")`. Build the image source by joining the proxy base with `record.path`; do not trust a full URL from JSON. Add a one-shot `error` listener that removes the image and restores `logo-fallback-active`.

```js
function logoImageUrl(proxy, path) {
  const suffix = String(path || "").replace(/^\/logo\//, "/logo/");
  return `${String(proxy).replace(/\/$/, "")}${suffix}`;
}
```

- [ ] **Step 4: Replace hard-coded and approximate logo rendering**

Delete `COMPANY_LOGO_ASSETS`, `COMPANY_LOGO_DOMAINS`, and `COMPANY_LOGO_GLYPHS`. Keep only a tiny pure ticker fallback helper and the local `CASH` branch:

```js
function companyLogoMarkup(label) {
  const key = String(label || "").toUpperCase().trim();
  if (key === "CASH") return '<span class="company-logo-card logo-cash"><img src="logos/cash.svg" alt=""><span class="logo-fallback">$</span></span>';
  const safe = escapeHtml(key);
  return `<span class="company-logo-card logo-fallback-active" data-logo-symbol="${safe}" aria-hidden="true"><span class="logo-fallback">${escapeHtml(key.slice(0, 3) || ".")}</span></span>`;
}
```

After map and table HTML is inserted, schedule `MYH88SecurityLogos.hydrate(document, priceProxyUrls())`. The resolver cache and pending map must ensure the two renderers do not duplicate provider requests.

- [ ] **Step 5: Load the resolver before the map renderer**

Add `<script src="security-logo.js?v=11.7.3"></script>` immediately before `script.part3.js`, and bump the `script.part3.js` and `script.part4.js` query versions to `11.7.3`.

- [ ] **Step 6: Run browser-focused tests**

Run: `node --test tests/security-logo.test.mjs tests/ledger-carousel.test.mjs tests/brand-v11.7.test.mjs`

Expected: PASS, with no layout or ledger regression.

- [ ] **Step 7: Commit frontend hydration**

```bash
git add security-logo.js script.part3.js script.part4.js index.html tests/security-logo.test.mjs
git commit -m "feat: hydrate holdings with verified logos"
```

### Task 4: Remove fake assets, bump release, and verify the complete flow

**Files:**
- Delete: `logos/aaoi.svg`
- Delete: `logos/dram.svg`
- Delete: `logos/googl.svg`
- Delete: `logos/mrvl.svg`
- Delete: `logos/mu.svg`
- Delete: `logos/nvda.svg`
- Delete: `logos/rklb.svg`
- Delete: `logos/spcx.svg`
- Delete: `logos/vrt.svg`
- Delete: `logos/xfab.svg`
- Modify: `service-worker.js`
- Modify: `build-meta.json`
- Modify: `package.json`
- Modify: `tests/brand-v11.7.test.mjs`

**Interfaces:**
- Consumes: all Worker and browser behavior from Tasks 1-3.
- Produces: release `11.7.3` with only `logos/cash.svg` retained as an app-owned logo asset.

- [ ] **Step 1: Add failing release-integrity assertions**

Extend `tests/brand-v11.7.test.mjs` to assert that `security-logo.js?v=11.7.3`, `script.part3.js?v=11.7.3`, and `script.part4.js?v=11.7.3` appear in both `index.html` and the service-worker shell list. Assert `package.json` and `build-meta.json` use `11.7.3`; assert `script.part3.js` does not contain `COMPANY_LOGO_ASSETS`, Google favicon, or DuckDuckGo icon URLs.

- [ ] **Step 2: Run the release test to verify it fails**

Run: `node --test tests/brand-v11.7.test.mjs`

Expected: FAIL on stale release fingerprints and cache manifest.

- [ ] **Step 3: Apply the release update and remove approximate assets**

Set the app/package/build release to `11.7.3`, increment the service-worker cache name, add `security-logo.js?v=11.7.3` to the shell, update the affected query strings, and delete every obsolete logo file listed above. Keep `logos/cash.svg`.

- [ ] **Step 4: Run automated verification**

Run: `npm test`

Expected: `node scripts/validate-release.mjs` and all `tests/*.test.mjs` PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Perform local UI verification**

Serve the site and Worker locally with the repository's existing Wrangler configuration. Verify at desktop width and at 390 px mobile width:

1. NVDA/GOOGL/RKLB render verified images when the provider returns them.
2. MSTU and any unsupported ETF remain legible initials rather than showing an issuer or invented mark.
3. A deliberately unknown ticker remains initials and does not break map layout.
4. Map and position table show the same result for a ticker.
5. Offline mode, a 502 metadata response, and a broken image response preserve the rest of the dashboard.
6. Browser network requests contain no Finnhub token and use `/api/logos` plus `/api/logo/<symbol>`.

- [ ] **Step 6: Commit cleanup and release**

```bash
git add -A logos service-worker.js build-meta.json package.json tests/brand-v11.7.test.mjs
git commit -m "chore: release verified holding logos"
```

- [ ] **Step 7: Review final history and working tree**

Run: `git status --short --branch && git log --oneline -6`

Expected: only the pre-existing untracked `.wrangler/` directory remains; the four feature commits follow the design and plan documentation commits.
