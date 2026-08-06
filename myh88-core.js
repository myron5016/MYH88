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

  function buildHistoricalSnapshot(state = {}, date = "", prices = {}) {
    const asOf = String(date || "");
    const transactions = (state.transactions || []).filter((item) => !item?.voided && String(item.date || "") <= asOf);
    const cashFlows = (state.cashFlows || []).filter((item) => !item?.voided && String(item.date || "") <= asOf);
    const lotsBySymbol = lotsBeforeTransaction(transactions);
    const currentMetadata = new Map((state.positions || []).map((item) => [String(item.symbol || "").toUpperCase(), item]));
    const transactionMetadata = new Map();
    transactions.forEach((item) => transactionMetadata.set(String(item.symbol || "").toUpperCase(), item));
    const fxRates = { USD: 1, ...(state.fxRates || {}) };
    const positions = [];
    const missingSymbols = [];

    Object.entries(lotsBySymbol).forEach(([symbol, lots]) => {
      const remaining = summarizeLots(lots);
      if (!(remaining.shares > LOT_EPSILON)) return;
      const metadata = currentMetadata.get(symbol) || transactionMetadata.get(symbol) || {};
      const currency = String(metadata.currency || "USD").toUpperCase();
      const source = String(metadata.source || "twelve").toLowerCase();
      const rawPrice = prices[symbol];
      const historicalPrice = num(rawPrice?.close ?? rawPrice?.price ?? rawPrice);
      const manualPrice = source === "manual" ? num(metadata.price) : 0;
      const price = historicalPrice || manualPrice;
      if (!(price > 0)) missingSymbols.push(symbol);
      positions.push({
        symbol,
        source,
        currency,
        shares: remaining.shares,
        costBasisUSD: remaining.costBasisUSD,
        price,
      });
    });

    const capital = cashFlows.reduce((sum, item) => sum + (item.type === "withdraw" ? -1 : 1) * num(item.amountUSD), 0);
    const realizedPnl = transactions.filter((item) => item.type === "sell").reduce((sum, item) => sum + num(item.realizedPnlUSD), 0);
    const currentCost = positions.reduce((sum, item) => sum + num(item.costBasisUSD), 0);
    const cash = capital + realizedPnl - currentCost;
    const market = positions.reduce((sum, item) => sum + num(item.shares) * num(item.price) * (item.currency === "USD" ? 1 : num(fxRates[item.currency])), 0);
    return {
      complete: missingSymbols.length === 0 && positions.length > 0,
      missingSymbols,
      positions,
      snapshot: {
        scope: "active",
        date: asOf,
        capital,
        netAsset: market + cash,
        market,
        cash,
        openingBaseline: true,
        source: "ledger-historical-close",
      },
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

  function returnPeriodStart(period, latestDate) {
    const date = String(latestDate || "");
    if (period === "month") return `${date.slice(0, 7)}-01`;
    if (period === "year") return `${date.slice(0, 4)}-01-01`;
    return "";
  }

  function utcDayNumber(date) {
    const [year, month, day] = String(date || "").split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
  }

  function buildReturnSeries(snapshots = [], period = "all") {
    const validPeriods = new Set(["all", "month", "year"]);
    const selectedPeriod = validPeriods.has(period) ? period : "all";
    const sorted = snapshots
      .filter((item) => item && (!item.scope || item.scope === "active") && String(item.date || "") && num(item.netAsset) > 0)
      .map((item) => ({
        date: String(item.date),
        capital: num(item.capital),
        netAsset: num(item.netAsset),
        openingBaseline: Boolean(item.openingBaseline),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((item, index, list) => index === list.length - 1 || item.date !== list[index + 1].date);
    if (!sorted.length) {
      return { period: selectedPeriod, points: [], returnPct: 0, pnlUSD: 0, startDate: "", endDate: "", baselineDate: "" };
    }

    const latest = sorted.at(-1);
    const periodStart = returnPeriodStart(selectedPeriod, latest.date);
    const firstInPeriod = periodStart ? sorted.findIndex((item) => item.date >= periodStart) : 0;
    if (firstInPeriod < 0) {
      return { period: selectedPeriod, points: [], returnPct: 0, pnlUSD: 0, startDate: periodStart, endDate: latest.date, baselineDate: "" };
    }
    const baselineCandidate = firstInPeriod > 0 ? sorted[firstInPeriod - 1] : null;
    const baselineGapDays = baselineCandidate && periodStart
      ? utcDayNumber(periodStart) - utcDayNumber(baselineCandidate.date)
      : 0;
    const baseline = baselineCandidate && baselineGapDays >= 0 && baselineGapDays <= 7
      ? baselineCandidate
      : null;
    const openingBaseline = sorted[firstInPeriod]?.openingBaseline ? sorted[firstInPeriod] : null;
    const hasPriorHistory = firstInPeriod > 0;
    const useCapitalBasis = selectedPeriod === "all" || !hasPriorHistory;
    if (useCapitalBasis) {
      const points = sorted.slice(firstInPeriod).map((current) => ({
        date: current.date,
        value: current.netAsset,
        returnPct: current.capital > 0 ? (current.netAsset - current.capital) / current.capital * 100 : 0,
      }));
      return {
        period: selectedPeriod,
        points,
        returnPct: points.at(-1)?.returnPct || 0,
        pnlUSD: latest.netAsset - latest.capital,
        startDate: sorted[firstInPeriod]?.date || periodStart,
        endDate: latest.date,
        baselineDate: "",
        periodStart,
        dataStart: sorted[firstInPeriod]?.date || "",
        baselineComplete: true,
      };
    }
    let previous = baseline;
    let wealth = 1;
    const points = baseline ? [{ date: baseline.date, value: baseline.netAsset, returnPct: 0, baseline: true }] : [];

    for (let index = firstInPeriod; index < sorted.length; index += 1) {
      const current = sorted[index];
      if (!previous) {
        wealth = 1;
      } else if (previous.netAsset > 0) {
        const externalFlow = current.capital - previous.capital;
        wealth *= (current.netAsset - externalFlow) / previous.netAsset;
      }
      points.push({
        date: current.date,
        value: current.netAsset,
        returnPct: (wealth - 1) * 100,
      });
      previous = current;
    }

    const comparison = baseline || (hasPriorHistory && selectedPeriod !== "all" ? sorted[firstInPeriod] : null);
    const pnlUSD = comparison
      ? latest.netAsset - comparison.netAsset - (latest.capital - comparison.capital)
      : latest.netAsset - latest.capital;
    return {
      period: selectedPeriod,
      points,
      returnPct: points.at(-1)?.returnPct || 0,
      pnlUSD,
      startDate: sorted[firstInPeriod]?.date || periodStart,
      endDate: latest.date,
      baselineDate: baseline?.date || openingBaseline?.date || "",
      periodStart,
      dataStart: sorted[firstInPeriod]?.date || "",
      baselineComplete: selectedPeriod === "all" || Boolean(baseline) || Boolean(openingBaseline) || !hasPriorHistory,
    };
  }

  function computeDcaPlan(plan = {}, asOfDate = "") {
    const funds = Array.isArray(plan.funds) ? plan.funds : [];
    const entries = (Array.isArray(plan.entries) ? plan.entries : [])
      .filter((entry) => entry && !entry.voided)
      .slice()
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    const monthKey = String(asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
    const monthlyBudgetUSD = Math.max(0, num(plan.monthlyBudgetUSD));
    const bySymbol = new Map(funds.map((fund) => [String(fund.symbol || "").toUpperCase(), {
      ...fund,
      symbol: String(fund.symbol || "").toUpperCase(),
      shares: 0,
      costBasisUSD: 0,
    }]));

    for (const entry of entries) {
      const symbol = String(entry.symbol || "").toUpperCase();
      if (!symbol) continue;
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, { symbol, name: symbol, targetWeight: 0, price: 0, shares: 0, costBasisUSD: 0 });
      const fund = bySymbol.get(symbol);
      const direction = entry.type === "sell" ? -1 : 1;
      const shares = num(entry.shares);
      const cost = Number.isFinite(Number(entry.costBasisUSD))
        ? num(entry.costBasisUSD)
        : shares * num(entry.price) + num(entry.feeUSD);
      fund.shares += direction * shares;
      fund.costBasisUSD += direction * cost;
    }

    const computedFunds = [...bySymbol.values()].map((fund) => {
      const marketValueUSD = Math.max(0, num(fund.shares)) * num(fund.price);
      const pnlUSD = marketValueUSD - num(fund.costBasisUSD);
      return {
        ...fund,
        shares: Math.max(0, num(fund.shares)),
        costBasisUSD: Math.max(0, num(fund.costBasisUSD)),
        marketValueUSD,
        pnlUSD,
        returnPct: fund.costBasisUSD ? pnlUSD / fund.costBasisUSD * 100 : 0,
      };
    });
    const plannedEntries = entries.filter((entry) => entry.countsTowardPlan !== false && entry.type !== "reinvest" && entry.type !== "sell");
    const monthlyInvestedUSD = plannedEntries
      .filter((entry) => String(entry.date || "").slice(0, 7) === monthKey)
      .reduce((sum, entry) => sum + num(entry.plannedAmountUSD || entry.amountUSD), 0);
    const monthTotals = new Map();
    for (const entry of plannedEntries) {
      const key = String(entry.date || "").slice(0, 7);
      if (key) monthTotals.set(key, (monthTotals.get(key) || 0) + num(entry.plannedAmountUSD || entry.amountUSD));
    }
    const completedMonths = [...monthTotals.entries()].filter(([, value]) => monthlyBudgetUSD > 0 && value >= monthlyBudgetUSD * 0.98).map(([key]) => key).sort();
    let consecutiveMonths = 0;
    if (completedMonths.length) {
      let cursor = completedMonths.at(-1);
      while (completedMonths.includes(cursor)) {
        consecutiveMonths += 1;
        const [year, month] = cursor.split("-").map(Number);
        const previous = new Date(Date.UTC(year, month - 2, 1));
        cursor = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
      }
    }
    const totalCostUSD = computedFunds.reduce((sum, fund) => sum + fund.costBasisUSD, 0);
    const marketValueUSD = computedFunds.reduce((sum, fund) => sum + fund.marketValueUSD, 0);
    const pnlUSD = marketValueUSD - totalCostUSD;
    return {
      monthlyBudgetUSD,
      monthlyInvestedUSD,
      monthlyProgressPct: monthlyBudgetUSD ? Math.min(100, monthlyInvestedUSD / monthlyBudgetUSD * 100) : 0,
      lifetimePlannedUSD: plannedEntries.reduce((sum, entry) => sum + num(entry.plannedAmountUSD || entry.amountUSD), 0),
      totalCostUSD,
      marketValueUSD,
      pnlUSD,
      returnPct: totalCostUSD ? pnlUSD / totalCostUSD * 100 : 0,
      completedMonths,
      consecutiveMonths,
      monthKey,
      funds: computedFunds,
      entries,
    };
  }

  function buildDcaReturnSeries(plan = {}, asOfDate = "") {
    const date = String(asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const stored = (Array.isArray(plan.snapshots) ? plan.snapshots : [])
      .filter((item) => item && String(item.date || "") && num(item.costBasisUSD) > 0)
      .map((item) => {
        const costBasisUSD = num(item.costBasisUSD);
        const marketValueUSD = num(item.marketValueUSD);
        const pnlUSD = Number.isFinite(Number(item.pnlUSD)) ? num(item.pnlUSD) : marketValueUSD - costBasisUSD;
        return {
          date: String(item.date).slice(0, 10),
          costBasisUSD,
          marketValueUSD,
          pnlUSD,
          returnPct: Number.isFinite(Number(item.returnPct)) ? num(item.returnPct) : pnlUSD / costBasisUSD * 100,
        };
      });
    const current = computeDcaPlan(plan, date);
    if (current.totalCostUSD > 0) {
      stored.push({
        date,
        costBasisUSD: current.totalCostUSD,
        marketValueUSD: current.marketValueUSD,
        pnlUSD: current.pnlUSD,
        returnPct: current.returnPct,
      });
    }
    const byDate = new Map();
    stored.sort((a, b) => a.date.localeCompare(b.date)).forEach((item) => byDate.set(item.date, item));
    const points = [...byDate.values()];
    const latest = points.at(-1);
    return {
      points,
      returnPct: latest?.returnPct || 0,
      pnlUSD: latest?.pnlUSD || 0,
      startDate: points[0]?.date || "",
      endDate: latest?.date || "",
    };
  }

  root.MYH88Core = Object.freeze({
    allocateLotSale,
    buildHistoricalSnapshot,
    buildDcaReturnSeries,
    buildReturnSeries,
    computeDcaPlan,
    computeLedgerMetrics,
    createLot,
    lotsBeforeTransaction,
    marketUSD,
    summarizeLots,
    squarifiedTreemap,
    treemapVisualItems,
  });
})(globalThis);
