(function initMyh88Core(root) {
  function num(value) {
    return Number(value) || 0;
  }

  function marketUSD(position, fxRates = {}) {
    const currency = String(position?.currency || "USD").toUpperCase();
    const rate = currency === "USD" ? 1 : num(fxRates[currency]);
    return num(position?.shares) * num(position?.price) * rate;
  }

  function computeLedgerMetrics(state = {}) {
    const cashFlows = Array.isArray(state.cashFlows) ? state.cashFlows : [];
    const transactions = Array.isArray(state.transactions) ? state.transactions : [];
    const positions = Array.isArray(state.positions) ? state.positions : [];
    const fxRates = { USD: 1, ...(state.fxRates || {}) };
    const contributedCapital = cashFlows
      .filter((item) => !item.voided)
      .reduce((sum, item) => sum + (item.type === "withdraw" ? -num(item.amountUSD) : num(item.amountUSD)), 0);
    const realizedPnl = transactions
      .filter((item) => item.type === "sell" && !item.voided)
      .reduce((sum, item) => sum + num(item.realizedPnlUSD), 0);
    const currentCost = positions.reduce((sum, position) => sum + num(position.costBasisUSD), 0);
    const marketTotal = positions.reduce((sum, position) => sum + marketUSD(position, fxRates), 0);
    const floatingPnl = marketTotal - currentCost;
    const cashBalance = contributedCapital + realizedPnl - currentCost;
    const netAsset = marketTotal + cashBalance;
    const totalPnl = netAsset - contributedCapital;
    return {
      contributedCapital,
      realizedPnl,
      currentCost,
      marketTotal,
      floatingPnl,
      cashBalance,
      netAsset,
      totalPnl,
      totalReturn: contributedCapital ? totalPnl / contributedCapital * 100 : 0,
      floatingReturn: currentCost ? floatingPnl / currentCost * 100 : 0,
    };
  }

  function treemapVisualItems(items) {
    const total = items.reduce((sum, item) => sum + num(item.value), 0);
    if (!total || items.length < 2) return items.map((item) => ({ ...item, visualValue: num(item.value) }));
    const floorRatio = Math.min(0.028, 0.30 / items.length);
    const floorValue = total * floorRatio;
    return items
      .map((item) => ({ ...item, visualValue: Math.max(num(item.value), floorValue) }))
      .sort((a, b) => b.visualValue - a.visualValue || b.value - a.value || String(a.label).localeCompare(String(b.label)));
  }

  function treemapWorst(row, side) {
    if (!row.length || side <= 0) return Infinity;
    const sum = row.reduce((value, item) => value + item.area, 0);
    const max = Math.max(...row.map((item) => item.area));
    const min = Math.min(...row.map((item) => item.area));
    return Math.max(side * side * max / (sum * sum), sum * sum / (side * side * min));
  }

  function treemapPlaceRow(row, rect, result) {
    const rowArea = row.reduce((value, item) => value + item.area, 0);
    if (rect.w >= rect.h) {
      const width = rowArea / Math.max(rect.h, 1);
      let top = rect.y;
      row.forEach((item, index) => {
        const height = index === row.length - 1 ? rect.y + rect.h - top : item.area / Math.max(width, 1);
        result.push({ ...item, x: rect.x, y: top, w: width, h: height });
        top += height;
      });
      rect.x += width;
      rect.w = Math.max(0, rect.w - width);
    } else {
      const height = rowArea / Math.max(rect.w, 1);
      let left = rect.x;
      row.forEach((item, index) => {
        const width = index === row.length - 1 ? rect.x + rect.w - left : item.area / Math.max(height, 1);
        result.push({ ...item, x: left, y: rect.y, w: width, h: height });
        left += width;
      });
      rect.y += height;
      rect.h = Math.max(0, rect.h - height);
    }
  }

  function squarifiedTreemap(items, x, y, width, height) {
    if (!items.length) return [];
    const prepared = treemapVisualItems(items);
    const visualTotal = prepared.reduce((sum, item) => sum + item.visualValue, 0);
    const scale = width * height / Math.max(visualTotal, 1);
    const pending = prepared.map((item) => ({ ...item, area: item.visualValue * scale }));
    const rect = { x, y, w: width, h: height };
    const result = [];
    let row = [];
    while (pending.length) {
      const item = pending[0];
      const side = Math.max(1, Math.min(rect.w, rect.h));
      if (!row.length || treemapWorst([...row, item], side) <= treemapWorst(row, side)) row.push(pending.shift());
      else {
        treemapPlaceRow(row, rect, result);
        row = [];
      }
    }
    if (row.length) treemapPlaceRow(row, rect, result);
    return result;
  }

  root.MYH88Core = Object.freeze({
    computeLedgerMetrics,
    marketUSD,
    squarifiedTreemap,
    treemapVisualItems,
  });
})(globalThis);
