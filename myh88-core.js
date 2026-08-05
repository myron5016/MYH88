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

  const LOT_EPSILON = 1e-8;

  function roundLot(value, digits = 10) {
    const factor = 10 ** digits;
    return Math.round((num(value) + Number.EPSILON) * factor) / factor;
  }

  function createLot(transaction = {}, order = 0) {
    const shares = num(transaction.shares);
    const fxRate = num(transaction.fxRate) || 1;
    const nativeBasis = Number.isFinite(Number(transaction.costBasisNative))
      ? num(transaction.costBasisNative)
      : shares * num(transaction.price) + num(transaction.fee);
    const usdBasis = Number.isFinite(Number(transaction.costBasisUSD))
      ? num(transaction.costBasisUSD)
      : nativeBasis * fxRate;
    return {
      lotId: String(transaction.lotId || transaction.id || `lot-${order}`),
      buyTransactionId: String(transaction.id || transaction.lotId || `lot-${order}`),
      date: String(transaction.date || ""),
      order,
      shares: roundLot(shares),
      remainingShares: roundLot(shares),
      costBasisUSD: usdBasis,
      remainingCostBasisUSD: usdBasis,
      costBasisNative: nativeBasis,
      remainingCostBasisNative: nativeBasis,
      currency: String(transaction.currency || "USD").toUpperCase(),
      price: num(transaction.price),
    };
  }

  function summarizeLots(lots = []) {
    const active = lots.filter((lot) => num(lot.remainingShares) > LOT_EPSILON);
    const shares = active.reduce((sum, lot) => sum + num(lot.remainingShares), 0);
    const costBasisUSD = active.reduce((sum, lot) => sum + num(lot.remainingCostBasisUSD), 0);
    const costBasisNative = active.reduce((sum, lot) => sum + num(lot.remainingCostBasisNative), 0);
    return {
      shares: roundLot(shares),
      costBasisUSD: roundLot(costBasisUSD, 8),
      costBasisNative: roundLot(costBasisNative, 8),
      avgCostNative: shares > LOT_EPSILON ? costBasisNative / shares : 0,
      lots: active,
    };
  }

  function lotAllocationOrder(lots, method) {
    const ordered = [...lots];
    if (method === "lifo") return ordered.sort((a, b) => b.order - a.order);
    if (method === "highest") {
      return ordered.sort((a, b) => {
        const aUnit = num(a.remainingCostBasisUSD) / Math.max(num(a.remainingShares), LOT_EPSILON);
        const bUnit = num(b.remainingCostBasisUSD) / Math.max(num(b.remainingShares), LOT_EPSILON);
        return bUnit - aUnit || a.order - b.order;
      });
    }
    return ordered.sort((a, b) => a.order - b.order);
  }

  function normalizeManualAllocations(manualAllocations = []) {
    const grouped = new Map();
    manualAllocations.forEach((item) => {
      const id = String(item?.buyTransactionId || item?.lotId || "");
      const shares = num(item?.shares);
      if (id && shares > LOT_EPSILON) grouped.set(id, num(grouped.get(id)) + shares);
    });
    return grouped;
  }

  function allocateLotSale(sourceLots = [], quantity, method = "average", manualAllocations = []) {
    const lots = sourceLots.map((lot) => ({ ...lot }));
    const active = lots.filter((lot) => num(lot.remainingShares) > LOT_EPSILON);
    const available = active.reduce((sum, lot) => sum + num(lot.remainingShares), 0);
    const requested = num(quantity);
    if (requested <= LOT_EPSILON) throw new Error("Sell quantity must be greater than zero");
    if (available + LOT_EPSILON < requested) throw new Error("Sell quantity exceeds available tax lots");

    const planned = [];
    if (method === "specific") {
      const manual = normalizeManualAllocations(manualAllocations);
      const selected = [...manual.values()].reduce((sum, shares) => sum + shares, 0);
      if (Math.abs(selected - requested) > 1e-6) throw new Error("Selected lot quantity must equal sell quantity");
      manual.forEach((shares, id) => {
        const lot = active.find((item) => item.buyTransactionId === id || item.lotId === id);
        if (!lot) throw new Error("Selected tax lot is no longer available");
        if (num(lot.remainingShares) + LOT_EPSILON < shares) throw new Error("Selected quantity exceeds the tax lot balance");
        planned.push({ lot, shares });
      });
    } else if (method === "average") {
      let remaining = requested;
      active.forEach((lot, index) => {
        if (remaining <= LOT_EPSILON) return;
        const shares = index === active.length - 1
          ? remaining
          : Math.min(remaining, requested * num(lot.remainingShares) / available);
        if (shares > LOT_EPSILON) planned.push({ lot, shares });
        remaining -= shares;
      });
    } else {
      let remaining = requested;
      lotAllocationOrder(active, method).forEach((lot) => {
        if (remaining <= LOT_EPSILON) return;
        const shares = Math.min(remaining, num(lot.remainingShares));
        if (shares > LOT_EPSILON) planned.push({ lot, shares });
        remaining -= shares;
      });
    }

    let costBasisUSD = 0;
    let costBasisNative = 0;
    const allocations = planned.map(({ lot, shares }) => {
      const beforeShares = num(lot.remainingShares);
      const isFull = Math.abs(beforeShares - shares) <= LOT_EPSILON;
      const basisUSD = isFull
        ? num(lot.remainingCostBasisUSD)
        : num(lot.remainingCostBasisUSD) / beforeShares * shares;
      const basisNative = isFull
        ? num(lot.remainingCostBasisNative)
        : num(lot.remainingCostBasisNative) / beforeShares * shares;
      lot.remainingShares = roundLot(beforeShares - shares);
      lot.remainingCostBasisUSD = roundLot(Math.max(0, num(lot.remainingCostBasisUSD) - basisUSD), 8);
      lot.remainingCostBasisNative = roundLot(Math.max(0, num(lot.remainingCostBasisNative) - basisNative), 8);
      costBasisUSD += basisUSD;
      costBasisNative += basisNative;
      return {
        lotId: lot.lotId,
        buyTransactionId: lot.buyTransactionId,
        date: lot.date,
        shares: roundLot(shares),
        unitCostUSD: shares ? basisUSD / shares : 0,
        unitCostNative: shares ? basisNative / shares : 0,
        costBasisUSD: basisUSD,
        costBasisNative: basisNative,
      };
    });

    return {
      method,
      allocations,
      costBasisUSD: roundLot(costBasisUSD, 8),
      costBasisNative: roundLot(costBasisNative, 8),
      lots: lots.filter((lot) => num(lot.remainingShares) > LOT_EPSILON),
      remaining: summarizeLots(lots),
    };
  }

  function orderedLotTransactions(transactions = []) {
    return transactions.map((transaction, order) => ({ ...transaction, _lotOrder: order })).sort((a, b) => {
      const aOpening = a.type === "opening" ? 0 : 1;
      const bOpening = b.type === "opening" ? 0 : 1;
      if (aOpening !== bOpening) return aOpening - bOpening;
      const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
      return dateCompare || a._lotOrder - b._lotOrder;
    });
  }

  function lotsBeforeTransaction(transactions = [], stopBeforeId = "", symbolFilter = "") {
    const bySymbol = new Map();
    const wanted = String(symbolFilter || "").toUpperCase();
    for (const transaction of orderedLotTransactions(transactions)) {
      if (stopBeforeId && transaction.id === stopBeforeId) break;
      if (transaction.voided) continue;
      const symbol = String(transaction.symbol || "").toUpperCase();
      if (!symbol || (wanted && symbol !== wanted)) continue;
      const lots = bySymbol.get(symbol) || [];
      if (transaction.type === "buy" || transaction.type === "opening") {
        lots.push(createLot(transaction, transaction._lotOrder));
        bySymbol.set(symbol, lots);
      } else if (transaction.type === "sell") {
        const available = summarizeLots(lots).shares;
        if (available + LOT_EPSILON < num(transaction.shares)) continue;
        const frozen = Array.isArray(transaction.lotAllocations) && transaction.lotAllocations.length > 0;
        const method = frozen ? "specific" : (transaction.lotMethod || "average");
        const result = allocateLotSale(lots, transaction.shares, method, transaction.lotAllocations || []);
        bySymbol.set(symbol, result.lots);
      }
    }
    if (wanted) return (bySymbol.get(wanted) || []).map((lot) => ({ ...lot }));
    return Object.fromEntries([...bySymbol.entries()].map(([symbol, lots]) => [symbol, lots.map((lot) => ({ ...lot }))]));
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
    allocateLotSale,
    computeLedgerMetrics,
    createLot,
    lotsBeforeTransaction,
    marketUSD,
    summarizeLots,
    squarifiedTreemap,
    treemapVisualItems,
  });
})(globalThis);
