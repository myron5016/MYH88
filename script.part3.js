function treemapVisualItems(items){return MYH88Core.treemapVisualItems(items)}
function treemapWorst(row,side){
  if(!row.length||side<=0)return Infinity;
  const sum=row.reduce((value,item)=>value+item.area,0),max=Math.max(...row.map(item=>item.area)),min=Math.min(...row.map(item=>item.area));
  return Math.max(side*side*max/(sum*sum),sum*sum/(side*side*min));
}
function treemapPlaceRow(row,rect,result){
  const rowArea=row.reduce((value,item)=>value+item.area,0);
  if(rect.w>=rect.h){
    const width=rowArea/Math.max(rect.h,1);let top=rect.y;
    row.forEach((item,index)=>{const height=index===row.length-1?rect.y+rect.h-top:item.area/Math.max(width,1);result.push({...item,x:rect.x,y:top,w:width,h:height});top+=height});
    rect.x+=width;rect.w=Math.max(0,rect.w-width);
  }else{
    const height=rowArea/Math.max(rect.w,1);let left=rect.x;
    row.forEach((item,index)=>{const width=index===row.length-1?rect.x+rect.w-left:item.area/Math.max(height,1);result.push({...item,x:left,y:rect.y,w:width,h:height});left+=width});
    rect.y+=height;rect.h=Math.max(0,rect.h-height);
  }
}
function squarifiedTreemap(items,x,y,w,h){return MYH88Core.squarifiedTreemap(items,x,y,w,h)}
function treemapHeight(count,width){
  if(width<=900)return Math.min(1180,580+Math.max(0,count-8)*34);
  return Math.min(1520,640+Math.max(0,count-10)*28);
}
function treemapTileSize(tile){
  const shortSide=Math.min(tile.w,tile.h),area=tile.w*tile.h;
  if(tile.w>=165&&tile.h>=120&&area>=24000)return "large";
  if(shortSide>=82&&area>=11500)return "medium";
  if(shortSide>=55&&area>=6000)return "small";
  return "micro";
}
const COMPANY_LOGO_ASSETS=Object.freeze({
  AAOI:"aaoi.svg",CASH:"cash.svg",DRAM:"dram.svg",GOOGL:"googl.svg",MRVL:"mrvl.svg",MU:"mu.svg",
  NVDA:"nvda.svg",RKLB:"rklb.svg",SPCX:"spcx.svg",VRT:"vrt.svg",XFAB:"xfab.svg",SKHY:"dram.svg"
});
const COMPANY_LOGO_DOMAINS=Object.freeze({
  AAOI:"appliedoptoelectronics.com",DRAM:"skhynix.com",GOOGL:"google.com",MRVL:"marvell.com",
  MU:"micron.com",TSM:"tsmc.com",TSLA:"tesla.com",SKHY:"skhynix.com",SOXL:"direxion.com",
  VOO:"vanguard.com",QQQM:"invesco.com",IBKR:"interactivebrokers.com",VRT:"vertiv.com",XFAB:"xfab.com"
});
const COMPANY_LOGO_GLYPHS=Object.freeze({
  NVDA:"NV",MRVL:"MR",AAOI:"AO",XFAB:"XF",RKLB:"RK",VRT:"VR",SPCX:"SX",GOOGL:"G",MU:"MU",
  DRAM:"DR",TSM:"TSM",TSLA:"TS",SKHY:"SK",SOXL:"SO",VOO:"VO",QQQM:"QQ",IBKR:"IB",CASH:"$"
});
function companyLogoMarkup(label){
  const key=String(label||"").toUpperCase().trim();
  const glyph=COMPANY_LOGO_GLYPHS[key]||key.slice(0,2)||".";
  const asset=COMPANY_LOGO_ASSETS[key];
  const domain=COMPANY_LOGO_DOMAINS[key];
  const localSrc=asset?`logos/${asset}?v=11.4`:"";
  const officialSrc=domain?`https://www.google.com/s2/favicons?domain=${domain}&sz=128`:"";
  const alternateSrc=domain?`https://icons.duckduckgo.com/ip3/${domain}.ico`:"";
  const safeKey=key.toLowerCase().replace(/[^a-z0-9-]/g,"")||"asset";
  if(!localSrc&&!officialSrc)return `<span class="company-logo-card logo-${safeKey} logo-fallback-active" aria-hidden="true"><span class="logo-fallback">${escapeHtml(glyph)}</span></span>`;
  const alternateAttr=alternateSrc?` data-alternate-src="${escapeHtml(alternateSrc)}"`:"";
  const onerror="if(this.dataset.fallbackIndex!==\"1\"&&this.dataset.alternateSrc){this.dataset.fallbackIndex=\"1\";this.src=this.dataset.alternateSrc}else{this.parentElement.classList.add(\"logo-fallback-active\")}";
  return `<span class="company-logo-card logo-${safeKey}" aria-hidden="true"><img src="${escapeHtml(localSrc||officialSrc)}"${alternateAttr} alt="" onerror="${onerror}"><span class="logo-fallback">${escapeHtml(glyph)}</span></span>`;
}
function renderTreemap(){
  const box=$("treemap");box.innerHTML="";
  const items=treemapItems(),denom=Math.max(contributedCapital()+realizedPnl(),1);
  const boxStyle=getComputedStyle(box),layoutWidth=Math.max(1,box.clientWidth-num(parseFloat(boxStyle.borderLeftWidth)+parseFloat(boxStyle.borderRightWidth))),layoutHeight=Math.max(1,box.clientHeight-num(parseFloat(boxStyle.borderTopWidth)+parseFloat(boxStyle.borderBottomWidth)));
  const width=layoutWidth,mobile=window.matchMedia("(max-width: 640px)").matches;
  box.classList.toggle("mobile-map",mobile);
  const height=mobile?Math.min(690,Math.max(500,430+Math.max(0,items.length-8)*20)):treemapHeight(items.length,width);
  box.style.height=`${height}px`;box.style.minHeight=`${height}px`;
  const tiles=squarifiedTreemap(items,0,0,layoutWidth,layoutHeight);
  tiles.forEach(t=>{
    const d=document.createElement("div"),share=round(t.value/denom*100),size=treemapTileSize(t),showLogo=size!=="micro",wideCompact=t.w>=180&&t.h>=82&&t.h<175&&t.w/t.h>=1.5;
    d.className=`tile tile-${size}`;
    if(wideCompact)d.classList.add("tile-wide-compact");
    if(mobile&&share>=35)d.classList.add("tile-dominant");
    Object.assign(d.style,{left:t.x+"px",top:t.y+"px",width:t.w+"px",height:t.h+"px",background:`radial-gradient(circle at 28% 18%, ${mixColor(t.color,"#ffffff",.28)}, transparent 58%), linear-gradient(145deg, ${mixColor(t.color,"#ffffff",.04)}, ${mixColor(t.color,"#000000",.18)})`,borderColor:mixColor(t.color,"#020617",.38),color:"white"});
    d.style.setProperty("--tile-x",t.x+"px");d.style.setProperty("--tile-y",t.y+"px");d.style.setProperty("--tile-w",t.w+"px");d.style.setProperty("--tile-h",t.h+"px");
    d.title=`${t.label} ${money(t.value)} | ${share}%`;
    d.setAttribute("aria-label",`${t.label}，持仓成本 ${money(t.value)}，占比 ${share}%`);
    const meta=size==="large"||wideCompact?`${money(t.value)} | ${share}%`:`${share}%`;
    d.innerHTML=`<div class="tile-copy">${showLogo?companyLogoMarkup(t.label):""}<div class="tile-text"><span class="tile-symbol">${escapeHtml(t.label)}</span><span class="tile-meta">${escapeHtml(meta)}</span></div></div>`;
    box.appendChild(d)
  })
}
function sectorItems(){const map={};state.positions.forEach(p=>{const key=inferSector(p.symbol,p.name,p.sector);if(!map[key])map[key]={label:key,total:0,pnl:0,color:sectorBaseColor(key)};map[key].total+=num(p.costBasisUSD);map[key].pnl+=floatingPnlUSD(p)});const cash=cashBalance();if(cash>0)map["现金"]={label:"现金",total:cash,pnl:0,color:sectorBaseColor("现金")};return Object.values(map).sort((a,b)=>b.total-a.total)}
function renderSectors(){const bar=$("sectorBar"),legend=$("sectorLegend"),total=Math.max(contributedCapital()+realizedPnl(),1);bar.innerHTML="";legend.innerHTML="";sectorItems().forEach(s=>{const pct=s.total/total*100,seg=document.createElement("div");seg.className="segment"+(pct>=10?" major":"");seg.style.width=Math.max(3,pct)+"%";seg.style.background=`linear-gradient(135deg,${mixColor(s.color,"#ffffff",.12)},${mixColor(s.color,"#000000",.08)})`;seg.textContent=`${s.label} ${round(pct)}%`;bar.appendChild(seg);legend.insertAdjacentHTML("beforeend",`<span><i class="dot" style="background:${validColor(s.color)}"></i>${escapeHtml(s.label)} ${money(s.total)} <b class="${cls(s.pnl)}">${money(s.pnl)}</b></span>`)})}
function renderKpis(){$("kpiCapital").textContent=money(contributedCapital());$("kpiNetAsset").textContent=money(netAsset());$("kpiMarket").textContent=money(marketTotal());$("kpiCash").textContent=money(cashBalance());$("kpiCash").className=cls(cashBalance());if($("kpiRealized")){$("kpiRealized").textContent=money(realizedPnl());$("kpiRealized").className=cls(realizedPnl())}$("kpiFloating").textContent=`${money(floatingPnl())} / ${round(floatingReturn())}%`;$("kpiFloating").className=cls(floatingPnl());$("kpiPnl").textContent=`${money(totalPnl())} / ${round(totalReturn())}%`;$("kpiPnl").className=cls(totalPnl())}function renderHoldingCards(){const box=$("holdingCards");if(!state.positions.length){box.innerHTML='<div class="empty">暂无当前持仓</div>';return}box.innerHTML=state.positions.slice().sort((a,b)=>num(b.costBasisUSD)-num(a.costBasisUSD)).map(p=>`<div class="holding-card"><div class="top"><div><div class="symbol">${escapeHtml(p.symbol)}</div><div class="name">${escapeHtml(p.name)}</div></div><div class="sector-pill">${escapeHtml(p.sector)}</div></div><div class="grid"><div><div class="label">数量</div><div class="value">${round(p.shares,4)}</div></div><div><div class="label">最新价</div><div class="value">${round(p.price,4)} ${escapeHtml(p.currency)}</div></div><div><div class="label">单股成本</div><div class="value">${round(p.avgCost,4)} ${escapeHtml(p.currency)}</div></div><div><div class="label">投入成本</div><div class="value">${money(p.costBasisUSD)}</div></div><div><div class="label">市值</div><div class="value">${money(marketUSD(p))}</div></div><div><div class="label">成本仓位</div><div class="value">${round(p.costBasisUSD/Math.max(contributedCapital()+realizedPnl(),1)*100)}%</div></div><div><div class="label">浮动盈亏</div><div class="value ${cls(floatingPnlUSD(p))}">${money(floatingPnlUSD(p))} / ${round(p.costBasisUSD?floatingPnlUSD(p)/p.costBasisUSD*100:0)}%</div></div></div></div>`).join("")}function captureSnapshot(manual=false){const date=today(),snap={scope:"active",date,capital:round(contributedCapital()),netAsset:round(netAsset()),market:round(marketTotal()),cash:round(cashBalance())},i=state.snapshots.findIndex(x=>(!x.scope||x.scope==="active")&&x.date===date),before=i>=0?JSON.stringify(state.snapshots[i]):"",changed=before!==JSON.stringify(snap);if(i>=0)state.snapshots[i]=snap;else state.snapshots.push(snap);state.snapshots.sort((a,b)=>a.date.localeCompare(b.date));saveLocal();if(manual){markDirty("今日个股资产快照已记录");renderReturnDashboard();alert("今日个股资产快照已记录，尚未保存到 GitHub")}return changed}

