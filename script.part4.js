function requireAdminMode(){
  if(isAdminMode)return true;
  alert("仅管理员可以修改梦想金库账本");
  return false;
}
function commitTransactionChange(nextTransactions,reason){
  if(!requireAdminMode())return false;
  const before=structuredClone(state);
  createBackup(reason+"前");
  try{
    rebuildCurrentPositionsFromTransactions(nextTransactions);
    captureSnapshot(false);markDirty(reason);renderAll();switchLedgerTab("transactions");
  }catch(error){
    state=before;saveLocal();renderAll();alert("操作失败："+error.message);
  }
}
function openTrade(type,positionId=""){
  if(!requireAdminMode())return;
  tradeSectorAuto=!positionId;tradeColorAuto=!positionId;$("tradeEditId").value="";$("tradeType").value=type;$("tradeTitle").textContent=type==="buy"?"记录买入":"记录卖出";$("tradeDate").value=today();$("tradeSymbol").value="";$("tradeShares").value="";$("tradePrice").value="";$("tradeFee").value="0";$("tradeCurrency").value="USD";$("tradeFx").value="1";$("tradeName").value="";$("tradeSector").value="未分类";$("tradeColor").value="#38bdf8";$("tradeSource").value="twelve";$("tradeNote").value="";const existing=state.positions.find(p=>p.id===positionId);if(existing)fillTradeFromPosition(existing);["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(id=>$(id).classList.toggle("hidden",type==="sell"));updateTradePreview();$("tradeDialog").showModal();setTimeout(()=>$("tradeSymbol").focus(),30)
}
function openTradeEdit(id){
  if(!requireAdminMode())return;
  const t=state.transactions.find(x=>x.id===id);if(!t||t.voided)return;
  const m=transactionMetaMap()[t.symbol]||{};
  tradeSectorAuto=false;tradeColorAuto=false;
  $("tradeEditId").value=t.id;$("tradeType").value=t.type==="opening"?"opening":t.type;$("tradeTitle").textContent=`编辑交易：${t.symbol}`;$("tradeDate").value=t.date||today();$("tradeSymbol").value=t.symbol||"";$("tradeShares").value=t.shares||"";$("tradePrice").value=t.price||"";$("tradeFee").value=t.fee||0;$("tradeCurrency").value=t.currency||m.currency||"USD";$("tradeFx").value=t.fxRate||fx(t.currency);$("tradeName").value=t.name||m.name||"";$("tradeSector").value=t.sector||m.sector||"未分类";$("tradeColor").value=validColor(t.color||m.color);$("tradeSource").value=t.source||m.source||"twelve";$("tradeNote").value=t.note||"";["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(id=>$(id).classList.remove("hidden"));updateTradePreview();$("tradeDialog").showModal();
}
function submitTrade(event){
  event.preventDefault();
  if(!requireAdminMode())return;
  const editId=$("tradeEditId").value;
  if(editId){
    const existing=state.transactions.find(t=>t.id===editId);if(!existing)return;
    try{const draft=tradeFormDraft(existing),next=state.transactions.map(t=>t.id===editId?draft:t);commitTransactionChange(next,`${draft.symbol} 交易已编辑`);$("tradeDialog").close()}catch(error){alert(error.message)}
    return;
  }
  try{
    const draft=tradeFormDraft({});
    commitTransactionChange([...state.transactions,draft],`${draft.symbol} ${draft.type==="sell"?"卖出":"买入"}交易已记录`);
    $("tradeDialog").close();switchLedgerTab(draft.type==="sell"?"transactions":"positions");
  }catch(error){alert(error.message)}
}
function deleteTransaction(id){
  if(!requireAdminMode())return;
  const t=state.transactions.find(x=>x.id===id);if(!t)return;
  if(!confirm(`删除这条交易记录？\n${transactionLabel(t)} ${t.symbol} ${t.shares} 股 @ ${t.price} ${t.currency}\n\n系统会用剩余流水重新计算当前持仓。`))return;
  commitTransactionChange(state.transactions.filter(x=>x.id!==id),`${t.symbol} 交易已删除`);
}
function renderTransactionTable(){const q=$("transactionSearch")?.value.trim().toUpperCase()||"",type=$("transactionTypeFilter")?.value||"all",filtered=state.transactions.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).filter(t=>(!q||String(t.symbol).includes(q))&&(type==="all"||t.type===type)),pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));transactionPage=Math.min(transactionPage,pages);const items=filtered.slice((transactionPage-1)*PAGE_SIZE,transactionPage*PAGE_SIZE);$("transactionBody").innerHTML=items.length?items.map(t=>`<tr class="${t.voided?"muted":""}"><td>${escapeHtml(t.date)}</td><td><span class="type-pill">${transactionLabel(t)}</span></td><td><strong>${escapeHtml(t.symbol)}</strong></td><td>${round(t.shares,4)}</td><td>${round(t.price,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fee,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fxRate,6)}</td><td class="${t.voided?"muted":cls(t.realizedPnlUSD)}">${t.type==="sell"?money(t.realizedPnlUSD):"—"}</td><td>${escapeHtml(t.note||"")}</td><td>${isAdminMode&&!t.voided?`<div class="correction-buttons"><button onclick="openTradeEdit('${t.id}')">编辑</button><button class="danger" onclick="deleteTransaction('${t.id}')">删除</button></div>`:"—"}</td></tr>`).join(""):'<tr><td colspan="10" class="muted">暂无交易记录</td></tr>';$("transactionPager").innerHTML=`<button ${transactionPage<=1?"disabled":""} onclick="transactionPage--;renderTransactionTable()">上一页</button><span>${transactionPage} / ${pages} · 共 ${filtered.length} 条</span><button ${transactionPage>=pages?"disabled":""} onclick="transactionPage++;renderTransactionTable()">下一页</button>`}
function editPosition(id){
  if(!requireAdminMode())return;
  const p=state.positions.find(x=>x.id===id);if(!p)return;$("positionEditId").value=p.id;$("positionEditTitle").textContent=`编辑资产：${p.symbol}`;$("positionEditName").value=p.name||"";$("positionEditSector").value=p.sector||"未分类";$("positionEditSectorLocked").checked=Boolean(p.sectorLocked);$("positionEditSource").value=p.source||"twelve";$("positionEditPrice").value=p.price||0;$("positionEditColor").value=validColor(p.color);$("positionEditColorLocked").checked=Boolean(p.colorLocked);$("positionDialog").showModal()
}
function setPositionEditColor(color){$("positionEditColor").value=validColor(color)}
function submitPositionEdit(event){
  event.preventDefault();if(!requireAdminMode())return;const id=$("positionEditId").value,p=state.positions.find(x=>x.id===id);if(!p)return;const color=validColor($("positionEditColor").value),source=$("positionEditSource").value;if(!["twelve","manual"].includes(source)){alert("数据源只能是 Twelve 或 Manual");return}
  createBackup(`${p.symbol} 资料编辑前`);
  p.name=$("positionEditName").value.trim()||p.symbol;p.sector=$("positionEditSector").value.trim()||"未分类";p.sectorLocked=$("positionEditSectorLocked").checked;p.source=source;p.color=color;p.colorLocked=$("positionEditColorLocked").checked;if(source==="manual"&&num($("positionEditPrice").value)>=0){p.price=num($("positionEditPrice").value);p.priceSource="manual";p.priceProvider="manual";p.priceUpdatedAt=new Date().toISOString()}
  state.transactions.forEach(t=>{if(t.symbol===p.symbol){t.name=p.name;t.sector=p.sector;t.source=p.source;t.color=p.color}});
  markDirty(`${p.symbol} 资产资料与颜色已编辑`);$("positionDialog").close();renderAll()
}
function renderSectorsV2(){const bar=$("sectorBar"),legend=$("sectorLegend"),total=Math.max(contributedCapital()+realizedPnl(),1);bar.innerHTML="";legend.innerHTML="";sectorItems().forEach(s=>{const pct=round(s.total/total*100),seg=document.createElement("div");seg.className="segment"+(pct>=14?" major":"");seg.style.width=Math.max(4,pct)+"%";seg.style.background=`linear-gradient(90deg, ${mixColor(s.color,"#ffffff",.14)}, ${mixColor(s.color,"#000000",.12)})`;seg.title=`${s.label} ${pct}%`;seg.textContent=pct>=14?`${s.label} ${pct}%`:"";bar.appendChild(seg);legend.insertAdjacentHTML("beforeend",`<span><i class="dot" style="background:${validColor(s.color)}"></i>${escapeHtml(s.label)} ${money(s.total)} <b class="${cls(s.pnl)}">${money(s.pnl)}</b></span>`)})}
const RETURN_VIEWS=["all","month","year"];
let activeReturnView="all",returnScrollTimer=null;
function returnDateLabel(date){const parts=String(date||"").split("-");return parts.length===3?`${num(parts[1])}/${num(parts[2])}`:String(date||"")}
function firstTradingDate(date){
  const cursor=new Date(`${date}T12:00:00Z`);
  for(let offset=0;offset<10;offset++){
    const iso=cursor.toISOString().slice(0,10),day=cursor.getUTCDay();
    if(day!==0&&day!==6&&!US_STATIC_HOLIDAYS[iso])return iso;
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return date;
}
function returnRangeLabel(series){
  if(!series.points.length)return"暂无快照";
  if(series.period==="all")return`${returnDateLabel(series.startDate)} 至 ${returnDateLabel(series.endDate)}`;
  const rangeStart=firstTradingDate(series.periodStart||series.startDate),range=`${returnDateLabel(rangeStart)} 至 ${returnDateLabel(series.endDate)}`;
  if(series.baselineDate)return`${range} · ${returnDateLabel(series.baselineDate)} 收盘为基准`;
  if(!series.baselineComplete&&series.dataStart)return`${range} · 净值快照从 ${returnDateLabel(series.dataStart)} 起`;
  if(series.dataStart&&series.dataStart>series.periodStart)return`${range} · 账本始于 ${returnDateLabel(series.dataStart)}`;
  return range;
}
function drawReturnChart(svg,series){
  const empty=$("returnEmpty-"+series.period),points=series.points;
  if(points.length<2){svg.classList.add("hidden");empty.classList.remove("hidden");return}
  svg.classList.remove("hidden");empty.classList.add("hidden");
  const mobile=svg.clientWidth&&svg.clientWidth<560,W=mobile?430:760,H=mobile?238:228,pad=mobile?{l:58,r:18,t:18,b:36}:{l:64,r:20,t:18,b:34};
  const raw=points.map(point=>num(point.returnPct)),rawMin=Math.min(0,...raw),rawMax=Math.max(0,...raw),spread=Math.max(rawMax-rawMin,.5),min=rawMin-spread*.12,max=rawMax+spread*.12,range=max-min;
  const x=index=>pad.l+index*(W-pad.l-pad.r)/Math.max(points.length-1,1),y=value=>pad.t+(max-value)*(H-pad.t-pad.b)/range;
  const line=points.map((point,index)=>(index?"L":"M")+x(index).toFixed(1)+" "+y(point.returnPct).toFixed(1)).join(" "),zeroY=y(0),area=`${line} L ${x(points.length-1)} ${zeroY} L ${x(0)} ${zeroY} Z`;
  const tone=series.returnPct>=0?"#ef476f":"#22b573",gradientId=`returnGradient-${series.period}`;
  let grid="";for(let index=0;index<4;index++){const value=max-range*index/3,yy=y(value);grid+=`<line class="return-grid" x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/><text class="return-axis-label" x="4" y="${yy+4}">${value>0?"+":""}${round(value,1)}%</text>`}
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  svg.innerHTML=`<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone}" stop-opacity=".28"/><stop offset="1" stop-color="${tone}" stop-opacity=".02"/></linearGradient></defs>${grid}<line class="return-zero" x1="${pad.l}" y1="${zeroY}" x2="${W-pad.r}" y2="${zeroY}"/><path class="return-area" fill="url(#${gradientId})" d="${area}"/><path class="return-line" stroke="${tone}" d="${line}"/><circle class="return-last-dot" fill="${tone}" cx="${x(points.length-1)}" cy="${y(points.at(-1).returnPct)}" r="5"/><text class="return-date-label" x="${pad.l}" y="${H-7}">${escapeHtml(returnDateLabel(points[0].date))}</text><text class="return-date-label" text-anchor="end" x="${W-pad.r}" y="${H-7}">${escapeHtml(returnDateLabel(points.at(-1).date))}</text>`;
}
function activeReturnSnapshots(){
  const metrics=ledgerMetrics(),date=today(),live={scope:"active",date,capital:round(metrics.contributedCapital),netAsset:round(metrics.netAsset),market:round(metrics.marketTotal),cash:round(metrics.cashBalance)};
  return state.snapshots.filter(item=>(!item.scope||item.scope==="active")&&String(item.date)!==date).concat(live)
}
function renderReturnDashboard(){
  const snapshots=activeReturnSnapshots();
  RETURN_VIEWS.forEach(view=>{const series=MYH88Core.buildReturnSeries(snapshots,view),value=$("returnValue-"+view),pnl=$("returnPnl-"+view);value.textContent=`${series.returnPct>0?"+":""}${round(series.returnPct)}%`;value.className=cls(series.returnPct);pnl.textContent=`个股区间盈亏 ${money(series.pnlUSD)}`;pnl.className=cls(series.pnlUSD);$("returnRange-"+view).textContent=returnRangeLabel(series);drawReturnChart($("returnChart-"+view),series)})
}
function syncReturnNavigation(view){activeReturnView=view;document.querySelectorAll(".return-tab").forEach(button=>{const active=button.dataset.returnView===view;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active))});document.querySelectorAll(".return-dots i").forEach((dot,index)=>dot.classList.toggle("active",RETURN_VIEWS[index]===view))}
function selectReturnView(view,behavior="smooth"){const carousel=$("returnCarousel"),index=RETURN_VIEWS.indexOf(view);if(!carousel||index<0)return;syncReturnNavigation(view);carousel.scrollTo({left:index*carousel.clientWidth,behavior})}
function initReturnCarousel(){const carousel=$("returnCarousel");if(!carousel)return;carousel.addEventListener("scroll",()=>{clearTimeout(returnScrollTimer);returnScrollTimer=setTimeout(()=>{const index=Math.max(0,Math.min(RETURN_VIEWS.length-1,Math.round(carousel.scrollLeft/Math.max(carousel.clientWidth,1))));syncReturnNavigation(RETURN_VIEWS[index])},70)},{passive:true})}
function renderHoldingCardsV2(){
  const box=$("holdingCards");
  if(!state.positions.length){box.innerHTML='<div class="empty">暂无当前持仓</div>';return}
  const total=Math.max(contributedCapital()+realizedPnl(),1);
  box.innerHTML=state.positions.slice().sort((a,b)=>num(b.costBasisUSD)-num(a.costBasisUSD)).map(p=>{
    const pnl=floatingPnlUSD(p),ret=round(p.costBasisUSD?pnl/p.costBasisUSD*100:0),weight=round(p.costBasisUSD/total*100),change=round(p.changePercent||0),changeText=change?change+"%":"--",source=priceSourceLabel(p);
    return '<div class="holding-card"><div class="holding-main"><div><div class="symbol">'+escapeHtml(p.symbol)+'</div><div class="name">'+(escapeHtml(p.name)||escapeHtml(p.sector))+'</div></div><div class="holding-value"><strong>'+money(marketUSD(p))+'</strong><span class="'+cls(pnl)+'">'+money(pnl)+' / '+ret+'%</span></div></div><div class="holding-meta"><span>'+escapeHtml(p.sector)+'</span><span class="'+cls(change)+'">'+changeText+'</span></div><div class="quote-line"><span class="quote-source '+priceSourceClass(p)+'">'+escapeHtml(source)+'</span><small>'+round(p.price,4)+' '+escapeHtml(p.currency)+'</small></div><div class="holding-progress"><i style="width:'+Math.min(100,Math.max(2,weight))+'%;background:'+validColor(p.color)+'"></i></div><div class="grid compact"><div><div class="label">成本仓位</div><div class="value">'+weight+'%</div></div><div><div class="label">数量</div><div class="value">'+round(p.shares,4)+'</div></div><div><div class="label">平均成本</div><div class="value">'+round(p.avgCost,4)+' '+escapeHtml(p.currency)+'</div></div><div><div class="label">投入成本</div><div class="value">'+money(p.costBasisUSD)+'</div></div></div></div>'
  }).join("")
}

