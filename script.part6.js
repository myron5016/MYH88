const DCA_SEED_VERSION="ibkr-2026-08-06";
const DCA_DEFAULT_PLAN={
  seedVersion:DCA_SEED_VERSION,
  monthlyBudgetUSD:500,
  funds:[
    {symbol:"VOO",name:"Vanguard S&P 500 ETF",issuer:"Vanguard",targetWeight:.6,source:"twelve",price:708.51000975,priceAsOf:"2026-08-06"},
    {symbol:"QQQM",name:"Invesco NASDAQ 100 ETF",issuer:"Invesco",targetWeight:.4,source:"twelve",price:294.3200073,priceAsOf:"2026-08-06"}
  ],
  entries:[
    {id:"dca_20260605_voo",date:"2026-06-05",type:"buy",symbol:"VOO",plannedAmountUSD:300,shares:.4374,price:685.752621,feeUSD:.35034604,costBasisUSD:300.2985424654,countsTowardPlan:true,source:"ibkr"},
    {id:"dca_20260605_qqqm",date:"2026-06-05",type:"buy",symbol:"QQQM",plannedAmountUSD:200,shares:.6732,price:297.069167,feeUSD:.35039391,costBasisUSD:200.3373571344,countsTowardPlan:true,source:"ibkr"},
    {id:"dca_20260629_qqqm_drip",date:"2026-06-29",type:"reinvest",symbol:"QQQM",plannedAmountUSD:0,shares:.0005,price:294.83,feeUSD:.00014762,costBasisUSD:.14756262,countsTowardPlan:false,source:"ibkr"},
    {id:"dca_20260701_voo_drip",date:"2026-07-01",type:"reinvest",symbol:"VOO",plannedAmountUSD:0,shares:.0008,price:683.24,feeUSD:.00054716,costBasisUSD:.54713916,countsTowardPlan:false,source:"ibkr"},
    {id:"dca_20260707_voo",date:"2026-07-07",type:"buy",symbol:"VOO",plannedAmountUSD:300,shares:.4359,price:688.1,feeUSD:.35034574,costBasisUSD:300.29313574,countsTowardPlan:true,source:"ibkr"},
    {id:"dca_20260707_qqqm",date:"2026-07-07",type:"buy",symbol:"QQQM",plannedAmountUSD:200,shares:.6831,price:292.78,feeUSD:.35039592,costBasisUSD:200.34841392,countsTowardPlan:true,source:"ibkr"}
  ],
  snapshots:[
    {date:"2026-06-05",costBasisUSD:500.6358995998,marketValueUSD:499.9351596498,pnlUSD:-.70073995,returnPct:-.1399699763},
    {date:"2026-07-07",costBasisUSD:1001.9721510398,marketValueUSD:998.712114,pnlUSD:-3.2600370398,returnPct:-.3253620409},
    {date:"2026-08-06",costBasisUSD:1001.9721510398,marketValueUSD:1018.6419854271,pnlUSD:16.6698343873,returnPct:1.6637023664}
  ]
};

function normalizeDcaPlan(){
  const incoming=state.dcaPlan&&typeof state.dcaPlan==="object"?state.dcaPlan:{};
  const seeded=!Array.isArray(incoming.funds)||!Array.isArray(incoming.entries);
  const base=seeded?structuredClone(DCA_DEFAULT_PLAN):incoming;
  const defaults=new Map(DCA_DEFAULT_PLAN.funds.map(fund=>[fund.symbol,fund]));
  base.monthlyBudgetUSD=Math.max(0,num(base.monthlyBudgetUSD)||500);
  base.funds=(Array.isArray(base.funds)?base.funds:DCA_DEFAULT_PLAN.funds).map(fund=>{
    const symbol=String(fund.symbol||"").trim().toUpperCase(),fallback=defaults.get(symbol)||{};
    return{...fallback,...fund,symbol,source:"twelve",targetWeight:Math.max(0,num(fund.targetWeight??fallback.targetWeight))}
  }).filter(fund=>fund.symbol);
  base.entries=(Array.isArray(base.entries)?base.entries:[]).map(entry=>({
    ...entry,id:entry.id||uid("dca"),date:String(entry.date||today()),type:entry.type==="reinvest"?"reinvest":"buy",symbol:String(entry.symbol||"").trim().toUpperCase(),plannedAmountUSD:Math.max(0,num(entry.plannedAmountUSD)),shares:Math.max(0,num(entry.shares)),price:Math.max(0,num(entry.price)),feeUSD:Math.max(0,num(entry.feeUSD)),costBasisUSD:Math.max(0,num(entry.costBasisUSD)||num(entry.shares)*num(entry.price)+num(entry.feeUSD)),countsTowardPlan:entry.countsTowardPlan!==false
  })).filter(entry=>entry.symbol&&entry.shares>0);
  base.snapshots=(Array.isArray(base.snapshots)&&base.snapshots.length?base.snapshots:DCA_DEFAULT_PLAN.snapshots).map(item=>({date:String(item.date||"").slice(0,10),costBasisUSD:Math.max(0,num(item.costBasisUSD)),marketValueUSD:Math.max(0,num(item.marketValueUSD)),pnlUSD:num(item.pnlUSD),returnPct:num(item.returnPct)})).filter(item=>item.date&&item.costBasisUSD>0);
  base.seedVersion=base.seedVersion||DCA_SEED_VERSION;
  state.dcaPlan=base;
}

