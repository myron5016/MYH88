import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

await import("../myh88-core.js");
const { parseStaticQuoteCache, isStaticQuoteFresh, scheduleBackgroundTasks } = globalThis.MYH88Core;

const holidays = { "2026-07-03": "Independence Day observed" };
const quote = (date) => ({
  cachedAt: Date.parse(`${date}T21:00:00Z`),
  body: JSON.stringify({ NVDA: { symbol: "NVDA", close: "200", datetime: `${date} 16:00:00` } }),
});

test("accepts a well-formed static quote within two completed sessions", () => {
  const parsed = parseStaticQuoteCache(quote("2026-07-02"));
  assert.equal(parsed.asOfDate, "2026-07-02");
  assert.equal(isStaticQuoteFresh(parsed, "2026-07-07", holidays, 2), true);
});

test("rejects a static quote older than two completed sessions", () => {
  const parsed = parseStaticQuoteCache(quote("2026-07-02"));
  assert.equal(isStaticQuoteFresh(parsed, "2026-07-08", holidays, 2), false);
});

test("rejects malformed static cache data", () => {
  assert.equal(parseStaticQuoteCache({ cachedAt: Date.now(), body: "not-json" }), null);
  assert.equal(isStaticQuoteFresh(null, "2026-08-09", {}, 2), false);
});

test("background tasks start independently instead of waiting on the snapshot", async () => {
  let releaseSnapshot;
  const snapshot = new Promise((resolve) => { releaseSnapshot = resolve; });
  let refreshStarted = false;
  const errors = [];
  const tasks = scheduleBackgroundTasks([
    { label: "opening snapshot", task: () => snapshot },
    { label: "price refresh", task: () => { refreshStarted = true; } },
  ], (error, label) => errors.push(`${label}:${error.message}`));
  await Promise.resolve();
  assert.equal(refreshStarted, true);
  releaseSnapshot();
  await Promise.all(tasks);
  assert.deepEqual(errors, []);
});

test("production scripts include the static freshness gate and non-blocking startup", async () => {
  const [part1, part2] = await Promise.all([
    fs.readFile(new URL("../script.part1.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../script.part2.js", import.meta.url), "utf8"),
  ]);
  const frontend = `${part1}\n${part2}`;
  assert.match(frontend, /MYH88Core\.parseStaticQuoteCache/);
  assert.match(frontend, /MYH88Core\.isStaticQuoteFresh/);
  assert.match(part1, /scheduleBackgroundTasks/);
  assert.doesNotMatch(part1, /applySharedDataText\(raw\);await ensureCurrentMonthOpeningSnapshot\(\)/);
});
