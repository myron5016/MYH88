const VERSION="V9.0 成长账本版";
const STATE_KEY="v9_last_state";
const BACKUP_KEY="v9_backups";
const PRICE_CACHE_KEY="v9_price_cache";
const FX_CACHE_KEY="v9_fx_cache";
const MARKET_KEY="v9_market_key";
const PAGE_SIZE=20;

const defaultState={settings:{title:"孟一晗的梦想金库",priceCacheMinutes:30,lastPriceRefresh:0,lastPriceRefreshText:"",version:VERSION},fxRates:{USD:1,EUR:1.16,HKD:.128,JPY:.0067,GBP:1.27},positions:[],transactions:[],cashFlows:[],snapshots:[]};
let state=structuredClone(defaultState);
const legacyAdmin=readJson(localStorage.getItem("v8_admin"),{});
let admin=readJson(sessionStorage.getItem("v9_admin"),{owner:legacyAdmin.owner||"",repo:legacyAdmin.repo||"",branch:legacyAdmin.branch||"main",token:""});
let activeLedgerTab="positions";
let transactionPage=1;

function $(id){return document.getElementById(id)}
function readJson(text,fallback){try{return JSON.parse(text)||fallback}catch{return fallback}}
function uid(prefix="id"){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}
function today(){return new Date().toISOString().slice(0,10)}
function num(v){return Number(v)||0}
function round(v,d=2){const p=10**d;return Math.round((num(v)+Number.EPSILON)*p)/p}
function money(v){const n=num(v),sign=n<0?"-":"";return sign+"$"+new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(Math.abs(n))}
function cls(v){return num(v)>0?"green":num(v)<0?"red":"muted"}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function validColor(v){return /^#[0-9a-f]{6}$/i.test(v||"")?v:"#888888"}
function fx(currency){return num(state.fxRates?.[String(currency||"USD").toUpperCase()])||1}
function marketKey(){return localStorage.getItem(MARKET_KEY)||""}

function normalizePosition(p){
  p.id=p.id||uid("pos");p.symbol=String(p.symbol||"").trim().toUpperCase();p.name=String(p.name||"");p.currency=String(p.currency||"USD").toUpperCase();p.source=p.source==="manual"?"manual":"twelve";p.shares=num(p.shares);p.avgCost=num(p.avgCost);p.price=num(p.price);p.sector=String(p.sector||"未分类");p.color=validColor(p.color);p.note=String(p.note||"");
  if(!Number.isFinite(Number(p.costBasisUSD)))p.costBasisUSD=p.shares*p.avgCost*fx(p.currency);else p.costBasisUSD=num(p.costBasisUSD);
  return p;
}

function migrateV8(raw){
  const migrated=structuredClone(defaultState);
  migrated.settings={...migrated.settings,...(raw.settings||{}),version:VERSION,migratedFrom:"V8.0",migratedAt:new Date().toISOString()};
  if(raw.settings?.apiKey){localStorage.setItem(MARKET_KEY,String(raw.settings.apiKey));delete migrated.settings.apiKey}
  migrated.fxRates={...migrated.fxRates,...(raw.fxRates||{}),USD:1};
  const baseCapital=num(raw.settings?.totalAsset)||15000;
  migrated.cashFlows=[{id:uid("cash"),date:today(),type:"deposit",amountUSD:baseCapital,note:"V8 迁移：原始梦想基金本金",migration:true}];
  (Array.isArray(raw.data)?raw.data:[]).forEach(item=>{
    const currency=String(item.currency||"USD").toUpperCase(),rate=num(migrated.fxRates[currency])||1,shares=num(item.shares),avgCost=num(item.avgCost);
    if(item.status==="sold"){
      const sellPrice=num(item.sellPrice),basis=shares*avgCost*rate,proceeds=shares*sellPrice*rate;
      migrated.transactions.push({id:uid("tx"),date:item.sellDate||today(),type:"sell",symbol:String(item.symbol||"").toUpperCase(),name:item.name||"",shares,price:sellPrice,currency,fxRate:rate,fee:0,feeUSD:0,costBasisUSD:basis,grossUSD:proceeds,realizedPnlUSD:proceeds-basis,note:item.note||item.sellNote||"V8 已结算记录",migration:true});
    }else{
      const p=normalizePosition({...item,id:uid("pos"),costBasisUSD:shares*avgCost*rate});
      migrated.positions.push(p);
      migrated.transactions.push({id:uid("tx"),date:today(),type:"opening",symbol:p.symbol,name:p.name,shares:p.shares,price:p.avgCost,currency:p.currency,fxRate:rate,fee:0,feeUSD:0,costBasisUSD:p.costBasisUSD,grossUSD:p.costBasisUSD,realizedPnlUSD:0,note:"V8 迁移：期初持仓",migration:true});
    }
  });
  return migrated;
}

function normalizeState(raw){
  if(Array.isArray(raw?.data)&&!Array.isArray(raw?.positions))raw=migrateV8(raw);
  state={...structuredClone(defaultState),...(raw||{})};
  state.settings={...defaultState.settings,...(state.settings||{}),version:VERSION};
  if(state.settings.apiKey){localStorage.setItem(MARKET_KEY,String(state.settings.apiKey));delete state.settings.apiKey}
  state.fxRates={...defaultState.fxRates,...(state.fxRates||{}),USD:1};
  state.positions=(Array.isArray(state.positions)?state.positions:[]).map(normalizePosition).filter(p=>p.symbol&&p.shares>0);
  state.transactions=Array.isArray(state.transactions)?state.transactions:[];
  state.cashFlows=Array.isArray(state.cashFlows)?state.cashFlows:[];
  state.snapshots=Array.isArray(state.snapshots)?state.snapshots:[];
  if(!state.cashFlows.length){const legacy=num(state.settings.totalAsset)||15000;state.cashFlows=[{id:uid("cash"),date:today(),type:"deposit",amountUSD:legacy,note:"迁移本金",migration:true}]}
  delete state.data;delete state.settings.totalAsset;
}

async function loadSharedData(autoRefresh=false){
  const status=$("status");status.textContent="正在读取 GitHub 共享数据...";
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    const response=await fetch("data.json?ts="+Date.now(),{cache:"no-store",signal:controller.signal});clearTimeout(timer);
    if(!response.ok)throw new Error("找不到 data.json");
    normalizeState(await response.json());applyPriceCache();saveLocal();captureSnapshot(false);renderAll();
    status.textContent=`已读取共享数据：${new Date().toLocaleString("zh-CN")}`;
    if(autoRefresh&&marketKey())refreshPrices(true);
  }catch(error){
    console.warn("共享数据读取失败",error);
    const cached=localStorage.getItem(STATE_KEY)||localStorage.getItem("v8_last_state");
    if(cached){normalizeState(readJson(cached,defaultState));applyPriceCache();renderAll();status.textContent="读取失败，已使用本机缓存"}
    else{normalizeState(defaultState);renderAll();status.textContent="读取失败，已使用默认数据"}
  }
}