function trackedQuoteItems(){
  const positions=Array.isArray(state.positions)?state.positions:[];
  const funds=Array.isArray(state.dcaPlan?.funds)?state.dcaPlan.funds:[];
  return [...positions,...funds];
}

function dcaMetrics(){return MYH88Core.computeDcaPlan(state.dcaPlan,today())}
function dcaMonthLabel(monthKey){const [year,month]=String(monthKey).split("-");return `${Number(month)}月定投`}
function dcaIssuerMark(fund){
  if(fund.symbol==="VOO")return'<span class="dca-wordmark vanguard"><b>V</b><small>VANGUARD</small></span>';
  return'<span class="dca-wordmark invesco"><b>QQQ</b><small>INVESCO</small></span>'
}
function dcaQuoteLabel(fund){
  const stamp=fund.priceAsOf||fund.priceUpdatedAt;
  if(!stamp)return"价格待刷新";
  const date=new Date(stamp);if(Number.isNaN(date.getTime()))return`${escapeHtml(stamp)} 价格`;
  return`${new Intl.DateTimeFormat("zh-CN",{timeZone:US_MARKET_TZ,month:"numeric",day:"numeric"}).format(date)} 收盘/最新价`
}
function drawDcaReturnChart(series){
  const svg=$("dcaReturnChart"),empty=$("dcaReturnEmpty"),points=series.points;
  if(points.length<2){svg.classList.add("hidden");empty.classList.remove("hidden");return}
  svg.classList.remove("hidden");empty.classList.add("hidden");
  const mobile=svg.clientWidth&&svg.clientWidth<560,W=mobile?430:760,H=mobile?190:170,pad=mobile?{l:56,r:16,t:14,b:32}:{l:58,r:18,t:14,b:30},raw=points.map(point=>num(point.returnPct)),rawMin=Math.min(0,...raw),rawMax=Math.max(0,...raw),spread=Math.max(rawMax-rawMin,.4),min=rawMin-spread*.14,max=rawMax+spread*.14,range=max-min,x=index=>pad.l+index*(W-pad.l-pad.r)/Math.max(points.length-1,1),y=value=>pad.t+(max-value)*(H-pad.t-pad.b)/range,line=points.map((point,index)=>(index?"L":"M")+x(index).toFixed(1)+" "+y(point.returnPct).toFixed(1)).join(" "),zeroY=y(0),tone=series.returnPct>=0?"#ef476f":"#22b573",area=`${line} L ${x(points.length-1)} ${zeroY} L ${x(0)} ${zeroY} Z`;
  let grid="";for(let index=0;index<3;index++){const value=max-range*index/2,yy=y(value);grid+=`<line class="return-grid" x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/><text class="return-axis-label" x="4" y="${yy+4}">${value>0?"+":""}${round(value,1)}%</text>`}
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.innerHTML=`<defs><linearGradient id="dcaReturnGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone}" stop-opacity=".24"/><stop offset="1" stop-color="${tone}" stop-opacity=".02"/></linearGradient></defs>${grid}<line class="return-zero" x1="${pad.l}" y1="${zeroY}" x2="${W-pad.r}" y2="${zeroY}"/><path class="return-area" fill="url(#dcaReturnGradient)" d="${area}"/><path class="return-line" stroke="${tone}" d="${line}"/><circle class="return-last-dot" fill="${tone}" cx="${x(points.length-1)}" cy="${y(points.at(-1).returnPct)}" r="4.5"/><text class="return-date-label" x="${pad.l}" y="${H-6}">${escapeHtml(returnDateLabel(points[0].date))}</text><text class="return-date-label" text-anchor="end" x="${W-pad.r}" y="${H-6}">${escapeHtml(returnDateLabel(points.at(-1).date))}</text>`
}
function captureDcaSnapshot(date=today()){
  const result=dcaMetrics();if(!result.totalCostUSD)return false;
  const snapshot={date:String(date).slice(0,10),costBasisUSD:round(result.totalCostUSD,6),marketValueUSD:round(result.marketValueUSD,6),pnlUSD:round(result.pnlUSD,6),returnPct:round(result.returnPct,6)},list=state.dcaPlan.snapshots||(state.dcaPlan.snapshots=[]),index=list.findIndex(item=>item.date===snapshot.date),before=index>=0?JSON.stringify(list[index]):"",changed=before!==JSON.stringify(snapshot);
  if(index>=0)list[index]=snapshot;else list.push(snapshot);list.sort((a,b)=>a.date.localeCompare(b.date));saveLocal();return changed
}
function renderDcaZone(){
  const zone=$("dcaZone");if(!zone||!state.dcaPlan)return;
  const result=dcaMetrics();
  $("dcaMonthTitle").textContent=dcaMonthLabel(result.monthKey);
  $("dcaProgressValue").textContent=`${money(result.monthlyInvestedUSD)} / ${money(result.monthlyBudgetUSD)}`;
  $("dcaProgressBar").style.width=`${result.monthlyProgressPct}%`;
  $("dcaProgressPercent").textContent=`${round(result.monthlyProgressPct,1)}%`;
  $("dcaStreak").textContent=`连续完成 ${result.consecutiveMonths} 期`;
  $("dcaFundGrid").innerHTML=result.funds.map(fund=>{
    const target=round(num(fund.targetWeight)*100,0),targetAmount=result.monthlyBudgetUSD*num(fund.targetWeight),tone=fund.pnlUSD>=0?"red":"green";
    return`<article class="dca-fund-card dca-${fund.symbol.toLowerCase()}"><div class="dca-fund-head">${dcaIssuerMark(fund)}<span class="dca-target">计划 ${target}% · ${money(targetAmount)}</span></div><div class="dca-fund-main"><div><strong>${escapeHtml(fund.symbol)}</strong><small>${escapeHtml(fund.name)}</small></div><b>${money(fund.marketValueUSD)}</b></div><div class="dca-fund-stats"><span><small>持仓</small><b>${round(fund.shares,4)} 股</b></span><span><small>累计成本</small><b>${money(fund.costBasisUSD)}</b></span><span><small>定投收益</small><b class="${tone}">${money(fund.pnlUSD)} / ${fund.returnPct>0?"+":""}${round(fund.returnPct,2)}%</b></span></div><div class="dca-price-line"><span>${dcaQuoteLabel(fund)}</span><b>${money(fund.price)}</b></div></article>`
  }).join("");
  $("dcaTotalCost").textContent=money(result.totalCostUSD);
  $("dcaTotalValue").textContent=money(result.marketValueUSD);
  $("dcaTotalPnl").textContent=`${money(result.pnlUSD)} / ${result.returnPct>0?"+":""}${round(result.returnPct,2)}%`;
  $("dcaTotalPnl").className=cls(result.pnlUSD);
  const returnSeries=MYH88Core.buildDcaReturnSeries(state.dcaPlan,today()),returnValue=$("dcaReturnValue"),returnPnl=$("dcaReturnPnl");
  returnValue.textContent=`${returnSeries.returnPct>0?"+":""}${round(returnSeries.returnPct,2)}%`;returnValue.className=cls(returnSeries.returnPct);returnPnl.textContent=`定投盈亏 ${money(returnSeries.pnlUSD)}`;returnPnl.className=cls(returnSeries.pnlUSD);$("dcaReturnRange").textContent=returnSeries.points.length?`${returnDateLabel(returnSeries.startDate)} 至 ${returnDateLabel(returnSeries.endDate)}`:"暂无快照";drawDcaReturnChart(returnSeries);
  $("dcaHistoryList").innerHTML=result.entries.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(entry=>`<div class="dca-history-row"><time>${escapeHtml(entry.date)}</time><strong>${escapeHtml(entry.symbol)}</strong><span>${entry.type==="reinvest"?"红利再投":`计划 ${money(entry.plannedAmountUSD)}`}</span><span>${round(entry.shares,4)} 股 · ${money(entry.costBasisUSD)}</span>${isAdminMode?`<button type="button" class="dca-delete" onclick="deleteDcaEntry('${entry.id}')" title="删除这条记录">删除</button>`:""}</div>`).join("");
}

