const lotCore=globalThis.MYH88Core;
let tradeLotDraftAllocations=[];

function lotMethodLabel(method){return({specific:"指定批次",highest:"最高成本",fifo:"先进先出",lifo:"后进先出",average:"历史平均"})[method]||"历史平均"}
function currentTradeLots(){
  const symbol=$("tradeSymbol").value.trim().toUpperCase(),editId=$("tradeEditId").value;
  if(!symbol||!lotCore)return[];
  return lotCore.lotsBeforeTransaction(state.transactions,editId,symbol);
}
function readLotInputs(){
  return [...document.querySelectorAll(".trade-lot-shares")].map(input=>({buyTransactionId:input.dataset.lotId,shares:num(input.value)})).filter(item=>item.shares>0);
}
function updateTradeLotSummary(){
  const quantity=num($("tradeShares").value),method=$("tradeLotMethod").value||"specific",lots=currentTradeLots(),available=lotCore.summarizeLots(lots),manual=method==="specific"?readLotInputs():[];let result=null;
  try{if(quantity>0)result=lotCore.allocateLotSale(lots,quantity,method,manual)}catch{}
  const selected=method==="specific"?manual.reduce((sum,item)=>sum+item.shares,0):num(result?.allocations?.reduce((sum,item)=>sum+item.shares,0)),warning=quantity>0&&!result?(method==="specific"?"请为本次卖出分配完整批次数量":"当前批次不足以完成卖出"):"";
  $("tradeLotSummary").innerHTML=`<span>可用 ${round(available.shares,6)} 股</span><span>本次 ${round(quantity,6)} 股</span><span>已分配 ${round(selected,6)} 股</span>${result?`<span>卖出成本 ${money(result.costBasisUSD)}</span>`:""}${warning?`<span class="lot-warning">${warning}</span>`:""}`;
}
function tradeLotResult(strict=false){
  if($("tradeType").value!=="sell")return null;
  const quantity=num($("tradeShares").value),method=$("tradeLotMethod").value||"specific",lots=currentTradeLots(),manual=method==="specific"?readLotInputs():[];
  if(quantity<=0){if(strict)throw new Error("请填写卖出数量");return null}
  try{return lotCore.allocateLotSale(lots,quantity,method,manual)}catch(error){
    if(strict){
      const message=error.message.includes("Selected lot quantity")?"指定批次数量之和必须等于卖出数量":error.message.includes("exceeds")?"卖出数量超过可用持仓批次":"无法完成批次分配，请核对数量";
      throw new Error(message);
    }
    return null;
  }
}
function renderTradeLotPanel(){
  const panel=$("tradeLotPanel");if(!panel)return;
  const selling=$("tradeType").value==="sell";panel.classList.toggle("hidden",!selling);if(!selling)return;
  const method=$("tradeLotMethod").value||"specific",quantity=num($("tradeShares").value),lots=currentTradeLots();
  const preserved=method==="specific"?new Map([...tradeLotDraftAllocations,...readLotInputs()].map(item=>[String(item.buyTransactionId||item.lotId),num(item.shares)])):new Map();
  let result=null,warning="";
  try{if(quantity>0)result=lotCore.allocateLotSale(lots,quantity,method,method==="specific"?[...preserved].map(([buyTransactionId,shares])=>({buyTransactionId,shares})):[])}catch(error){warning=method==="specific"?"请为本次卖出分配完整批次数量":"当前批次不足以完成卖出"}
  const picked=new Map((result?.allocations||[]).map(item=>[item.buyTransactionId,item.shares]));
  const available=lotCore.summarizeLots(lots),selected=method==="specific"?[...preserved.values()].reduce((sum,value)=>sum+value,0):num(result?.allocations?.reduce((sum,item)=>sum+item.shares,0));
  $("tradeLotSummary").innerHTML=`<span>可用 ${round(available.shares,6)} 股</span><span>本次 ${round(quantity,6)} 股</span><span>已分配 ${round(selected,6)} 股</span>${result?`<span>卖出成本 ${money(result.costBasisUSD)}</span>`:""}${warning?`<span class="lot-warning">${warning}</span>`:""}`;
  $("tradeLotList").innerHTML=lots.length?lots.map(lot=>{
    const id=escapeHtml(lot.buyTransactionId),unit=num(lot.remainingCostBasisUSD)/Math.max(num(lot.remainingShares),1e-8),value=method==="specific"?num(preserved.get(lot.buyTransactionId)):num(picked.get(lot.buyTransactionId));
    const control=method==="specific"?`<input class="trade-lot-shares lot-input" data-lot-id="${id}" type="number" min="0" max="${round(lot.remainingShares,8)}" step="any" value="${value||""}" placeholder="本次卖出股数">`:`<span class="lot-picked">${value?`扣减 ${round(value,6)} 股`:"不使用"}</span>`;
    return `<div class="lot-row"><div><strong>${escapeHtml(lot.date||"期初")}</strong><small>批次 ${escapeHtml(lot.buyTransactionId.slice(-8))}</small></div><div><strong>${round(lot.remainingShares,6)} 股</strong><small>剩余数量</small></div><div><strong>${money(unit)}/股</strong><small>含手续费成本</small></div>${control}</div>`
  }).join(""):'<div class="empty">这笔卖出之前没有可用买入批次</div>';
  document.querySelectorAll(".trade-lot-shares").forEach(input=>input.addEventListener("input",()=>{tradeLotDraftAllocations=readLotInputs();updateTradeLotSummary();updateTradePreview()}));
  updateTradePreview();
}