function saveLocal(){localStorage.setItem(STATE_KEY,JSON.stringify(state))}
function createBackup(reason="手动恢复点"){
  const list=readJson(localStorage.getItem(BACKUP_KEY),[]);
  list.unshift({id:uid("bak"),time:new Date().toISOString(),reason,state:structuredClone(state)});
  localStorage.setItem(BACKUP_KEY,JSON.stringify(list.slice(0,10)));renderBackupList();
}
function restoreBackup(id){
  const item=readJson(localStorage.getItem(BACKUP_KEY),[]).find(x=>x.id===id);if(!item)return;
  if(!confirm(`恢复到 ${new Date(item.time).toLocaleString("zh-CN")}？当前状态会先自动备份。`))return;
  createBackup("恢复前自动备份");normalizeState(structuredClone(item.state));saveLocal();renderAll();alert("恢复完成，保存到 GitHub 后共享生效");
}
function renderBackupList(){
  const box=$("backupList");if(!box)return;const list=readJson(localStorage.getItem(BACKUP_KEY),[]);
  box.innerHTML=list.length?list.map(x=>`<div class="backup-item"><span>${escapeHtml(x.reason)}<br><small class="muted">${new Date(x.time).toLocaleString("zh-CN")}</small></span><button onclick="restoreBackup('${x.id}')">恢复</button></div>`).join(""):"<p class='muted'>暂无本地恢复点</p>";
}