function openDcaEntry(){
  const result=dcaMetrics(),fund=result.funds[0];
  $("dcaDate").value=today();$("dcaSymbol").value=fund?.symbol||"VOO";syncDcaEntryDefaults();$("dcaNote").value="";$("dcaCountsTowardPlan").checked=true;$("dcaEntryDialog").showModal()
}
function syncDcaEntryDefaults(){
  const fund=state.dcaPlan.funds.find(item=>item.symbol===$("dcaSymbol").value)||state.dcaPlan.funds[0],target=num(state.dcaPlan.monthlyBudgetUSD)*num(fund?.targetWeight),price=num(fund?.price);
  $("dcaPlannedAmount").value=round(target,2);$("dcaPrice").value=price?round(price,4):"";$("dcaShares").value=price?round(target/price,6):"";$("dcaFee").value="0.35";updateDcaEntryPreview()
}
function updateDcaEntryPreview(){
  const amount=num($("dcaPlannedAmount").value),shares=num($("dcaShares").value),price=num($("dcaPrice").value),fee=num($("dcaFee").value),cost=shares*price+fee;
  $("dcaEntryPreview").innerHTML=`<span><small>计划进度增加</small><b>${money($("dcaCountsTowardPlan").checked?amount:0)}</b></span><span><small>实际成本</small><b>${money(cost)}</b></span><span><small>新增份额</small><b>${round(shares,6)}</b></span>`
}
function submitDcaEntry(event){
  event.preventDefault();const symbol=$("dcaSymbol").value,date=$("dcaDate").value,planned=Math.max(0,num($("dcaPlannedAmount").value)),shares=Math.max(0,num($("dcaShares").value)),price=Math.max(0,num($("dcaPrice").value)),fee=Math.max(0,num($("dcaFee").value));
  if(!date||!symbol||shares<=0||price<=0){alert("请完整填写日期、ETF、份额和成交价");return}
  state.dcaPlan.entries.push({id:uid("dca"),date,type:"buy",symbol,plannedAmountUSD:planned,shares,price,feeUSD:fee,costBasisUSD:shares*price+fee,countsTowardPlan:$("dcaCountsTowardPlan").checked,note:$("dcaNote").value.trim(),source:"manual"});
  const fund=state.dcaPlan.funds.find(item=>item.symbol===symbol);if(fund){fund.price=price;fund.priceAsOf=date}
  captureDcaSnapshot(date);
  markDirty(`${symbol} 定投记录已新增`);$("dcaEntryDialog").close();renderAll()
}
function deleteDcaEntry(id){
  const entry=state.dcaPlan.entries.find(item=>item.id===id);if(!entry||!confirm(`删除 ${entry.date} 的 ${entry.symbol} 定投记录？`))return;
  state.dcaPlan.entries=state.dcaPlan.entries.filter(item=>item.id!==id);captureDcaSnapshot();markDirty(`${entry.symbol} 定投记录已删除`);renderAll()
}

const normalizeStateBeforeDca=normalizeState;
normalizeState=function(raw){normalizeStateBeforeDca(raw);normalizeDcaPlan()};
const renderAllBeforeDca=renderAll;
renderAll=function(){renderAllBeforeDca();renderDcaZone()};
const captureActiveSnapshotBeforeDca=captureSnapshot;
captureSnapshot=function(manual=false){const changed=captureActiveSnapshotBeforeDca(manual);captureDcaSnapshot();return changed};

document.addEventListener("DOMContentLoaded",()=>{
  ["dcaPlannedAmount","dcaShares","dcaPrice","dcaFee"].forEach(id=>$(id)?.addEventListener("input",updateDcaEntryPreview));
  $("dcaCountsTowardPlan")?.addEventListener("change",updateDcaEntryPreview);
  $("dcaSymbol")?.addEventListener("change",syncDcaEntryDefaults);
});