function updateTradePreview(){
  const type=$("tradeType").value,qty=num($("tradeShares").value),price=num($("tradePrice").value),rate=num($("tradeFx").value),fee=num($("tradeFee").value),symbol=$("tradeSymbol").value.trim().toUpperCase(),p=state.positions.find(x=>x.symbol===symbol),cashBefore=cashBalance(),buyCost=(qty*price+fee)*rate,sellGross=qty*price*rate,sellFee=fee*rate,sellCash=Math.max(0,sellGross-sellFee),historicalSell=type==="sell"&&Boolean($("tradeEditId").value),historicalSummary=historicalSell?lotCore.summarizeLots(currentTradeLots()):null,sharesBefore=historicalSummary?historicalSummary.shares:num(p?.shares),costBefore=historicalSummary?historicalSummary.costBasisUSD:num(p?.costBasisUSD);
  let cashAfter=cashBefore,sharesAfter=sharesBefore,costAfter=costBefore,avgAfter=p?num(p.avgCost):0,extraTitle=type==="sell"?"预计已实现":"买后均价",extraValue="—",extraClass="",detail="";
  if(type==="buy"||type==="opening"){
    cashAfter=cashBefore-buyCost;sharesAfter=sharesBefore+qty;costAfter=costBefore+buyCost;avgAfter=sharesAfter?((num(p?.avgCost)*sharesBefore)+(qty*price+fee))/sharesAfter:0;extraValue=`${round(avgAfter,4)} ${$("tradeCurrency").value}`;
  }else{
    const lotResult=tradeLotResult(false),basis=lotResult?lotResult.costBasisUSD:0,realized=sellGross-sellFee-basis;
    cashAfter=cashBefore+sellCash;sharesAfter=Math.max(0,sharesBefore-qty);costAfter=Math.max(0,costBefore-basis);
    if(lotResult){extraValue=money(realized);extraClass=cls(realized);detail=`${lotMethodLabel(lotResult.method)} · 成本 ${money(basis)}`}else{extraValue="等待批次分配";detail="卖出数量必须与批次分配一致"}
  }
  $("tradePreview").innerHTML=`<div class="trade-preview-grid"><div><span>现金变化</span><strong class="${cls(cashAfter-cashBefore)}">${money(cashAfter-cashBefore)}</strong><small>${money(cashBefore)} → ${money(cashAfter)}</small></div><div><span>持仓数量</span><strong>${round(sharesBefore,4)} → ${round(sharesAfter,4)}</strong><small>${symbol||"未选择资产"}</small></div><div><span>持仓成本</span><strong>${money(costAfter-costBefore)}</strong><small>${money(costBefore)} → ${money(costAfter)}</small></div><div><span>${extraTitle}</span><strong class="${extraClass}">${extraValue}</strong><small>${type==="sell"?detail:`占用 ${money(buyCost)}`}</small></div></div>`;
}