function renderMapHoldingTable(){
  const body=$("mapHoldingBody");if(!body)return;
  const holdingsTotal=Math.max(state.positions.reduce((sum,p)=>sum+marketUSD(p),0),1);
  const usdPrice=value=>Number.isFinite(value)?`$${Number(value).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4})}`:"—";
  const rows=state.positions.slice().sort((a,b)=>marketUSD(b)-marketUSD(a)).map(p=>{
    const pnl=floatingPnlUSD(p),marketValue=marketUSD(p),weight=round(marketValue/holdingsTotal*100),ret=round(p.costBasisUSD?pnl/p.costBasisUSD*100:0);
    const costPrice=num(p.avgCost)*fx(p.currency),currentPrice=num(p.price)*fx(p.currency);
    const actions=isAdminMode?`<td class="admin-column"><div class="cockpit-row-actions"><button title="记录买入" aria-label="记录买入 ${escapeHtml(p.symbol)}" onclick="openTrade('buy','${p.id}')">买</button><button title="记录卖出" aria-label="记录卖出 ${escapeHtml(p.symbol)}" onclick="openTrade('sell','${p.id}')">卖</button><button title="编辑资产" aria-label="编辑 ${escapeHtml(p.symbol)}" onclick="editPosition('${p.id}')">编</button></div></td>`:"";
    return `<tr><td class="position-code"><span class="position-logo">${companyLogoMarkup(p.symbol)}</span><strong>${escapeHtml(p.symbol)}</strong></td><td class="position-name">${escapeHtml(p.name||p.symbol)}</td><td>${round(p.shares,4)}</td><td>${money(marketValue)}</td><td>${weight}%</td><td>${usdPrice(costPrice)}</td><td>${usdPrice(currentPrice)}</td><td class="${cls(pnl)}"><strong>${money(pnl)}</strong></td><td class="${cls(ret)}"><strong>${ret>0?"+":""}${ret}%</strong></td>${actions}</tr>`;
  }).join("");
  body.innerHTML=rows||`<tr><td colspan="${isAdminMode?10:9}" class="muted empty-table-cell">暂无当前持仓</td></tr>`;
}

