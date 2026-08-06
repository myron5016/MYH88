import test from "node:test";
import assert from "node:assert/strict";

await import("../myh88-core.js");
const { squarifiedTreemap } = globalThis.MYH88Core;

function overlaps(a, b, epsilon = 0.01) {
  return a.x < b.x + b.w - epsilon
    && a.x + a.w > b.x + epsilon
    && a.y < b.y + b.h - epsilon
    && a.y + a.h > b.y + epsilon;
}

for (const count of [1, 5, 10, 16, 20, 30]) {
  test(`持仓地图在 ${count} 个资产下无越界和重叠`, () => {
    const items = Array.from({ length: count }, (_, index) => ({
      label: `S${index + 1}`,
      value: index === count - 1 ? 1 : 1000 / (index + 1),
      color: "#22c55e",
    }));
    const tiles = squarifiedTreemap(items, 0, 0, 1200, 680);
    assert.equal(tiles.length, count);
    for (const tile of tiles) {
      assert.ok(tile.w > 0 && tile.h > 0, `${tile.label} has a visible rectangle`);
      assert.ok(tile.x >= -0.01 && tile.y >= -0.01);
      assert.ok(tile.x + tile.w <= 1200.01 && tile.y + tile.h <= 680.01);
    }
    for (let i = 0; i < tiles.length; i += 1) {
      for (let j = i + 1; j < tiles.length; j += 1) {
        assert.equal(overlaps(tiles[i], tiles[j]), false, `${tiles[i].label} must not overlap ${tiles[j].label}`);
      }
    }
  });
}

for (const count of [1, 5, 10, 20, 30]) {
  test(`手机持仓地图在 ${count} 个资产下无越界和重叠`, () => {
    const items = Array.from({ length: count }, (_, index) => ({
      label: `M${index + 1}`,
      value: index === count - 1 ? 1 : 1000 / (index + 1),
      color: "#22c55e",
    }));
    const tiles = squarifiedTreemap(items, 0, 0, 390, 560);
    assert.equal(tiles.length, count);
    for (const tile of tiles) {
      assert.ok(tile.w > 0 && tile.h > 0, `${tile.label} has a visible rectangle`);
      assert.ok(tile.x >= -0.01 && tile.y >= -0.01);
      assert.ok(tile.x + tile.w <= 390.01 && tile.y + tile.h <= 560.01);
    }
    for (let i = 0; i < tiles.length; i += 1) {
      for (let j = i + 1; j < tiles.length; j += 1) {
        assert.equal(overlaps(tiles[i], tiles[j]), false, `${tiles[i].label} must not overlap ${tiles[j].label}`);
      }
    }
  });
}