function tradeFormDraft(existing={}){
  const type=$("tradeType").value,symbol=$("tradeSymbol").value.trim().toUpperCase(),date=$("tradeDate").value,shares=num($("tradeShares").value),price=num($("tradePrice").value),currency=$("tradeCurrency").value,rate=num($("tradeFx").value),fee=num($("tradeFee").value),note=$("tradeNote").value.trim();
  if(!symbol||!date||shares<=0||price<0||rate<=0||fee<0)throw new Error("请检查交易信息");
  const sector=inferSector(symbol,$("tradeName").value.trim()||existing.name,$("tradeSector").value.trim()),color=tradeColorAuto?colorForSectorMember(sector,state.positions.filter(p=>inferSector(p.symbol,p.name,p.sector)===sector).length):validColor($("tradeColor").value);
  const draft={...existing,id:existing.id||uid("tx"),date,type:type==="opening"?"opening":type,symbol,name:$("tradeName").value.trim()||existing.name||symbol,shares,price,currency,fxRate:rate,fee,note,source:$("tradeSource").value,sector,color,schemaVersion:"10.48"};
  if(type==="sell"){
    const result=tradeLotResult(true);draft.lotMethod=result.method;draft.lotAllocations=result.allocations;
  }else{delete draft.lotMethod;delete draft.lotAllocations}
  return draft;
}