function renderPositionTable(){
  const q=$("positionSearch")?.value.trim().toUpperCase()||"",items=state.positions.filter(p=>!q||p.symbol.includes(q)||p.name.toUpperCase().includes(q));
  $("positionBody").innerHTML=items.length?items.map(p=>{const locks=[p.sectorLocked?"板块锁":"",p.colorLocked?"颜色锁":""].filter(Boolean).join(" / "),source=priceSourceLabel(p);return`<tr><td class="asset-cell"><strong>${escapeHtml(p.symbol)}</strong><small>${escapeHtml(p.name)} · ${escapeHtml(p.currency)}</small></td><td>${round(p.shares,4)}</td><td>${round(p.avgCost,4)} ${escapeHtml(p.currency)}</td><td>${money(p.costBasisUSD)}</td><td>${money(marketUSD(p))}</td><td class="${cls(floatingPnlUSD(p))}">${money(floatingPnlUSD(p))}</td><td><span class="quote-source ${priceSourceClass(p)}">${escapeHtml(source)}</span><small class="muted">${escapeHtml(quoteDateLabel(p))}</small></td><td>${escapeHtml(p.sector)}${locks?`<small class="muted">${escapeHtml(locks)}</small>`:""}</td><td>${isAdminMode?`<div class="row-buttons"><button onclick="openTrade('buy','${p.id}')">买入</button><button onclick="openTrade('sell','${p.id}')">卖出</button><button onclick="editPosition('${p.id}')">编辑</button></div>`:"—"}</td></tr>`}).join(""):'<tr><td colspan="9" class="muted">没有匹配的持仓</td></tr>'
}