function contributedCapital(){return state.cashFlows.reduce((s,x)=>s+(x.type==="withdraw"?-num(x.amountUSD):num(x.amountUSD)),0)}
function realizedPnl(){return state.transactions.filter(x=>x.type==="sell").reduce((s,x)=>s+num(x.realizedPnlUSD),0)}
function currentCost(){return state.positions.reduce((s,p)=>s+num(p.costBasisUSD),0)}
function marketUSD(p){return num(p.shares)*num(p.price)*fx(p.currency)}
function marketTotal(){return state.positions.reduce((s,p)=>s+marketUSD(p),0)}
function floatingPnlUSD(p){return marketUSD(p)-num(p.costBasisUSD)}
function floatingPnl(){return marketTotal()-currentCost()}
function cashBalance(){return contributedCapital()+realizedPnl()-currentCost()}
function netAsset(){return marketTotal()+cashBalance()}
function totalPnl(){return netAsset()-contributedCapital()}
function totalReturn(){const c=contributedCapital();return c?totalPnl()/c*100:0}
function floatingReturn(){const c=currentCost();return c?floatingPnl()/c*100:0}

function getPriceCache(){return readJson(localStorage.getItem(PRICE_CACHE_KEY),null)}
function getFxCache(){return readJson(localStorage.getItem(FX_CACHE_KEY),null)}
function applyPriceCache(){const pc=getPriceCache();const fc=getFxCache();if(fc?.fxRates)state.fxRates={...state.fxRates,...fc.fxRates,USD:1};if(pc?.prices)state.positions.forEach(p=>{const q=pc.prices[p.symbol];if(q&&num(q.price)>0){p.price=num(q.price);p.changePercent=num(q.changePercent)}});if(pc?.lastPriceRefresh){state.settings.lastPriceRefresh=pc.lastPriceRefresh;state.settings.lastPriceRefreshText=pc.lastPriceRefreshText||""}}
function priceCacheValid(){const last=num(getPriceCache()?.lastPriceRefresh),mins=num(state.settings.priceCacheMinutes)||30;return last&&Date.now()-last<mins*60000}
function savePriceCache(){const prices={};state.positions.forEach(p=>prices[p.symbol]={price:p.price,changePercent:p.changePercent||0});localStorage.setItem(PRICE_CACHE_KEY,JSON.stringify({lastPriceRefresh:state.settings.lastPriceRefresh,lastPriceRefreshText:state.settings.lastPriceRefreshText,prices}))}
async function fetchJson(url){const r=await fetch(url);if(!r.ok)throw new Error("网络错误 "+r.status);return r.json()}
async function refreshFx(force=false){
  const key=marketKey();if(!key)return;const cached=getFxCache();if(!force&&cached?.time&&Date.now()-cached.time<24*3600000){state.fxRates={...state.fxRates,...cached.fxRates,USD:1};return}
  const currencies=[...new Set(state.positions.map(p=>p.currency).filter(c=>c!=="USD"))];
  for(const c of currencies){const res=await fetchJson(`https://api.twelvedata.com/exchange_rate?symbol=${c}/USD&apikey=${encodeURIComponent(key)}`);if(res.rate)state.fxRates[c]=num(res.rate)}
  state.fxRates.USD=1;localStorage.setItem(FX_CACHE_KEY,JSON.stringify({time:Date.now(),fxRates:state.fxRates}));
}
async function refreshPrices(useCache=true){
  const status=$("status"),button=$("refreshButton");
  if(useCache&&priceCacheValid()){applyPriceCache();renderAll();status.textContent="已使用缓存行情："+(state.settings.lastPriceRefreshText||"");return}
  if(!marketKey()){status.textContent="展示 GitHub 已保存行情；管理员可在设置中填写行情 Key";return}
  status.textContent="正在刷新实时价格...";button.disabled=true;
  try{
    await refreshFx(false);const items=state.positions.filter(p=>p.source==="twelve"&&p.symbol),symbols=[...new Set(items.map(p=>p.symbol))];
    if(symbols.length){const res=await fetchJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${encodeURIComponent(marketKey())}`);if(res.code||res.status==="error")throw new Error(res.message||"Twelve Data 错误");items.forEach(p=>{const q=symbols.length===1?res:res[p.symbol];const price=num(q?.close||q?.price);if(price>0)p.price=price;p.changePercent=num(q?.percent_change)})}
    state.settings.lastPriceRefresh=Date.now();state.settings.lastPriceRefreshText=new Date().toLocaleString("zh-CN");savePriceCache();saveLocal();captureSnapshot(false);renderAll();status.textContent="已刷新："+state.settings.lastPriceRefreshText+"。保存到 GitHub 后家人可见";
  }catch(error){applyPriceCache();renderAll();status.textContent="刷新失败，已保留最近行情："+error.message;if(!useCache)alert(status.textContent)}finally{button.disabled=false}
}

function saveAdminSettings(){admin={owner:$("ghOwner").value.trim(),repo:$("ghRepo").value.trim(),branch:$("ghBranch").value.trim()||"main",token:$("ghToken").value.trim()};sessionStorage.setItem("v9_admin",JSON.stringify(admin));alert("管理员设置已保存到当前浏览器会话")}
function fillAdmin(){$("ghOwner").value=admin.owner||"";$("ghRepo").value=admin.repo||"";$("ghBranch").value=admin.branch||"main";$("ghToken").value=admin.token||""}
async function getLatestSha(){const api=`https://api.github.com/repos/${admin.owner}/${admin.repo}/contents/data.json?ref=${encodeURIComponent(admin.branch)}`,r=await fetch(api,{headers:{Authorization:`Bearer ${admin.token}`,Accept:"application/vnd.github+json"}});if(r.status===404)return null;const j=await r.json();if(!r.ok)throw new Error(j.message||"获取 data.json SHA 失败");return j.sha}
async function saveToGithub(){
  saveAdminSettings();if(!admin.owner||!admin.repo||!admin.token){alert("请先填写 GitHub 用户名、仓库名和 Token");return}
  createBackup("保存 GitHub 前");
  try{$("status").textContent="正在保存到 GitHub...";const sha=await getLatestSha(),content=btoa(unescape(encodeURIComponent(JSON.stringify(state,null,2)))),body={message:"Update baby dream fund data V9",content,branch:admin.branch};if(sha)body.sha=sha;const r=await fetch(`https://api.github.com/repos/${admin.owner}/${admin.repo}/contents/data.json`,{method:"PUT",headers:{Authorization:`Bearer ${admin.token}`,Accept:"application/vnd.github+json","Content-Type":"application/json"},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw new Error(j.message||"保存失败");saveLocal();$("status").textContent="已保存到 GitHub。其他设备刷新后可见。";alert("V9 数据已保存到 GitHub") }catch(error){$("status").textContent="保存失败："+error.message;alert($("status").textContent)}
}
function saveSettings(){state.settings.title=$("titleInput").value.trim()||defaultState.settings.title;state.settings.priceCacheMinutes=Math.max(5,num($("cacheInput").value)||30);const key=$("apiKeyInput").value.trim();if(key)localStorage.setItem(MARKET_KEY,key);else localStorage.removeItem(MARKET_KEY);saveLocal();renderAll();alert("设置已应用")}

function treemapItems(){const arr=state.positions.map(p=>({label:p.symbol,value:num(p.costBasisUSD),color:p.color})).filter(x=>x.value>0),cash=cashBalance();if(cash>0)arr.push({label:"CASH",value:cash,color:"#ffd84d"});return arr.sort((a,b)=>b.value-a.value)}
function layout(items,x,y,w,h){if(!items.length)return[];if(items.length===1)return[{...items[0],x,y,w,h}];const total=items.reduce((s,i)=>s+i.value,0);let acc=0,split=0;for(let i=0;i<items.length;i++){if(acc<total/2){acc+=items[i].value;split=i+1}}split=Math.max(1,Math.min(items.length-1,split));const a=items.slice(0,split),b=items.slice(split),at=a.reduce((s,i)=>s+i.value,0);if(w>=h){const aw=w*at/total;return[...layout(a,x,y,aw,h),...layout(b,x+aw,y,w-aw,h)]}const ah=h*at/total;return[...layout(a,x,y,w,ah),...layout(b,x,y+ah,w,h-ah)]}
function renderTreemap(){const box=$("treemap");box.innerHTML="";const rect=box.getBoundingClientRect(),items=treemapItems(),denom=Math.max(contributedCapital()+realizedPnl(),1);layout(items,0,0,rect.width,rect.height).forEach(t=>{const d=document.createElement("div"),area=t.w*t.h;d.className="tile"+(area<13000?" tiny":"");Object.assign(d.style,{left:t.x+"px",top:t.y+"px",width:t.w+"px",height:t.h+"px",background:t.color,color:["#ffd84d","#eeee00","#f1a2ef"].includes(t.color)?"#07101a":"white"});d.innerHTML=`<div>${escapeHtml(t.label)}<small>${money(t.value)}｜${round(t.value/denom*100)}%</small></div>`;box.appendChild(d)})}
function sectorItems(){const map={};state.positions.forEach(p=>{const key=p.sector||"未分类";if(!map[key])map[key]={label:key,total:0,pnl:0,color:p.color};map[key].total+=num(p.costBasisUSD);map[key].pnl+=floatingPnlUSD(p)});const cash=cashBalance();if(cash>0)map["现金"]={label:"现金",total:cash,pnl:0,color:"#ffd84d"};return Object.values(map).sort((a,b)=>b.total-a.total)}
function renderSectors(){const bar=$("sectorBar"),legend=$("sectorLegend"),total=Math.max(contributedCapital()+realizedPnl(),1);bar.innerHTML="";legend.innerHTML="";sectorItems().forEach(s=>{const seg=document.createElement("div");seg.className="segment";seg.style.width=Math.max(3,s.total/total*100)+"%";seg.style.background=s.color;seg.textContent=`${s.label} ${round(s.total/total*100)}%`;bar.appendChild(seg);legend.insertAdjacentHTML("beforeend",`<span><i class="dot" style="background:${validColor(s.color)}"></i>${escapeHtml(s.label)} ${money(s.total)} <b class="${cls(s.pnl)}">${money(s.pnl)}</b></span>`)})}
function renderKpis(){$("kpiCapital").textContent=money(contributedCapital());$("kpiNetAsset").textContent=money(netAsset());$("kpiMarket").textContent=money(marketTotal());$("kpiCash").textContent=money(cashBalance());$("kpiCash").className=cls(cashBalance());$("kpiFloating").textContent=`${money(floatingPnl())} / ${round(floatingReturn())}%`;$("kpiFloating").className=cls(floatingPnl());$("kpiPnl").textContent=`${money(totalPnl())} / ${round(totalReturn())}%`;$("kpiPnl").className=cls(totalPnl())}
function renderHoldingCards(){const box=$("holdingCards");if(!state.positions.length){box.innerHTML='<div class="empty">暂无当前持仓</div>';return}box.innerHTML=state.positions.slice().sort((a,b)=>num(b.costBasisUSD)-num(a.costBasisUSD)).map(p=>`<div class="holding-card"><div class="top"><div><div class="symbol">${escapeHtml(p.symbol)}</div><div class="name">${escapeHtml(p.name)}</div></div><div class="sector-pill">${escapeHtml(p.sector)}</div></div><div class="grid"><div><div class="label">数量</div><div class="value">${round(p.shares,4)}</div></div><div><div class="label">最新价</div><div class="value">${round(p.price,4)} ${escapeHtml(p.currency)}</div></div><div><div class="label">投入成本</div><div class="value">${money(p.costBasisUSD)}</div></div><div><div class="label">市值</div><div class="value">${money(marketUSD(p))}</div></div><div><div class="label">成本仓位</div><div class="value">${round(p.costBasisUSD/Math.max(contributedCapital()+realizedPnl(),1)*100)}%</div></div><div><div class="label">浮动盈亏</div><div class="value ${cls(floatingPnlUSD(p))}">${money(floatingPnlUSD(p))} / ${round(p.costBasisUSD?floatingPnlUSD(p)/p.costBasisUSD*100:0)}%</div></div></div></div>`).join("")}

function captureSnapshot(manual=false){const date=today(),snap={date,capital:round(contributedCapital()),netAsset:round(netAsset()),market:round(marketTotal()),cash:round(cashBalance())},i=state.snapshots.findIndex(x=>x.date===date);if(i>=0)state.snapshots[i]=snap;else state.snapshots.push(snap);state.snapshots.sort((a,b)=>a.date.localeCompare(b.date));saveLocal();if(manual){renderChart();alert("今日资产快照已记录")}}
function renderChart(){const svg=$("assetChart"),data=state.snapshots.slice(-120);if(data.length<2){svg.classList.add("hidden");$("chartEmpty").classList.remove("hidden");return}svg.classList.remove("hidden");$("chartEmpty").classList.add("hidden");const W=1200,H=250,pad={l:62,r:20,t:20,b:30},values=data.flatMap(x=>[num(x.netAsset),num(x.capital)]),min=Math.min(...values),max=Math.max(...values),range=Math.max(max-min,1),x=i=>pad.l+i*(W-pad.l-pad.r)/Math.max(data.length-1,1),y=v=>pad.t+(max-v)*(H-pad.t-pad.b)/range,path=key=>data.map((d,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(num(d[key])).toFixed(1)).join(" "),area=`${path("netAsset")} L ${x(data.length-1)} ${H-pad.b} L ${x(0)} ${H-pad.b} Z`;let grid="";for(let i=0;i<4;i++){const val=max-range*i/3,yy=y(val);grid+=`<line class="chart-grid" x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/><text class="chart-label" x="4" y="${yy+4}">${money(val)}</text>`}svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.innerHTML=`<defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4f9a" stop-opacity=".25"/><stop offset="1" stop-color="#ff4f9a" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-capital" d="${path("capital")}"/><path class="chart-asset" d="${path("netAsset")}"/><circle class="chart-dot" cx="${x(data.length-1)}" cy="${y(data.at(-1).netAsset)}" r="5"/><text class="chart-label" x="${pad.l}" y="${H-5}">${escapeHtml(data[0].date)}</text><text class="chart-label" text-anchor="end" x="${W-pad.r}" y="${H-5}">${escapeHtml(data.at(-1).date)}</text>`}

function renderPositionTable(){const q=$("positionSearch")?.value.trim().toUpperCase()||"",items=state.positions.filter(p=>!q||p.symbol.includes(q)||p.name.toUpperCase().includes(q));$("positionBody").innerHTML=items.length?items.map(p=>`<tr><td class="asset-cell"><strong>${escapeHtml(p.symbol)}</strong><small>${escapeHtml(p.name)} · ${escapeHtml(p.currency)}</small></td><td>${round(p.shares,4)}</td><td>${round(p.avgCost,4)} ${escapeHtml(p.currency)}</td><td>${money(p.costBasisUSD)}</td><td>${money(marketUSD(p))}</td><td class="${cls(floatingPnlUSD(p))}">${money(floatingPnlUSD(p))}</td><td>${escapeHtml(p.sector)}</td><td><div class="row-buttons"><button onclick="openTrade('buy','${p.id}')">买入</button><button onclick="openTrade('sell','${p.id}')">卖出</button><button onclick="editPosition('${p.id}')">编辑</button></div></td></tr>`).join(""):'<tr><td colspan="8" class="muted">没有匹配的持仓</td></tr>'}
function transactionLabel(t){return t==="buy"?"买入":t==="sell"?"卖出":"V8 期初"}
function renderTransactionTable(){const q=$("transactionSearch")?.value.trim().toUpperCase()||"",type=$("transactionTypeFilter")?.value||"all",filtered=state.transactions.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).filter(t=>(!q||String(t.symbol).includes(q))&&(type==="all"||t.type===type)),pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));transactionPage=Math.min(transactionPage,pages);const items=filtered.slice((transactionPage-1)*PAGE_SIZE,transactionPage*PAGE_SIZE);$("transactionBody").innerHTML=items.length?items.map(t=>`<tr><td>${escapeHtml(t.date)}</td><td><span class="type-pill">${transactionLabel(t.type)}</span></td><td><strong>${escapeHtml(t.symbol)}</strong></td><td>${round(t.shares,4)}</td><td>${round(t.price,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fee,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fxRate,6)}</td><td class="${cls(t.realizedPnlUSD)}">${t.type==="sell"?money(t.realizedPnlUSD):"—"}</td><td>${escapeHtml(t.note||"")}</td></tr>`).join(""):'<tr><td colspan="9" class="muted">暂无交易记录</td></tr>';$("transactionPager").innerHTML=`<button ${transactionPage<=1?"disabled":""} onclick="transactionPage--;renderTransactionTable()">上一页</button><span>${transactionPage} / ${pages} · 共 ${filtered.length} 条</span><button ${transactionPage>=pages?"disabled":""} onclick="transactionPage++;renderTransactionTable()">下一页</button>`}
function renderCashFlowTable(){$("cashFlowBody").innerHTML=state.cashFlows.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(x=>`<tr><td>${escapeHtml(x.date)}</td><td>${x.type==="withdraw"?"提取本金":"追加本金"}</td><td class="${x.type==="withdraw"?"red":"green"}">${x.type==="withdraw"?"-":"+"}${money(x.amountUSD)}</td><td>${escapeHtml(x.note||"")}</td><td>${x.migration?"—":`<button class="danger" onclick="deleteCashFlow('${x.id}')">删除</button>`}</td></tr>`).join("")}
function switchLedgerTab(tab){activeLedgerTab=tab;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));["positions","transactions","cashflows","backup"].forEach(x=>$(x+"Pane").classList.toggle("hidden",x!==tab));if(tab==="backup")renderBackupList()}

function fillTradeFromPosition(p){if(!p)return;$("tradeSymbol").value=p.symbol;$("tradeName").value=p.name;$("tradeCurrency").value=p.currency;$("tradeFx").value=fx(p.currency);$("tradePrice").value=p.price||p.avgCost;$("tradeSource").value=p.source;$("tradeSector").value=p.sector;$("tradeColor").value=p.color;updateTradePreview()}
function openTrade(type,positionId=""){$("tradeType").value=type;$("tradeTitle").textContent=type==="buy"?"记录买入":"记录卖出";$("tradeDate").value=today();$("tradeSymbol").value="";$("tradeShares").value="";$("tradePrice").value="";$("tradeFee").value="0";$("tradeCurrency").value="USD";$("tradeFx").value="1";$("tradeName").value="";$("tradeSector").value="未分类";$("tradeColor").value="#38bdf8";$("tradeSource").value="twelve";$("tradeNote").value="";const existing=state.positions.find(p=>p.id===positionId);if(existing)fillTradeFromPosition(existing);["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(id=>$(id).classList.toggle("hidden",type==="sell"));updateTradePreview();$("tradeDialog").showModal();setTimeout(()=>$("tradeSymbol").focus(),30)}
function syncTradeSymbol(){const symbol=$("tradeSymbol").value.trim().toUpperCase(),p=state.positions.find(x=>x.symbol===symbol);if(p)fillTradeFromPosition(p);else{$("tradeFx").value=fx($("tradeCurrency").value)}updateTradePreview()}
function updateTradePreview(){const type=$("tradeType").value,qty=num($("tradeShares").value),price=num($("tradePrice").value),rate=num($("tradeFx").value),fee=num($("tradeFee").value),value=(qty*price+fee)*rate,symbol=$("tradeSymbol").value.trim().toUpperCase(),p=state.positions.find(x=>x.symbol===symbol);let text=`预计${type==="buy"?"占用":"收入"} ${money(type==="buy"?value:Math.max(0,(qty*price-fee)*rate))}`;if(type==="sell"&&p&&qty>0){const basis=num(p.costBasisUSD)/p.shares*qty,realized=(qty*price-fee)*rate-basis;text+=`，预计已实现盈亏 ${money(realized)}`}$("tradePreview").textContent=text}
function submitTrade(event){
  event.preventDefault();const type=$("tradeType").value,symbol=$("tradeSymbol").value.trim().toUpperCase(),date=$("tradeDate").value,shares=num($("tradeShares").value),price=num($("tradePrice").value),currency=$("tradeCurrency").value,rate=num($("tradeFx").value),fee=num($("tradeFee").value),note=$("tradeNote").value.trim();if(!symbol||!date||shares<=0||price<0||rate<=0||fee<0){alert("请检查交易信息");return}
  let p=state.positions.find(x=>x.symbol===symbol);if(type==="sell"&&(!p||shares>p.shares+1e-9)){alert("卖出数量超过当前持仓");return}if(type==="buy"&&p&&p.currency!==currency){alert("同一资产请使用相同币种；如需更正请先编辑资产资料");return}
  createBackup(`${symbol} ${type==="buy"?"买入":"卖出"}前`);
  if(type==="buy"){
    const nativeCost=shares*price+fee,usdCost=nativeCost*rate;
    if(!p){p=normalizePosition({id:uid("pos"),symbol,name:$("tradeName").value.trim(),currency,source:$("tradeSource").value,shares,avgCost:nativeCost/shares,price,sector:$("tradeSector").value.trim()||"未分类",color:$("tradeColor").value,note:"",costBasisUSD:usdCost});state.positions.push(p)}
    else{const oldNative=p.avgCost*p.shares;p.avgCost=(oldNative+nativeCost)/(p.shares+shares);p.shares+=shares;p.costBasisUSD+=usdCost;p.price=price}
    state.transactions.push({id:uid("tx"),date,type,symbol,name:p.name,shares,price,currency,fxRate:rate,fee,feeUSD:fee*rate,costBasisUSD:usdCost,grossUSD:shares*price*rate,realizedPnlUSD:0,note});
  }else{
    const basisPerShare=p.costBasisUSD/p.shares,basis=basisPerShare*shares,gross=shares*price*rate,feeUSD=fee*rate,realized=gross-feeUSD-basis;
    state.transactions.push({id:uid("tx"),date,type,symbol,name:p.name,shares,price,currency:p.currency,fxRate:rate,fee,feeUSD,costBasisUSD:basis,grossUSD:gross,realizedPnlUSD:realized,note});p.shares=round(p.shares-shares,8);p.costBasisUSD=Math.max(0,p.costBasisUSD-basis);p.price=price;if(p.shares<=1e-8)state.positions=state.positions.filter(x=>x.id!==p.id);
  }
  captureSnapshot(false);saveLocal();$("tradeDialog").close();renderAll();switchLedgerTab(type==="sell"?"transactions":"positions");
}
function editPosition(id){const p=state.positions.find(x=>x.id===id);if(!p)return;const name=prompt("资产名称",p.name);if(name===null)return;const sector=prompt("所属板块",p.sector);if(sector===null)return;const source=prompt("数据源：twelve 或 manual",p.source);if(source===null)return;if(!["twelve","manual"].includes(source)){alert("数据源只能是 twelve 或 manual");return}createBackup(`${p.symbol} 资料编辑前`);p.name=name.trim();p.sector=sector.trim()||"未分类";p.source=source;if(source==="manual"){const price=prompt(`手动最新价（${p.currency}）`,p.price);if(price!==null&&num(price)>=0)p.price=num(price)}saveLocal();renderAll()}
function openCashFlow(){$("cashDate").value=today();$("cashAmount").value="";$("cashNote").value="";$("cashDialog").showModal()}
function submitCashFlow(event){event.preventDefault();const type=$("cashType").value,date=$("cashDate").value,amountUSD=num($("cashAmount").value),note=$("cashNote").value.trim();if(!date||amountUSD<=0){alert("请填写正确金额");return}createBackup("本金变动前");state.cashFlows.push({id:uid("cash"),date,type,amountUSD,note});captureSnapshot(false);saveLocal();$("cashDialog").close();renderAll();switchLedgerTab("cashflows")}
function deleteCashFlow(id){if(!confirm("确认删除这条本金变动记录？"))return;createBackup("删除资金流水前");state.cashFlows=state.cashFlows.filter(x=>x.id!==id);captureSnapshot(false);saveLocal();renderAll()}

function downloadJson(){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a"),url=URL.createObjectURL(blob);a.href=url;a.download="data-v9.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function importJson(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const incoming=JSON.parse(reader.result);createBackup("导入数据前");normalizeState(incoming);captureSnapshot(false);saveLocal();renderAll();alert("导入成功，确认后再保存到 GitHub")}catch(error){alert("JSON 格式或数据结构不正确："+error.message)}finally{event.target.value=""}};reader.readAsText(file)}

function renderAll(){renderKpis();renderTreemap();renderSectors();renderChart();renderHoldingCards();renderPositionTable();renderTransactionTable();renderCashFlowTable();renderBackupList();$("positionCount").textContent=state.positions.length;$("transactionCount").textContent=state.transactions.length;$("cashFlowCount").textContent=state.cashFlows.length;$("pageTitle").textContent=state.settings.title;document.title=state.settings.title;$("titleInput").value=state.settings.title;$("cacheInput").value=state.settings.priceCacheMinutes;$("apiKeyInput").value=marketKey()}
function initAdminMode(){const isAdmin=new URLSearchParams(location.search).get("admin")==="1";document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdmin))}

window.addEventListener("resize",renderTreemap);
document.addEventListener("DOMContentLoaded",()=>{
  initAdminMode();fillAdmin();normalizeState(defaultState);renderAll();
  ["tradeShares","tradePrice","tradeFx","tradeFee"].forEach(id=>$(id).addEventListener("input",updateTradePreview));$("tradeSymbol").addEventListener("change",syncTradeSymbol);$("tradeCurrency").addEventListener("change",()=>{$("tradeFx").value=fx($("tradeCurrency").value);updateTradePreview()});
  loadSharedData(true);
});