function rebuildCurrentPositionsFromTransactions(transactions=state.transactions){
  const meta=transactionMetaMap(transactions),positions=[],bySymbol={},baselineDates=openingBaselineDates(transactions),rebuiltByOrder={};
  orderedTransactionsForRebuild(transactions).forEach(original=>{
    const index=original._order,t={...original};
    if(t.voided){rebuiltByOrder[index]=t;return}
    const type=t.type==="sell"?"sell":"buy",symbol=String(t.symbol||"").trim().toUpperCase(),shares=num(t.shares),price=num(t.price),currency=String(t.currency||meta[symbol]?.currency||"USD").toUpperCase(),rate=num(t.fxRate)||fx(currency),fee=num(t.fee);
    if(!symbol||shares<=0||price<0||rate<=0||fee<0)throw new Error("Transaction #"+(index+1)+" is incomplete");
    const m=meta[symbol]||{},nativeValue=shares*price,nativeCost=nativeValue+fee,feeUSD=fee*rate;
    if(!transactionAffectsCurrentPosition(t,baselineDates)){
      const grossUSD=nativeValue*rate,keptBasis=num(t.costBasisUSD),keptRealized=Number.isFinite(Number(t.realizedPnlUSD))?num(t.realizedPnlUSD):(type==="sell"?grossUSD-feeUSD-keptBasis:0);
      rebuiltByOrder[index]={...t,type:original.type==="sell"?"sell":"buy",symbol,name:t.name||m.name||symbol,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:keptBasis,grossUSD,realizedPnlUSD:keptRealized,sector:t.sector||m.sector,color:validColor(t.color||m.color),source:t.source||m.source||"twelve",schemaVersion:t.schemaVersion||"10.6",closedHistory:true};return;
    }
    if(type==="buy"){
      let p=bySymbol[symbol];const usdCost=Number.isFinite(Number(t.costBasisUSD))?num(t.costBasisUSD):nativeCost*rate;
      if(!p){p=normalizePosition({id:m.id||uid("pos"),symbol,name:t.name||m.name||symbol,currency,source:t.source||m.source||"twelve",shares:0,avgCost:0,price:m.price||price,sector:t.sector||m.sector||"未分类",color:validColor(t.color||m.color),sectorLocked:m.sectorLocked,colorLocked:m.colorLocked,note:m.note||"",costBasisUSD:0,changePercent:m.changePercent||0,lots:[]});bySymbol[symbol]=p;positions.push(p)}
      if(p.currency!==currency)throw new Error(symbol+" has mixed-currency trades and cannot be rebuilt automatically");
      const rebuilt={...t,type:original.type==="opening"?"opening":"buy",symbol,name:t.name||p.name,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:usdCost,costBasisNative:nativeCost,grossUSD:nativeValue*rate,realizedPnlUSD:0,sector:t.sector||p.sector,color:validColor(t.color||p.color),source:t.source||p.source,schemaVersion:t.schemaVersion||"10.48"};
      p.lots=p.lots||[];p.lots.push(lotCore.createLot(rebuilt,index));const summary=lotCore.summarizeLots(p.lots);p.shares=summary.shares;p.costBasisUSD=summary.costBasisUSD;p.avgCost=summary.avgCostNative;p.name=rebuilt.name;p.sector=rebuilt.sector;p.color=rebuilt.color;p.source=rebuilt.source;p.price=num(m.price)||p.price||price;rebuiltByOrder[index]=rebuilt;return;
    }
    const p=bySymbol[symbol];
    if(!p){rebuiltByOrder[index]={...t,type:"sell",symbol,name:t.name||m.name||symbol,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:num(t.costBasisUSD),grossUSD:nativeValue*rate,realizedPnlUSD:Number.isFinite(Number(t.realizedPnlUSD))?num(t.realizedPnlUSD):nativeValue*rate-feeUSD-num(t.costBasisUSD),sector:t.sector||m.sector,color:validColor(t.color||m.color),source:t.source||m.source||"twelve",schemaVersion:t.schemaVersion||"10.6",closedHistory:true};return}
    if(p.shares+1e-9<shares)throw new Error(symbol+" sell quantity exceeds the current rebuilt holding");
    const hasAllocation=Array.isArray(t.lotAllocations)&&t.lotAllocations.length>0,method=t.lotMethod||(hasAllocation?"specific":"average"),allocationMethod=hasAllocation?"specific":method,lotResult=lotCore.allocateLotSale(p.lots||[],shares,allocationMethod,t.lotAllocations||[]),basis=lotResult.costBasisUSD,grossUSD=nativeValue*rate,realized=grossUSD-feeUSD-basis,summary=lotResult.remaining;
    p.lots=lotResult.lots;p.shares=summary.shares;p.costBasisUSD=summary.costBasisUSD;p.avgCost=summary.avgCostNative;p.price=num(m.price)||price;
    if(p.shares<=1e-8){delete bySymbol[symbol];const idx=positions.findIndex(x=>x.symbol===symbol);if(idx>=0)positions.splice(idx,1)}
    const lotFields=t.lotMethod||hasAllocation?{lotMethod:method,lotAllocations:lotResult.allocations}:{};
    rebuiltByOrder[index]={...t,...lotFields,type:"sell",symbol,name:t.name||m.name||symbol,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:basis,costBasisNative:lotResult.costBasisNative,grossUSD,realizedPnlUSD:realized,sector:t.sector||m.sector,color:validColor(t.color||m.color),source:t.source||m.source||"twelve",schemaVersion:t.schemaVersion||"10.48"};
  });
  state.transactions=transactions.map((_,index)=>rebuiltByOrder[index]||transactions[index]).map(({_order,...t})=>t);
  state.positions=positions.map(normalizePosition).filter(p=>p.symbol&&p.shares>0);applyAutoTaxonomy(true);
}