function transactionLabel(t){
  if(t?.voided)return"已撤销";
  if(t?.type==="buy")return"买入";
  if(t?.type==="sell")return"卖出";
  if(t?.type==="opening")return"期初持仓";
  if(t?.type==="deposit")return"追加本金";
  if(t?.type==="withdraw")return"提取本金";
  return"记录";
}
function latestCorrectableTransaction(){return state.transactions.slice().reverse().find(t=>["buy","sell"].includes(t.type)&&!t.voided&&Object.prototype.hasOwnProperty.call(t,"positionBefore"))||null}
function renderCashFlowTable(){$("cashFlowBody").innerHTML=state.cashFlows.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(x=>`<tr class="${x.voided?"muted":""}"><td>${escapeHtml(x.date)}</td><td>${x.voided?"已作废":x.type==="withdraw"?"提取本金":"追加本金"}</td><td class="${x.voided?"muted":x.type==="withdraw"?"red":"green"}">${x.type==="withdraw"?"-":"+"}${money(x.amountUSD)}</td><td>${escapeHtml(x.note||"")}</td><td>${x.migration||x.voided?"—":`<button class="danger" onclick="deleteCashFlow('${x.id}')">作废</button>`}</td></tr>`).join("")}
function switchLedgerTab(tab){if(!isAdminMode&&["cashflows","backup"].includes(tab))tab="transactions";activeLedgerTab=tab;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));["positions","transactions","cashflows","backup"].forEach(x=>$(x+"Pane").classList.toggle("hidden",x!==tab));if(tab==="backup")renderBackupList()}
function fillTradeFromPosition(p){if(!p)return;$("tradeSymbol").value=p.symbol;$("tradeName").value=p.name;$("tradeCurrency").value=p.currency;$("tradeFx").value=fx(p.currency);$("tradePrice").value=p.price||p.avgCost;$("tradeSource").value=p.source;$("tradeSector").value=p.sector;$("tradeColor").value=p.color;updateTradePreview()}
function syncTradeSymbol(){const symbol=$("tradeSymbol").value.trim().toUpperCase(),p=state.positions.find(x=>x.symbol===symbol);if(p){tradeSectorAuto=false;tradeColorAuto=false;fillTradeFromPosition(p)}else{const sector=inferSector(symbol,$("tradeName").value,tradeSectorAuto?"":$("tradeSector").value);if(tradeSectorAuto)$("tradeSector").value=sector;if(tradeColorAuto)$("tradeColor").value=colorForSectorMember(sector,state.positions.filter(x=>inferSector(x.symbol,x.name,x.sector)===sector).length);$("tradeFx").value=fx($("tradeCurrency").value)}updateTradePreview()}
function updateTradePreview(){const type=$("tradeType").value,qty=num($("tradeShares").value),price=num($("tradePrice").value),rate=num($("tradeFx").value),fee=num($("tradeFee").value),symbol=$("tradeSymbol").value.trim().toUpperCase(),p=state.positions.find(x=>x.symbol===symbol),cashBefore=cashBalance(),buyCost=(qty*price+fee)*rate,sellGross=qty*price*rate,sellFee=fee*rate,sellCash=Math.max(0,sellGross-sellFee),sharesBefore=num(p?.shares),costBefore=num(p?.costBasisUSD);let cashAfter=cashBefore,sharesAfter=sharesBefore,costAfter=costBefore,avgAfter=p?num(p.avgCost):0,extraTitle=type==="sell"?"预计已实现":"买后均价",extraValue="—",extraClass="";if(type==="buy"){cashAfter=cashBefore-buyCost;sharesAfter=sharesBefore+qty;costAfter=costBefore+buyCost;avgAfter=sharesAfter?((num(p?.avgCost)*sharesBefore)+(qty*price+fee))/sharesAfter:0;extraValue=`${round(avgAfter,4)} ${$("tradeCurrency").value}`}else{const basis=sharesBefore?costBefore/sharesBefore*qty:0,realized=sellGross-sellFee-basis;cashAfter=cashBefore+sellCash;sharesAfter=Math.max(0,sharesBefore-qty);costAfter=Math.max(0,costBefore-basis);extraValue=money(realized);extraClass=cls(realized)}$("tradePreview").innerHTML=`<div class="trade-preview-grid"><div><span>现金变化</span><strong class="${cls(cashAfter-cashBefore)}">${money(cashAfter-cashBefore)}</strong><small>${money(cashBefore)} → ${money(cashAfter)}</small></div><div><span>持仓数量</span><strong>${round(sharesBefore,4)} → ${round(sharesAfter,4)}</strong><small>${symbol||"未选择资产"}</small></div><div><span>持仓成本</span><strong>${money(costAfter-costBefore)}</strong><small>${money(costBefore)} → ${money(costAfter)}</small></div><div><span>${extraTitle}</span><strong class="${extraClass}">${extraValue}</strong><small>${type==="sell"?`收入 ${money(sellCash)}`:`占用 ${money(buyCost)}`}</small></div></div>`}
function restorePositionBefore(transaction){state.positions=state.positions.filter(p=>p.symbol!==transaction.symbol);if(transaction.positionBefore)state.positions.push(normalizePosition(structuredClone(transaction.positionBefore)));transaction.voided=true;transaction.voidedAt=new Date().toISOString()}
function undoLastTransaction(id){const t=latestCorrectableTransaction();if(!t||t.id!==id){alert("只能撤销最新一笔尚未撤销的 V9.1 及以后交易");return}if(!confirm(`确认撤销最新交易？\n${transactionLabel(t)} ${t.symbol} ${t.shares} 股 @ ${t.price} ${t.currency}\n\n原记录会标记为“已撤销”，不会从流水中删除。`))return;createBackup(`${t.symbol} 交易撤销前`);restorePositionBefore(t);captureSnapshot(false);markDirty(`${t.symbol} 最新交易已撤销`);renderAll();switchLedgerTab("transactions")}
function correctLastTransaction(id){const t=latestCorrectableTransaction();if(!t||t.id!==id){alert("只能更正最新一笔尚未撤销的 V9.1 及以后交易");return}if(!confirm(`更正 ${t.symbol} 最新交易？\n系统会先撤销原记录，再打开交易窗口重新填写。`))return;const old=structuredClone(t);createBackup(`${t.symbol} 交易更正前`);restorePositionBefore(t);captureSnapshot(false);markDirty(`${t.symbol} 原交易已撤销，等待重新录入`);renderAll();const restored=state.positions.find(p=>p.symbol===old.symbol);openTrade(old.type,restored?.id||"");$("tradeSymbol").value=old.symbol;$("tradeDate").value=old.date;$("tradeShares").value=old.shares;$("tradePrice").value=old.price;$("tradeCurrency").value=old.currency;$("tradeFx").value=old.fxRate;$("tradeFee").value=old.fee||0;$("tradeName").value=old.name||"";$("tradeNote").value=(old.note?old.note+"；":"")+"更正重录";updateTradePreview()}
function openCashFlow(){$("cashDate").value=today();$("cashAmount").value="";$("cashNote").value="";$("cashDialog").showModal()}
function submitCashFlow(event){event.preventDefault();const type=$("cashType").value,date=$("cashDate").value,amountUSD=num($("cashAmount").value),note=$("cashNote").value.trim();if(!date||amountUSD<=0){alert("请填写正确金额");return}createBackup("本金变动前");state.cashFlows.push({id:uid("cash"),date,type,amountUSD,note});captureSnapshot(false);markDirty("本金变动已记录");$("cashDialog").close();renderAll();switchLedgerTab("cashflows")}
function deleteCashFlow(id){const item=state.cashFlows.find(x=>x.id===id);if(!item||item.voided)return;if(!confirm("确认作废这条本金变动记录？原记录会保留在流水中。"))return;createBackup("作废资金流水前");item.voided=true;item.voidedAt=new Date().toISOString();captureSnapshot(false);markDirty("一条资金流水已作废");renderAll()}