function renderAll(){renderKpis();renderTreemap();renderSectorsV2();renderMapHoldingTable();renderReturnDashboard();renderHoldingCardsV2();renderPositionTable();renderTransactionTable();renderCashFlowTable();renderSectorAdminPanel();if($("positionCount"))$("positionCount").textContent=state.positions.length;$("transactionCount").textContent=state.transactions.length;$("cashFlowCount").textContent=state.cashFlows.length;renderLedgerCalendar();switchLedgerTab(activeLedgerTab);$("pageTitle").textContent=state.settings.title;document.title=state.settings.title;$("titleInput").value=state.settings.title;$("cacheInput").value=state.settings.priceCacheMinutes;if($("eurFxInput"))$("eurFxInput").value=state.fxRates.EUR||defaultState.fxRates.EUR;if($("proxyInput"))$("proxyInput").value=priceProxyUrl();renderSyncStatus();renderDiagnostics()}
function hasAdminSession(){const auth=readJson(sessionStorage.getItem(ADMIN_AUTH_KEY),null);return Boolean(auth?.at&&Date.now()-num(auth.at)<ADMIN_AUTH_TTL_MS)}
async function digestText(value){const bytes=new TextEncoder().encode(value),hash=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("")}
function showAdminLogin(){const dialog=$("adminLoginDialog");if(dialog&&!dialog.open)dialog.showModal()}
async function verifyAdminLogin(event){event.preventDefault();const input=$("adminPassword"),error=$("adminLoginError"),password=input.value;if(!password){error.textContent="请输入管理员密码";return}if(await digestText(password)!==ADMIN_PASSWORD_HASH){error.textContent="密码不正确，请重新输入";input.select();return}sessionStorage.setItem(ADMIN_AUTH_KEY,JSON.stringify({at:Date.now()}));location.reload()}
function logoutAdmin(){sessionStorage.removeItem(ADMIN_AUTH_KEY);const url=new URL(location.href);url.searchParams.delete("admin");location.href=url.pathname+url.search}
function initAdminMode(){adminAccessRequested=new URLSearchParams(location.search).get("admin")==="1";isAdminMode=adminAccessRequested&&hasAdminSession();document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdminMode));document.body.classList.toggle("viewer-mode",!isAdminMode);if(!allowedLedgerPages().includes(activeLedgerTab))switchLedgerTab("overview");if(adminAccessRequested&&!isAdminMode)setTimeout(showAdminLogin,0)}
function canAutoRefreshPrices(){return navigator.onLine&&document.visibilityState!=="hidden"&&!!priceProxyUrl()}
function kickAutoRefresh(force=false){
  if(!canAutoRefreshPrices())return;
  const now=Date.now();
  if(!force&&now-lastAutoRefreshKick<RESUME_REFRESH_GAP_MS)return;
  if(!(marketClockState?.isOpen||marketClockState?.phase==="open")){lastAutoRefreshKick=now;refreshLastClosePrices(marketClockState||marketClock());return}
  lastAutoRefreshKick=now;
  refreshPrices(false);
}
function initAutoRefreshHooks(){
  if(autoRefreshTimer)clearInterval(autoRefreshTimer);
  if(sharedDataTimer)clearInterval(sharedDataTimer);
  sharedDataTimer=setInterval(()=>checkSharedDataUpdate(false),SHARED_DATA_CHECK_MS);
  autoRefreshTimer=setInterval(()=>{if(document.visibilityState==="visible")refreshMarketClock().then(()=>kickAutoRefresh(false))},AUTO_REFRESH_CHECK_MS);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){checkSharedDataUpdate(true);refreshMarketClock().then(()=>kickAutoRefresh(true))}});
  window.addEventListener("focus",()=>{checkSharedDataUpdate(true);refreshMarketClock().then(()=>kickAutoRefresh(false))});
  window.addEventListener("pageshow",()=>checkSharedDataUpdate(false));
}
window.addEventListener("resize",()=>{renderTreemap();renderReturnDashboard();selectReturnView(activeReturnView,"auto")});
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue=""}});
window.addEventListener("online",()=>{updateNetworkStatus();checkSharedDataUpdate(true)});
window.addEventListener("offline",updateNetworkStatus);
window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstallPrompt=event;updateInstallButton()});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;$("installDialog")?.close();updateInstallButton()});
document.addEventListener("DOMContentLoaded",()=>{
  initAdminMode();fillAdmin();normalizeState(defaultState);initLedgerCarousel();initReturnCarousel();renderAll();updateNetworkStatus();updateInstallButton();registerPwa();
  initAutoRefreshHooks();
  refreshWorkerHealth();
  ["tradeShares","tradePrice","tradeFx","tradeFee"].forEach(id=>$(id).addEventListener("input",updateTradePreview));$("tradeSymbol").addEventListener("input",syncTradeSymbol);$("tradeSymbol").addEventListener("change",syncTradeSymbol);$("tradeName").addEventListener("input",()=>{if(tradeSectorAuto||tradeColorAuto)syncTradeSymbol();else updateTradePreview()});$("tradeSector").addEventListener("input",()=>{tradeSectorAuto=false;if(tradeColorAuto){const sector=inferSector($("tradeSymbol").value,$("tradeName").value,$("tradeSector").value);$("tradeColor").value=colorForSectorMember(sector,state.positions.filter(x=>inferSector(x.symbol,x.name,x.sector)===sector).length)}updateTradePreview()});$("tradeColor").addEventListener("input",()=>{tradeColorAuto=false;updateTradePreview()});$("tradeCurrency").addEventListener("change",()=>{$("tradeFx").value=fx($("tradeCurrency").value);updateTradePreview()});
  loadSharedData(true);
});