function openTrade(type,positionId=""){
  if(!requireAdminMode())return;
  tradeSectorAuto=!positionId;tradeColorAuto=!positionId;tradeLotDraftAllocations=[];$("tradeEditId").value="";$("tradeType").value=type;$("tradeTitle").textContent=type==="buy"?"记录买入":"记录卖出";$("tradeDate").value=today();$("tradeSymbol").value="";$("tradeShares").value="";$("tradePrice").value="";$("tradeFee").value="0";$("tradeCurrency").value="USD";$("tradeFx").value="1";$("tradeName").value="";$("tradeSector").value="未分类";$("tradeColor").value="#38bdf8";$("tradeSource").value="twelve";$("tradeNote").value="";$("tradeLotMethod").value=type==="sell"?"specific":"average";const existing=state.positions.find(p=>p.id===positionId);if(existing)fillTradeFromPosition(existing);["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(id=>$(id).classList.toggle("hidden",type==="sell"));renderTradeLotPanel();updateTradePreview();$("tradeDialog").showModal();setTimeout(()=>$("tradeSymbol").focus(),30);
}
function openTradeEdit(id){
  if(!requireAdminMode())return;
  const t=state.transactions.find(x=>x.id===id);if(!t||t.voided)return;const m=transactionMetaMap()[t.symbol]||{};tradeSectorAuto=false;tradeColorAuto=false;tradeLotDraftAllocations=structuredClone(t.lotAllocations||[]);
  $("tradeEditId").value=t.id;$("tradeType").value=t.type==="opening"?"opening":t.type;$("tradeTitle").textContent=t.type==="sell"?`编辑卖出批次：${t.symbol}`:`编辑交易：${t.symbol}`;$("tradeDate").value=t.date||today();$("tradeSymbol").value=t.symbol||"";$("tradeShares").value=t.shares||"";$("tradePrice").value=t.price||"";$("tradeFee").value=t.fee||0;$("tradeCurrency").value=t.currency||m.currency||"USD";$("tradeFx").value=t.fxRate||fx(t.currency);$("tradeName").value=t.name||m.name||"";$("tradeSector").value=t.sector||m.sector||"未分类";$("tradeColor").value=validColor(t.color||m.color);$("tradeSource").value=t.source||m.source||"twelve";$("tradeNote").value=t.note||"";$("tradeLotMethod").value=t.lotMethod||(t.lotAllocations?.length?"specific":"average");["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(labelId=>$(labelId).classList.remove("hidden"));renderTradeLotPanel();updateTradePreview();$("tradeDialog").showModal();
}
function renderTransactionTable(){
  const q=$("transactionSearch")?.value.trim().toUpperCase()||"",type=$("transactionTypeFilter")?.value||"all",filtered=state.transactions.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).filter(t=>(!q||String(t.symbol).includes(q))&&(type==="all"||t.type===type)),pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));transactionPage=Math.min(transactionPage,pages);const items=filtered.slice((transactionPage-1)*PAGE_SIZE,transactionPage*PAGE_SIZE);
  $("transactionBody").innerHTML=items.length?items.map(t=>{const method=t.type==="sell"?`<small class="lot-method-badge">${lotMethodLabel(t.lotMethod||(t.lotAllocations?.length?"specific":"average"))}</small>`:"";return`<tr class="${t.voided?"muted":""}"><td>${escapeHtml(t.date)}</td><td><span class="type-pill">${transactionLabel(t)}</span>${method}</td><td><strong>${escapeHtml(t.symbol)}</strong></td><td>${round(t.shares,4)}</td><td>${round(t.price,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fee,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fxRate,6)}</td><td class="${t.voided?"muted":cls(t.realizedPnlUSD)}">${t.type==="sell"?money(t.realizedPnlUSD):"—"}</td><td>${escapeHtml(t.note||"")}</td><td>${isAdminMode&&!t.voided?`<div class="correction-buttons"><button onclick="openTradeEdit('${t.id}')">${t.type==="sell"?"编辑批次":"编辑"}</button><button class="danger" onclick="deleteTransaction('${t.id}')">删除</button></div>`:"—"}</td></tr>`}).join(""):'<tr><td colspan="10" class="muted">暂无交易记录</td></tr>';
  $("transactionPager").innerHTML=`<button ${transactionPage<=1?"disabled":""} onclick="transactionPage--;renderTransactionTable()">上一页</button><span>${transactionPage} / ${pages} · 共 ${filtered.length} 条</span><button ${transactionPage>=pages?"disabled":""} onclick="transactionPage++;renderTransactionTable()">下一页</button>`;
}

document.addEventListener("DOMContentLoaded",()=>{
  $("tradeLotMethod")?.addEventListener("change",()=>{tradeLotDraftAllocations=[];renderTradeLotPanel()});
  $("tradeShares")?.addEventListener("input",renderTradeLotPanel);
  $("tradeSymbol")?.addEventListener("input",renderTradeLotPanel);
  $("tradeSymbol")?.addEventListener("change",renderTradeLotPanel);
});