function downloadJson(){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a"),url=URL.createObjectURL(blob);a.href=url;a.download="data-v10.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function importJson(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const incoming=JSON.parse(reader.result);createBackup("导入数据前");normalizeState(incoming);captureSnapshot(false);markDirty("已导入外部数据，等待安全核对");renderAll();alert("导入成功。保存前系统会与 GitHub 云端数据进行安全核对。") }catch(error){alert("JSON 格式或数据结构不正确："+error.message)}finally{event.target.value=""}};reader.readAsText(file)}

function transactionMetaMap(transactions=state.transactions){
  const map={};
  state.positions.forEach(p=>{map[p.symbol]={id:p.id,name:p.name,sector:p.sector,color:p.color,sectorLocked:p.sectorLocked,colorLocked:p.colorLocked,source:p.source,currency:p.currency,price:p.price,changePercent:p.changePercent,note:p.note}});
  transactions.forEach(t=>{const symbol=String(t.symbol||"").toUpperCase();if(!symbol)return;const sector=inferSector(symbol,t.name,t.sector||map[symbol]?.sector);map[symbol]={...(map[symbol]||{}),name:t.name||map[symbol]?.name||"",sector,color:validColor(t.color||map[symbol]?.color||sectorBaseColor(sector)),source:t.source==="manual"?"manual":map[symbol]?.source||"twelve",currency:String(t.currency||map[symbol]?.currency||"USD").toUpperCase()}});
  return map;
}
function transactionDateValue(t){return String(t?.date||"0000-00-00")}
function openingBaselineDates(transactions){
  const map={};
  (transactions||[]).forEach(t=>{
    if(t?.voided||t?.type!=="opening")return;
    const symbol=String(t.symbol||"").trim().toUpperCase();
    if(!symbol)return;
    const date=transactionDateValue(t);
    if(!map[symbol]||date<map[symbol])map[symbol]=date;
  });
  return map;
}
function transactionAffectsCurrentPosition(t,baselineDates){
  if(t?.type==="opening")return true;
  const symbol=String(t?.symbol||"").trim().toUpperCase();
  const baseline=baselineDates[symbol];
  return !baseline||transactionDateValue(t)>=baseline;
}
function orderedTransactionsForRebuild(transactions){
  return (transactions||[]).map((t,index)=>({...t,_order:index})).sort((a,b)=>{
    const ao=a.type==="opening"?0:1,bo=b.type==="opening"?0:1;
    if(ao!==bo)return ao-bo;
    const ad=transactionDateValue(a),bd=transactionDateValue(b);
    if(ad!==bd)return ad.localeCompare(bd);
    return a._order-b._order;
  });
}
function rebuildCurrentPositionsFromTransactions(transactions=state.transactions){
  const meta=transactionMetaMap(transactions),positions=[],bySymbol={},baselineDates=openingBaselineDates(transactions),rebuiltByOrder={};
  orderedTransactionsForRebuild(transactions).forEach(original=>{
    const index=original._order,t={...original};
    if(t.voided){rebuiltByOrder[index]=t;return}
    const type=t.type==="sell"?"sell":"buy",symbol=String(t.symbol||"").trim().toUpperCase(),shares=num(t.shares),price=num(t.price),currency=String(t.currency||meta[symbol]?.currency||"USD").toUpperCase(),rate=num(t.fxRate)||fx(currency),fee=num(t.fee);
    if(!symbol||shares<=0||price<0||rate<=0||fee<0)throw new Error("Transaction #"+(index+1)+" is incomplete");
    const m=meta[symbol]||{},nativeValue=shares*price,feeUSD=fee*rate;
    if(!transactionAffectsCurrentPosition(t,baselineDates)){
      const grossUSD=nativeValue*rate,keptBasis=num(t.costBasisUSD),keptRealized=Number.isFinite(Number(t.realizedPnlUSD))?num(t.realizedPnlUSD):(type==="sell"?grossUSD-feeUSD-keptBasis:0);
      rebuiltByOrder[index]={...t,type:original.type==="sell"?"sell":"buy",symbol,name:t.name||m.name||symbol,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:keptBasis,grossUSD,realizedPnlUSD:keptRealized,sector:t.sector||m.sector,color:validColor(t.color||m.color),source:t.source||m.source||"twelve",schemaVersion:"10.6",closedHistory:true};
      return;
    }
    if(type==="buy"){
      let p=bySymbol[symbol];
      const nativeCost=nativeValue+fee,usdCost=nativeCost*rate;
      if(!p){
        p=normalizePosition({id:m.id||uid("pos"),symbol,name:t.name||m.name||symbol,currency,source:t.source||m.source||"twelve",shares:0,avgCost:0,price:m.price||price,sector:t.sector||m.sector||"未分类",color:validColor(t.color||m.color),sectorLocked:m.sectorLocked,colorLocked:m.colorLocked,note:m.note||"",costBasisUSD:0,changePercent:m.changePercent||0});
        bySymbol[symbol]=p;positions.push(p);
      }
      if(p.currency!==currency)throw new Error(symbol+" has mixed-currency trades and cannot be rebuilt automatically");
      const oldNative=p.avgCost*p.shares;
      p.avgCost=(oldNative+nativeCost)/(p.shares+shares);
      p.shares=round(p.shares+shares,8);
      p.costBasisUSD=round(num(p.costBasisUSD)+usdCost,6);
      p.name=t.name||p.name;p.sector=t.sector||p.sector;p.color=validColor(t.color||p.color);p.source=t.source||p.source;p.price=num(m.price)||p.price||price;
      rebuiltByOrder[index]={...t,type:original.type==="opening"?"opening":"buy",symbol,name:p.name,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:usdCost,grossUSD:nativeValue*rate,realizedPnlUSD:0,sector:p.sector,color:p.color,source:p.source,schemaVersion:"10.6"};
      return;
    }
    const p=bySymbol[symbol];
    if(!p){rebuiltByOrder[index]={...t,type:"sell",symbol,name:t.name||m.name||symbol,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:num(t.costBasisUSD),grossUSD:nativeValue*rate,realizedPnlUSD:Number.isFinite(Number(t.realizedPnlUSD))?num(t.realizedPnlUSD):nativeValue*rate-feeUSD-num(t.costBasisUSD),sector:t.sector||m.sector,color:validColor(t.color||m.color),source:t.source||m.source||"twelve",schemaVersion:"10.6",closedHistory:true};return}
    if(p.shares+1e-9<shares)throw new Error(symbol+" sell quantity exceeds the current rebuilt holding");
    const basis=p.costBasisUSD/p.shares*shares,grossUSD=nativeValue*rate,realized=grossUSD-feeUSD-basis;
    p.shares=round(p.shares-shares,8);p.costBasisUSD=round(Math.max(0,p.costBasisUSD-basis),6);p.price=num(m.price)||price;
    if(p.shares<=1e-8){delete bySymbol[symbol];const idx=positions.findIndex(x=>x.symbol===symbol);if(idx>=0)positions.splice(idx,1)}
    rebuiltByOrder[index]={...t,type:"sell",symbol,name:t.name||m.name||symbol,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:basis,grossUSD,realizedPnlUSD:realized,sector:t.sector||m.sector,color:validColor(t.color||m.color),source:t.source||m.source||"twelve",schemaVersion:"10.6"};
  });
  state.transactions=transactions.map((_,index)=>rebuiltByOrder[index]||transactions[index]).map(({_order,...t})=>t);
  state.positions=positions.map(normalizePosition).filter(p=>p.symbol&&p.shares>0);applyAutoTaxonomy(true);
}

function tradeFormDraft(existing={}){
  const type=$("tradeType").value,symbol=$("tradeSymbol").value.trim().toUpperCase(),date=$("tradeDate").value,shares=num($("tradeShares").value),price=num($("tradePrice").value),currency=$("tradeCurrency").value,rate=num($("tradeFx").value),fee=num($("tradeFee").value),note=$("tradeNote").value.trim();
  if(!symbol||!date||shares<=0||price<0||rate<=0||fee<0)throw new Error("请检查交易信息");
  const sector=inferSector(symbol,$("tradeName").value.trim()||existing.name,$("tradeSector").value.trim());
  const color=tradeColorAuto?colorForSectorMember(sector,state.positions.filter(p=>inferSector(p.symbol,p.name,p.sector)===sector).length):validColor($("tradeColor").value);
  return {...existing,id:existing.id||uid("tx"),date,type:type==="opening"?"opening":type,symbol,name:$("tradeName").value.trim()||existing.name||symbol,shares,price,currency,fxRate:rate,fee,note,source:$("tradeSource").value,sector,color,schemaVersion:"10.5"};
}
