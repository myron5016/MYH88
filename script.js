const VERSION="V10.19 PWA家庭版";
const STATE_KEY="v9_last_state";
const BACKUP_KEY="v9_backups";
const PRICE_CACHE_KEY="v9_price_cache";
const FX_CACHE_KEY="v9_fx_cache";
const MARKET_KEY="v9_market_key";
const PAGE_SIZE=20;
const FETCH_TIMEOUT_MS=20000;
const PROXY_TIMEOUT_MS=25000;
const DEFAULT_PRICE_PROXY_URLS=["https://quote.myh88.com"];
const STATIC_QUOTES_URL="./kv-quotes-all-current.json";
const AUTO_FX_PROXY=false;
const AUTO_REFRESH_CHECK_MS=5*60000;
const RESUME_REFRESH_GAP_MS=20000;
const SHARED_DATA_CHECK_MS=60000;
const TAXONOMY_VERSION="sector-color-v5";

const defaultState={settings:{title:"孟一晗的梦想金库",priceCacheMinutes:30,lastPriceRefresh:0,lastPriceRefreshText:"",version:VERSION},fxRates:{USD:1,EUR:1.16,HKD:.128,JPY:.0067,GBP:1.27},positions:[],transactions:[],cashFlows:[],snapshots:[]};
let state=structuredClone(defaultState);
const legacyAdmin=readJson(localStorage.getItem("v8_admin"),{});
let admin=readJson(sessionStorage.getItem("v9_admin"),{owner:legacyAdmin.owner||"",repo:legacyAdmin.repo||"",branch:legacyAdmin.branch||"main",token:""});
let activeLedgerTab="positions";
let transactionPage=1;
let dirty=false;
let cloudState=null;
let cloudSha=null;
let lastMutationReason="";
let deferredInstallPrompt=null;
let swRegistration=null;
let updateReloading=false;
let isAdminMode=false;
let priceRefreshPromise=null;
let autoRefreshTimer=null;
let sharedDataTimer=null;
let lastAutoRefreshKick=0;
let lastSharedRaw="";
let lastMarketRoute="pending";
let lastMarketProvider="";
let lastMarketError="";

const SECTOR_RULES=[
  {label:"AI基建",color:"#16c784",symbols:["NVDA","VRT"],keywords:["英伟达","维谛","ai基建","ai基础设施","算力","数据中心","电力"]},
  {label:"AI存储",color:"#2f80ed",symbols:["MU"],keywords:["美光","存储","内存","dram","hbm"]},
  {label:"半导体",color:"#ff8a3d",symbols:["XFAB","AVGO","AMD","TSM","ASML","ARM","QCOM","AMAT","LRCX"],keywords:["半导体","芯片","晶圆","设备"]},
  {label:"光通信",color:"#00c2d7",symbols:["MRVL","AAOI","LITE"],keywords:["光通信","光通讯","光模块","光电","光芯片","迈威尔","应用光电","lumentum","鲁门特姆","朗美通"]},
  {label:"太空",color:"#ff3f6c",symbols:["RKLB","SPCX"],keywords:["太空","航天","火箭","rocket","space","spacex"]},
  {label:"科技平台",color:"#8b5cf6",symbols:["GOOGL","GOOG","META","MSFT","AMZN","AAPL"],keywords:["谷歌","平台","云","搜索","广告","软件"]},
  {label:"医疗",color:"#a855f7",symbols:["UNH","LLY","NVO","MRK","PFE","JNJ","TMO","ISRG"],keywords:["医疗","医药","制药","生物","器械"]},
  {label:"现金",color:"#ffd84d",symbols:["CASH"],keywords:["现金","cash"]},
  {label:"未分类",color:"#8b5cf6",symbols:[],keywords:["未分类"]}
];
const SECTOR_ALIAS={"光通讯":"光通信","通信光":"光通信","AI":"AI基建","人工智能":"AI基建","算力":"AI基建","航天":"太空","宇宙":"太空","现金":"现金","CASH":"现金"};

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
function hexToRgb(hex){const v=validColor(hex).slice(1);return{r:parseInt(v.slice(0,2),16),g:parseInt(v.slice(2,4),16),b:parseInt(v.slice(4,6),16)}}
function rgbToHex({r,g,b}){return"#"+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("")}
function mixColor(a,b,weight=.5){const x=hexToRgb(a),y=hexToRgb(b);return rgbToHex({r:x.r+(y.r-x.r)*weight,g:x.g+(y.g-x.g)*weight,b:x.b+(y.b-x.b)*weight})}
function sectorRule(label){const key=String(label||"未分类").trim();return SECTOR_RULES.find(r=>r.label===key)||SECTOR_RULES.at(-1)}
function sectorBaseColor(label){return sectorRule(label).color}
function normalizeSectorName(value){
  const raw=String(value||"").trim();
  if(!raw)return"未分类";
  const direct=SECTOR_ALIAS[raw]||SECTOR_ALIAS[raw.toUpperCase()];
  if(direct)return direct;
  const lower=raw.toLowerCase();
  const rule=SECTOR_RULES.find(r=>r.label===raw||r.keywords.some(k=>lower.includes(String(k).toLowerCase())));
  return rule?.label||raw;
}
function inferSector(symbol,name="",sector=""){
  const normalized=normalizeSectorName(sector);
  if(normalized&&normalized!=="未分类")return normalized;
  const ticker=String(symbol||"").trim().toUpperCase();
  const text=`${ticker} ${name}`.toLowerCase();
  const rule=SECTOR_RULES.find(r=>r.symbols.includes(ticker)||r.keywords.some(k=>text.includes(String(k).toLowerCase())));
  return rule?.label||"未分类";
}
function sectorPeerIndex(symbol,sector){
  const ticker=String(symbol||"").trim().toUpperCase();
  const peers=state.positions.filter(p=>inferSector(p.symbol,p.name,p.sector)===sector).map(p=>p.symbol).filter(Boolean).sort();
  return Math.max(0,peers.indexOf(ticker));
}
function colorForSectorMember(sector,index=0){
  const base=sectorBaseColor(sector);
  const variants=[
    mixColor(base,"#000000",.03),
    mixColor(base,"#ffffff",.30),
    mixColor(base,"#000000",.22),
    mixColor(base,"#ffffff",.46),
    mixColor(base,"#111827",.16),
    mixColor(base,"#fef3c7",.28)
  ];
  return variants[index%variants.length];
}
function autoColorForPosition(p){return colorForSectorMember(p.sector,sectorPeerIndex(p.symbol,p.sector))}
function applyAutoTaxonomy(force=false){
  state.positions.forEach(p=>{p.sector=inferSector(p.symbol,p.name,force?"":p.sector)});
  state.positions.forEach(p=>{if(force||!p.color||p.color==="#888888")p.color=autoColorForPosition(p)});
}
function fx(currency){return num(state.fxRates?.[String(currency||"USD").toUpperCase()])||1}
function marketKey(){return isAdminMode?localStorage.getItem(MARKET_KEY)||state.settings?.publicMarketKey||state.settings?.apiKey||"":""}
function normalizeProxyUrl(value){return String(value||"").trim().replace(/\/+$/,"")}
function parseProxyUrls(value){return String(value||"").split(/[\n,，\s]+/).map(normalizeProxyUrl).filter(Boolean)}
function priceProxyUrls(){
  const configured=[...(Array.isArray(state.settings?.priceProxyUrls)?state.settings.priceProxyUrls:[]),state.settings?.priceProxyUrl,localStorage.getItem("v10_price_proxy")];
  const urls=[...configured.flatMap(parseProxyUrls),...DEFAULT_PRICE_PROXY_URLS];
  return [...new Set(urls)];
}
function priceProxyUrl(){return priceProxyUrls()[0]||""}
function isStandalone(){return window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true}
function isIos(){return /iphone|ipad|ipod/i.test(navigator.userAgent)}
function updateNetworkStatus(){
  const online=navigator.onLine,badge=$("networkBadge");if(badge){badge.textContent=online?"在线":"离线";badge.className=`network-badge ${online?"online":"offline"}`}
  const refresh=$("refreshButton"),save=$("githubSaveButton");if(refresh)refresh.disabled=!online;if(save)save.disabled=!online;
  if(!online){$("status").textContent="当前离线：正在显示设备中最近缓存的数据"}
}
function updateInstallButton(){const button=$("installAppButton");if(!button)return;button.classList.toggle("hidden",isStandalone())}
function installApp(){
  if(isStandalone()){alert("梦想金库已经安装在这台设备上");return}
  $("nativeInstallHelp").classList.toggle("hidden",!deferredInstallPrompt);$("iosInstallHelp").classList.toggle("hidden",!isIos()||!!deferredInstallPrompt);$("genericInstallHelp").classList.toggle("hidden",isIos()||!!deferredInstallPrompt);$("installDialog").showModal();
}
async function triggerNativeInstall(){if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$("installDialog").close();updateInstallButton()}
function showUpdateBanner(){$("updateBanner")?.classList.remove("hidden")}
function applyAppUpdate(){if(swRegistration?.waiting)swRegistration.waiting.postMessage({type:"SKIP_WAITING"});else location.reload()}
async function registerPwa(){
  if(!("serviceWorker" in navigator)||!window.isSecureContext)return;
  try{
    swRegistration=await navigator.serviceWorker.register("./service-worker.js");
    if(swRegistration.waiting){showUpdateBanner();if(!isAdminMode&&!dirty)applyAppUpdate()}
    swRegistration.addEventListener("updatefound",()=>{const worker=swRegistration.installing;if(!worker)return;worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller){showUpdateBanner();if(!isAdminMode&&!dirty)applyAppUpdate()}})});
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(updateReloading)return;updateReloading=true;location.reload()});
  }catch(error){console.warn("PWA 注册失败",error)}
}

function normalizePosition(p){
  p.id=p.id||uid("pos");p.symbol=String(p.symbol||"").trim().toUpperCase();p.name=String(p.name||"");p.currency=String(p.currency||"USD").toUpperCase();p.source=p.source==="manual"?"manual":"twelve";p.shares=num(p.shares);p.avgCost=num(p.avgCost);p.price=num(p.price);p.sector=inferSector(p.symbol,p.name,p.sector);p.color=validColor(p.color||autoColorForPosition(p));p.note=String(p.note||"");
  if(!Number.isFinite(Number(p.costBasisUSD)))p.costBasisUSD=p.shares*p.avgCost*fx(p.currency);else p.costBasisUSD=num(p.costBasisUSD);
  return p;
}

function migrateV8(raw){
  const migrated=structuredClone(defaultState);
  migrated.settings={...migrated.settings,...(raw.settings||{}),version:VERSION,migratedFrom:"V8.0",migratedAt:new Date().toISOString()};
  if(raw.settings?.apiKey)migrated.settings.publicMarketKey=String(raw.settings.apiKey);
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
  const incomingTaxonomy=raw?.settings?.taxonomyVersion||"";
  state={...structuredClone(defaultState),...(raw||{})};
  state.settings={...defaultState.settings,...(state.settings||{}),version:VERSION};
  if(state.settings.apiKey&&!state.settings.publicMarketKey)state.settings.publicMarketKey=String(state.settings.apiKey);
  state.fxRates={...defaultState.fxRates,...(state.fxRates||{}),USD:1};
  state.positions=(Array.isArray(state.positions)?state.positions:[]).map(normalizePosition).filter(p=>p.symbol&&p.shares>0);
  applyAutoTaxonomy(incomingTaxonomy!==TAXONOMY_VERSION);
  state.settings.taxonomyVersion=TAXONOMY_VERSION;
  state.transactions=Array.isArray(state.transactions)?state.transactions:[];
  state.cashFlows=Array.isArray(state.cashFlows)?state.cashFlows:[];
  state.snapshots=Array.isArray(state.snapshots)?state.snapshots:[];
  if(!state.cashFlows.length){const legacy=num(state.settings.totalAsset)||15000;state.cashFlows=[{id:uid("cash"),date:today(),type:"deposit",amountUSD:legacy,note:"迁移本金",migration:true}]}
  delete state.data;delete state.settings.totalAsset;
}

async function fetchSharedText(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch("data.json?ts="+Date.now(),{cache:"no-store",signal:controller.signal});
    if(!response.ok)throw new Error("找不到 data.json");
    return await response.text();
  }finally{
    clearTimeout(timer);
  }
}
function applySharedDataText(raw,reason=""){
  const shared=JSON.parse(raw),versionChanged=shared?.settings?.version!==VERSION;normalizeState(shared);applyPriceCache();cloudState=structuredClone(state);lastSharedRaw=raw;const snapshotChanged=isAdminMode?captureSnapshot(false):false;dirty=isAdminMode&&(versionChanged||snapshotChanged);lastMutationReason=isAdminMode?(versionChanged?"账本已升级到 V10，等待首次安全保存":snapshotChanged?"今日资产快照":""):"";saveLocal();renderAll();renderSyncStatus();if(reason)$("status").textContent=reason;
}
async function loadSharedData(autoRefresh=false){
  const status=$("status");status.textContent="正在读取 GitHub 共享数据...";
  try{
    const raw=await fetchSharedText();applySharedDataText(raw);
    status.textContent=navigator.onLine?(isAdminMode?`已读取共享数据：${new Date().toLocaleString("zh-CN")}`:"已读取最新云端账本"):"离线模式：已读取设备中最近缓存的数据";
    if(admin.owner&&admin.repo&&admin.token)checkCloudStatus(false);if(autoRefresh)refreshPrices(false);
  }catch(error){
    console.warn("共享数据读取失败",error);
    const cached=localStorage.getItem(STATE_KEY)||localStorage.getItem("v8_last_state");
    if(cached){normalizeState(readJson(cached,defaultState));applyPriceCache();dirty=isAdminMode;lastMutationReason=isAdminMode?"正在使用本机缓存":"";renderAll();status.textContent="读取失败，已使用本机缓存"}
    else{normalizeState(defaultState);dirty=isAdminMode;lastMutationReason=isAdminMode?"云端读取失败":"";renderAll();status.textContent="读取失败，已使用默认数据"}
    renderSyncStatus();
  }
}

async function checkSharedDataUpdate(force=false){
  if(isAdminMode||dirty||!navigator.onLine||document.visibilityState==="hidden")return;
  try{
    const raw=await fetchSharedText();
    if(!lastSharedRaw){lastSharedRaw=raw;renderSyncStatus();return}
    if(raw!==lastSharedRaw){
      applySharedDataText(raw,"已自动载入最新云端账本");
      return;
    }
    renderSyncStatus();
    if(force)$("status").textContent="云端账本已是最新";
  }catch(error){
    console.warn("云端账本自动检测失败",error);
    renderDiagnostics();
  }
}

function saveLocal(){localStorage.setItem(STATE_KEY,JSON.stringify(state))}
function markDirty(reason="本地数据已修改"){dirty=true;lastMutationReason=reason;state.settings.localUpdatedAt=new Date().toISOString();saveLocal();renderSyncStatus()}
function summaryOf(s){return{positions:Array.isArray(s?.positions)?s.positions.length:0,transactions:Array.isArray(s?.transactions)?s.transactions.length:0,cashFlows:Array.isArray(s?.cashFlows)?s.cashFlows.length:0,snapshots:Array.isArray(s?.snapshots)?s.snapshots.length:0}}
function dangerBetween(local,remote){const l=summaryOf(local),r=summaryOf(remote),reasons=[],intentionalTransactionDelete=dirty&&/交易已删除/.test(lastMutationReason);if(l.transactions<r.transactions&&!intentionalTransactionDelete)reasons.push(`交易流水从 ${r.transactions} 条减少到 ${l.transactions} 条`);if(l.cashFlows<r.cashFlows)reasons.push(`资金流水从 ${r.cashFlows} 条减少到 ${l.cashFlows} 条`);if(!l.positions&&r.positions&&l.transactions<=r.transactions)reasons.push(`当前持仓从 ${r.positions} 个变成 0 个`);return reasons}
function renderSyncStatus(mode=""){
  const dot=$("syncDot"),label=$("syncLabel"),detail=$("syncDetail");if(!dot||!label||!detail)return;
  dot.className="sync-dot";
  if(mode==="checking"){dot.classList.add("checking");label.textContent="正在核对云端数据";detail.textContent="读取 GitHub 最新账本…";return}
  const danger=cloudState?dangerBetween(state,cloudState):[];
  if(danger.length){dot.classList.add("danger");label.textContent="已阻止危险覆盖";detail.textContent=danger.join("；");return}
  if(dirty){dot.classList.add("dirty");label.textContent="有尚未保存的本地修改";detail.textContent=lastMutationReason||"保存到 GitHub 后其他设备才能看到";return}
  dot.classList.add("clean");
  if(isAdminMode){
    label.textContent=cloudState?"账本已与 GitHub 同步":"已载入账本";
    detail.textContent=state.settings.lastCloudSaveAt?`上次云端保存：${new Date(state.settings.lastCloudSaveAt).toLocaleString("zh-CN")}`:"当前没有未保存修改";
  }else{
    label.textContent=cloudState?"云端账本已是最新":"已载入账本";
    detail.textContent=cloudState?"页面会自动检测新的云端账本":"正在使用本机最近缓存";
  }
  renderDiagnostics();
}
function marketProviderLabel(){
  if(lastMarketProvider==="twelve")return"TWE";
  if(lastMarketProvider==="finnhub")return"FIN";
  if(lastMarketProvider==="mixed")return"TWE/FIN";
  if(lastMarketProvider==="static")return"静态缓存";
  return"";
}
function marketRouteLabel(){
  const provider=marketProviderLabel();
  if(lastMarketRoute==="proxy")return provider?`行情：${provider} 代理`:"行情：代理线路";
  if(lastMarketRoute==="fallback")return provider?`行情：${provider} 备用`:"行情：备用线路";
  if(lastMarketRoute==="direct")return"行情：直连线路";
  if(lastMarketRoute==="cache")return"行情：本机缓存";
  if(lastMarketRoute==="static")return"行情：静态缓存";
  if(lastMarketRoute==="failed")return"行情：刷新失败";
  return"行情：等待刷新";
}
function renderDiagnostics(){
  const version=$("versionStatus"),route=$("marketRouteStatus"),cloud=$("cloudFreshStatus");
  if(version)version.textContent=`版本：${VERSION}`;
  if(route)route.textContent=marketRouteLabel();
  if(cloud)cloud.textContent=isAdminMode?(cloudState?"账本：已核对 GitHub":"账本：等待核对"):(cloudState?"账本：云端最新":"账本：本机缓存");
}
function createBackup(reason="手动恢复点"){
  const list=readJson(localStorage.getItem(BACKUP_KEY),[]);
  list.unshift({id:uid("bak"),time:new Date().toISOString(),reason,state:structuredClone(state)});
  localStorage.setItem(BACKUP_KEY,JSON.stringify(list.slice(0,10)));renderBackupList();
}
function restoreBackup(id){
  const item=readJson(localStorage.getItem(BACKUP_KEY),[]).find(x=>x.id===id);if(!item)return;
  if(!confirm(`恢复到 ${new Date(item.time).toLocaleString("zh-CN")}？当前状态会先自动备份。`))return;
  createBackup("恢复前自动备份");normalizeState(structuredClone(item.state));markDirty("已恢复本地备份");renderAll();alert("恢复完成，保存到 GitHub 后共享生效");
}
function renderBackupList(){
  const box=$("backupList");if(!box)return;const list=readJson(localStorage.getItem(BACKUP_KEY),[]);
  box.innerHTML=list.length?list.map(x=>`<div class="backup-item"><span>${escapeHtml(x.reason)}<br><small class="muted">${new Date(x.time).toLocaleString("zh-CN")}</small></span><button onclick="restoreBackup('${x.id}')">恢复</button></div>`).join(""):"<p class='muted'>暂无本地恢复点</p>";
}

function contributedCapital(){return state.cashFlows.filter(x=>!x.voided).reduce((s,x)=>s+(x.type==="withdraw"?-num(x.amountUSD):num(x.amountUSD)),0)}
function realizedPnl(){return state.transactions.filter(x=>x.type==="sell"&&!x.voided).reduce((s,x)=>s+num(x.realizedPnlUSD),0)}
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
function friendlyFetchError(error){
  if(error?.name==="AbortError")return"请求超时，请检查手机网络后会自动重试";
  if(error instanceof TypeError)return"网络请求失败，可能是手机网络或微信浏览器临时拦截";
  return error?.message||"网络请求失败";
}
async function fetchJson(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeout||FETCH_TIMEOUT_MS);
  try{
    const r=await fetch(url,{cache:"no-store",credentials:"omit",...options,signal:controller.signal});
    if(!r.ok)throw new Error("网络错误 "+r.status);
    return r.json();
  }catch(error){
    throw new Error(friendlyFetchError(error));
  }finally{
    clearTimeout(timer);
  }
}
async function fetchStaticQuoteCache(symbols){
  const data=await fetchJson(STATIC_QUOTES_URL,{timeout:FETCH_TIMEOUT_MS});
  const quotes=typeof data.body==="string"?JSON.parse(data.body):data;
  const picked={};
  symbols.forEach(symbol=>{if(quotes?.[symbol])picked[symbol]=quotes[symbol]});
  if(Object.keys(picked).length)return symbols.length===1?picked[symbols[0]]:picked;
  throw new Error("Static quote cache missing requested symbols");
}
async function refreshFx(force=false){
  if(!AUTO_FX_PROXY){
    state.fxRates={...state.fxRates,USD:1};
    localStorage.setItem(FX_CACHE_KEY,JSON.stringify({time:Date.now(),fxRates:state.fxRates,manual:true}));
    return;
  }
  const proxies=priceProxyUrls();if(!proxies.length)return;const cached=getFxCache();if(!force&&cached?.time&&Date.now()-cached.time<24*3600000){state.fxRates={...state.fxRates,...cached.fxRates,USD:1};return}
  const currencies=[...new Set(state.positions.map(p=>p.currency).filter(c=>c!=="USD"))];
  if(currencies.length){
    let lastError=null;
    for(const proxy of proxies){
      try{
        const res=await fetchJson(`${proxy}/fx?currencies=${encodeURIComponent(currencies.join(","))}`,{timeout:PROXY_TIMEOUT_MS});state.fxRates={...state.fxRates,...(res.rates||{}),USD:1};lastError=null;break
      }catch(error){lastError=error}
    }
    if(lastError)throw lastError;
  }
  state.fxRates.USD=1;localStorage.setItem(FX_CACHE_KEY,JSON.stringify({time:Date.now(),fxRates:state.fxRates}));
}
async function fetchQuoteBatch(symbols){
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const proxy=priceProxyUrl();
      if(!proxy)throw new Error("缺少 Cloudflare Worker 行情代理地址");
      const res=await fetchJson(`${proxy}/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,{timeout:PROXY_TIMEOUT_MS});
      if(res.code||res.status==="error")throw new Error(res.message||"Twelve Data 错误");
      lastMarketRoute="proxy";
      return res;
    }catch(error){
      lastError=error;
      await new Promise(resolve=>setTimeout(resolve, attempt*900));
    }
  }
  throw lastError;
}
async function fetchQuoteBatchResilient(symbols){
  let lastError=null;
  const proxies=priceProxyUrls();
  if(!proxies.length)throw new Error("Missing Cloudflare Worker price proxy URL");
  for(let attempt=1;attempt<=3;attempt++){
    for(const proxy of proxies){
      try{
        const res=await fetchJson(`${proxy}/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,{timeout:PROXY_TIMEOUT_MS});
        if(res.code||res.status==="error")throw new Error(res.message||"Quote proxy error");
        lastMarketRoute=proxy===proxies[0]?"proxy":"fallback";
        return res;
      }catch(error){
        lastError=error;
      }
    }
    await new Promise(resolve=>setTimeout(resolve, attempt*900));
  }
  try{
    const cached=await fetchStaticQuoteCache(symbols);
    lastMarketRoute="static";
    lastMarketProvider="static";
    lastMarketError=lastError?.message||"proxy unavailable";
    return cached;
  }catch(error){
    lastError=lastError||error;
  }
  throw lastError;
}
async function refreshPrices(useCache=true){
  if(priceRefreshPromise)return priceRefreshPromise;
  priceRefreshPromise=doRefreshPrices(useCache).finally(()=>{priceRefreshPromise=null});
  return priceRefreshPromise;
}
async function doRefreshPrices(useCache=true){
  const status=$("status"),button=$("refreshButton"),proxy=priceProxyUrl();
  if(!navigator.onLine){status.textContent="当前离线，无法刷新行情；正在显示最近缓存价格";return}
  if(useCache&&priceCacheValid()){lastMarketRoute="cache";applyPriceCache();renderAll();status.textContent="已使用缓存行情："+(state.settings.lastPriceRefreshText||"");return}
  if(!proxy){status.textContent="刷新失败：管理员需要先填写 Cloudflare Worker 行情代理地址";if(!useCache)alert(status.textContent);return}
  status.textContent="正在通过行情代理刷新实时价格...";if(button)button.disabled=true;
  lastMarketError="";
  try{
    try{await refreshFx(false)}catch(error){console.warn("FX refresh failed; keep cached rates",error);state.fxRates={...state.fxRates,...(getFxCache()?.fxRates||{}),USD:1}}
    const items=state.positions.filter(p=>p.source==="twelve"&&p.symbol),symbols=[...new Set(items.map(p=>p.symbol))];
    if(symbols.length){
      const res=await fetchQuoteBatchResilient(symbols),providers=new Set();
      items.forEach(p=>{const q=symbols.length===1?res:res[p.symbol];const provider=String(q?.source||"twelve").toLowerCase();if(provider)providers.add(provider);const price=num(q?.close||q?.price);if(price>0)p.price=price;p.changePercent=num(q?.percent_change)});
      if(providers.size===1)lastMarketProvider=[...providers][0];else if(providers.size>1)lastMarketProvider="mixed";
    }
    state.settings.lastPriceRefresh=Date.now();state.settings.lastPriceRefreshText=new Date().toLocaleString("zh-CN");savePriceCache();
    if(isAdminMode){captureSnapshot(false);markDirty("实时行情与今日快照已更新")}else saveLocal();
    renderAll();status.textContent=lastMarketRoute==="static"?`代理行情失败，已临时使用静态缓存：${lastMarketError}`:(isAdminMode?"已刷新："+state.settings.lastPriceRefreshText+"。保存到 GitHub 后家人可见":"已刷新："+state.settings.lastPriceRefreshText+"。本次价格已缓存在本设备");
  }catch(error){lastMarketRoute="failed";applyPriceCache();renderAll();status.textContent="代理行情暂时不可用，已保留最近缓存行情："+friendlyFetchError(error);if(!useCache&&isAdminMode)alert(status.textContent)}finally{renderDiagnostics();if(button)button.disabled=false}
}
function saveAdminSettings(showAlert=true){admin={owner:$("ghOwner").value.trim(),repo:$("ghRepo").value.trim(),branch:$("ghBranch").value.trim()||"main",token:$("ghToken").value.trim()};sessionStorage.setItem("v9_admin",JSON.stringify(admin));if(showAlert){alert("管理员设置已保存到当前浏览器会话");if(admin.owner&&admin.repo&&admin.token)checkCloudStatus(false)}}
function fillAdmin(){$("ghOwner").value=admin.owner||"";$("ghRepo").value=admin.repo||"";$("ghBranch").value=admin.branch||"main";$("ghToken").value=admin.token||""}
function githubHeaders(){return{Authorization:`Bearer ${admin.token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}}
function githubUrl(path){return`https://api.github.com/repos/${admin.owner}/${admin.repo}/contents/${path}`}
function encodeData(value){return btoa(unescape(encodeURIComponent(value)))}
function decodeData(value){return decodeURIComponent(escape(atob(String(value||"").replace(/\n/g,""))))}
async function getRemoteData(){const r=await fetch(`${githubUrl("data.json")}?ref=${encodeURIComponent(admin.branch)}`,{headers:githubHeaders()});if(r.status===404)return{sha:null,data:structuredClone(defaultState),raw:JSON.stringify(defaultState,null,2)};const j=await r.json();if(!r.ok)throw new Error(j.message||"读取 GitHub data.json 失败");const raw=decodeData(j.content);return{sha:j.sha,data:JSON.parse(raw),raw}}
async function putGithubFile(path,raw,message,sha=null){const body={message,content:encodeData(raw),branch:admin.branch};if(sha)body.sha=sha;const r=await fetch(githubUrl(path),{method:"PUT",headers:{...githubHeaders(),"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw new Error(j.message||`写入 ${path} 失败`);return j}
async function checkCloudStatus(manual=false){
  if(!admin.owner||!admin.repo||!admin.token){renderSyncStatus();if(manual)alert("请先填写 GitHub 用户名、仓库名和 Token");return null}
  renderSyncStatus("checking");
  try{const remote=await getRemoteData();cloudState=remote.data;cloudSha=remote.sha;renderSyncStatus();if(manual){const l=summaryOf(state),r=summaryOf(cloudState),danger=dangerBetween(state,cloudState);alert(danger.length?`发现危险差异，保存已被锁定：\n${danger.join("\n")}`:`核对完成。\n本地：${l.positions} 个持仓 / ${l.transactions} 条交易\n云端：${r.positions} 个持仓 / ${r.transactions} 条交易`)}return remote}catch(error){cloudState=null;renderSyncStatus();if(manual)alert("云端核对失败："+error.message);return null}
}
async function createCloudBackup(remote){
  if(!remote?.sha)return null;const stamp=new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,17),path=`backups/data-${stamp}.json`;const result=await putGithubFile(path,remote.raw,`Backup data.json before V10 save (${stamp})`);const box=$("cloudBackupStatus");if(box)box.textContent=`已备份旧云端账本：${path}`;return{path,result}
}
async function saveToGithub(){
  if(!navigator.onLine){alert("当前离线，不能保存到 GitHub。联网后再试，所有本地修改仍保留在本机。");return}
  saveAdminSettings(false);if(!admin.owner||!admin.repo||!admin.token){alert("请先填写 GitHub 用户名、仓库名和 Token");return}
  const button=$("githubSaveButton");button.disabled=true;renderSyncStatus("checking");$("status").textContent="正在进行保存前安全核对...";
  try{
    const remote=await getRemoteData(),danger=dangerBetween(state,remote.data);cloudState=remote.data;cloudSha=remote.sha;
    if(danger.length){renderSyncStatus();throw new Error(`安全锁已阻止覆盖：${danger.join("；")}。请先恢复或重新载入云端数据。`)}
    const l=summaryOf(state),r=summaryOf(remote.data);
    if(!confirm(`即将安全保存到 GitHub：\n\n本地：${l.positions} 个持仓 / ${l.transactions} 条交易 / ${l.cashFlows} 条资金流水\n云端：${r.positions} 个持仓 / ${r.transactions} 条交易 / ${r.cashFlows} 条资金流水\n\n系统会先备份旧云端账本，再执行保存。是否继续？`)){renderSyncStatus();return}
    createBackup("安全保存 GitHub 前");$("status").textContent="正在备份旧的云端账本...";await createCloudBackup(remote);
    state.settings.version=VERSION;state.settings.lastCloudSaveAt=new Date().toISOString();const raw=JSON.stringify(state,null,2);$("status").textContent="云端备份完成，正在保存新账本...";const result=await putGithubFile("data.json",raw,"Update baby dream fund data V10",remote.sha);
    cloudSha=result.content?.sha||null;cloudState=structuredClone(state);dirty=false;lastMutationReason="";saveLocal();renderSyncStatus();$("status").textContent="安全保存完成：旧账本已备份，新账本已同步。";alert("V10 安全保存完成。旧的云端账本已经自动备份。")
  }catch(error){renderSyncStatus();$("status").textContent="保存失败："+error.message;alert($("status").textContent)}finally{button.disabled=!navigator.onLine}
}
function saveSettings(){state.settings.title=$("titleInput").value.trim()||defaultState.settings.title;state.settings.priceCacheMinutes=Math.max(30,num($("cacheInput").value)||30);const proxy=$("proxyInput")?.value.trim()||"";if(proxy){localStorage.setItem("v10_price_proxy",proxy);state.settings.priceProxyUrl=proxy}else{localStorage.removeItem("v10_price_proxy");delete state.settings.priceProxyUrl}localStorage.removeItem(MARKET_KEY);delete state.settings.publicMarketKey;delete state.settings.apiKey;markDirty("看板设置已修改，行情将只通过 Cloudflare Worker 代理读取");renderAll();alert("设置已应用。安全保存到 GitHub 后，家人访问页面会只通过 Cloudflare Worker 行情代理刷新。")}

function treemapItems(){const arr=state.positions.map(p=>({label:p.symbol,value:num(p.costBasisUSD),color:p.color})).filter(x=>x.value>0),cash=cashBalance();if(cash>0)arr.push({label:"CASH",value:cash,color:"#ffd84d"});return arr.sort((a,b)=>b.value-a.value)}
function layout(items,x,y,w,h){if(!items.length)return[];if(items.length===1)return[{...items[0],x,y,w,h}];const total=items.reduce((s,i)=>s+i.value,0);let acc=0,split=0;for(let i=0;i<items.length;i++){if(acc<total/2){acc+=items[i].value;split=i+1}}split=Math.max(1,Math.min(items.length-1,split));const a=items.slice(0,split),b=items.slice(split),at=a.reduce((s,i)=>s+i.value,0);if(w>=h){const aw=w*at/total;return[...layout(a,x,y,aw,h),...layout(b,x+aw,y,w-aw,h)]}const ah=h*at/total;return[...layout(a,x,y,w,ah),...layout(b,x,y+ah,w,h-ah)]}
function renderTreemap(){const box=$("treemap");box.innerHTML="";const rect=box.getBoundingClientRect(),items=treemapItems(),denom=Math.max(contributedCapital()+realizedPnl(),1);layout(items,0,0,rect.width,rect.height).forEach(t=>{const d=document.createElement("div"),area=t.w*t.h,share=round(t.value/denom*100),textColor=t.label==="CASH"?"#07101a":"white";d.className="tile"+(area<13000?" tiny":"")+(area<6200?" micro":"");Object.assign(d.style,{left:t.x+"px",top:t.y+"px",width:t.w+"px",height:t.h+"px",background:`radial-gradient(circle at 28% 18%, ${mixColor(t.color,"#ffffff",.28)}, transparent 58%), linear-gradient(145deg, ${mixColor(t.color,"#ffffff",.04)}, ${mixColor(t.color,"#000000",.18)})`,borderColor:mixColor(t.color,"#020617",.38),color:textColor});d.title=`${t.label} ${money(t.value)} | ${share}%`;d.innerHTML=area<6200?`<div>${escapeHtml(t.label)}</div>`:`<div>${escapeHtml(t.label)}<small>${money(t.value)} | ${share}%</small></div>`;box.appendChild(d)})}
function sectorItems(){const map={};state.positions.forEach(p=>{const key=inferSector(p.symbol,p.name,p.sector);if(!map[key])map[key]={label:key,total:0,pnl:0,color:sectorBaseColor(key)};map[key].total+=num(p.costBasisUSD);map[key].pnl+=floatingPnlUSD(p)});const cash=cashBalance();if(cash>0)map["现金"]={label:"现金",total:cash,pnl:0,color:sectorBaseColor("现金")};return Object.values(map).sort((a,b)=>b.total-a.total)}
function renderSectors(){const bar=$("sectorBar"),legend=$("sectorLegend"),total=Math.max(contributedCapital()+realizedPnl(),1);bar.innerHTML="";legend.innerHTML="";sectorItems().forEach(s=>{const seg=document.createElement("div");seg.className="segment";seg.style.width=Math.max(3,s.total/total*100)+"%";seg.style.background=s.color;seg.textContent=`${s.label} ${round(s.total/total*100)}%`;bar.appendChild(seg);legend.insertAdjacentHTML("beforeend",`<span><i class="dot" style="background:${validColor(s.color)}"></i>${escapeHtml(s.label)} ${money(s.total)} <b class="${cls(s.pnl)}">${money(s.pnl)}</b></span>`)})}
function renderKpis(){$("kpiCapital").textContent=money(contributedCapital());$("kpiNetAsset").textContent=money(netAsset());$("kpiMarket").textContent=money(marketTotal());$("kpiCash").textContent=money(cashBalance());$("kpiCash").className=cls(cashBalance());if($("kpiRealized")){$("kpiRealized").textContent=money(realizedPnl());$("kpiRealized").className=cls(realizedPnl())}$("kpiFloating").textContent=`${money(floatingPnl())} / ${round(floatingReturn())}%`;$("kpiFloating").className=cls(floatingPnl());$("kpiPnl").textContent=`${money(totalPnl())} / ${round(totalReturn())}%`;$("kpiPnl").className=cls(totalPnl())}function renderHoldingCards(){const box=$("holdingCards");if(!state.positions.length){box.innerHTML='<div class="empty">暂无当前持仓</div>';return}box.innerHTML=state.positions.slice().sort((a,b)=>num(b.costBasisUSD)-num(a.costBasisUSD)).map(p=>`<div class="holding-card"><div class="top"><div><div class="symbol">${escapeHtml(p.symbol)}</div><div class="name">${escapeHtml(p.name)}</div></div><div class="sector-pill">${escapeHtml(p.sector)}</div></div><div class="grid"><div><div class="label">数量</div><div class="value">${round(p.shares,4)}</div></div><div><div class="label">最新价</div><div class="value">${round(p.price,4)} ${escapeHtml(p.currency)}</div></div><div><div class="label">单股成本</div><div class="value">${round(p.avgCost,4)} ${escapeHtml(p.currency)}</div></div><div><div class="label">投入成本</div><div class="value">${money(p.costBasisUSD)}</div></div><div><div class="label">市值</div><div class="value">${money(marketUSD(p))}</div></div><div><div class="label">成本仓位</div><div class="value">${round(p.costBasisUSD/Math.max(contributedCapital()+realizedPnl(),1)*100)}%</div></div><div><div class="label">浮动盈亏</div><div class="value ${cls(floatingPnlUSD(p))}">${money(floatingPnlUSD(p))} / ${round(p.costBasisUSD?floatingPnlUSD(p)/p.costBasisUSD*100:0)}%</div></div></div></div>`).join("")}function captureSnapshot(manual=false){const date=today(),snap={date,capital:round(contributedCapital()),netAsset:round(netAsset()),market:round(marketTotal()),cash:round(cashBalance())},i=state.snapshots.findIndex(x=>x.date===date),before=i>=0?JSON.stringify(state.snapshots[i]):"",changed=before!==JSON.stringify(snap);if(i>=0)state.snapshots[i]=snap;else state.snapshots.push(snap);state.snapshots.sort((a,b)=>a.date.localeCompare(b.date));saveLocal();if(manual){markDirty("今日资产快照已记录");renderChart();alert("今日资产快照已记录，尚未保存到 GitHub")}return changed}
function renderChart(){const svg=$("assetChart"),data=state.snapshots.slice(-120);if(data.length<2){svg.classList.add("hidden");$("chartEmpty").classList.remove("hidden");return}svg.classList.remove("hidden");$("chartEmpty").classList.add("hidden");const W=1200,H=250,pad={l:62,r:20,t:20,b:30},values=data.flatMap(x=>[num(x.netAsset),num(x.capital)]),min=Math.min(...values),max=Math.max(...values),range=Math.max(max-min,1),x=i=>pad.l+i*(W-pad.l-pad.r)/Math.max(data.length-1,1),y=v=>pad.t+(max-v)*(H-pad.t-pad.b)/range,path=key=>data.map((d,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(num(d[key])).toFixed(1)).join(" "),area=`${path("netAsset")} L ${x(data.length-1)} ${H-pad.b} L ${x(0)} ${H-pad.b} Z`;let grid="";for(let i=0;i<4;i++){const val=max-range*i/3,yy=y(val);grid+=`<line class="chart-grid" x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/><text class="chart-label" x="4" y="${yy+4}">${money(val)}</text>`}svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.innerHTML=`<defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4f9a" stop-opacity=".25"/><stop offset="1" stop-color="#ff4f9a" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-capital" d="${path("capital")}"/><path class="chart-asset" d="${path("netAsset")}"/><circle class="chart-dot" cx="${x(data.length-1)}" cy="${y(data.at(-1).netAsset)}" r="5"/><text class="chart-label" x="${pad.l}" y="${H-5}">${escapeHtml(data[0].date)}</text><text class="chart-label" text-anchor="end" x="${W-pad.r}" y="${H-5}">${escapeHtml(data.at(-1).date)}</text>`}

function renderPositionTable(){const q=$("positionSearch")?.value.trim().toUpperCase()||"",items=state.positions.filter(p=>!q||p.symbol.includes(q)||p.name.toUpperCase().includes(q));$("positionBody").innerHTML=items.length?items.map(p=>`<tr><td class="asset-cell"><strong>${escapeHtml(p.symbol)}</strong><small>${escapeHtml(p.name)} · ${escapeHtml(p.currency)}</small></td><td>${round(p.shares,4)}</td><td>${round(p.avgCost,4)} ${escapeHtml(p.currency)}</td><td>${money(p.costBasisUSD)}</td><td>${money(marketUSD(p))}</td><td class="${cls(floatingPnlUSD(p))}">${money(floatingPnlUSD(p))}</td><td>${escapeHtml(p.sector)}</td><td>${isAdminMode?`<div class="row-buttons"><button onclick="openTrade('buy','${p.id}')">买入</button><button onclick="openTrade('sell','${p.id}')">卖出</button><button onclick="editPosition('${p.id}')">编辑</button></div>`:"—"}</td></tr>`).join(""):'<tr><td colspan="8" class="muted">没有匹配的持仓</td></tr>'}function transactionLabel(t){if(t.voided)return"已撤销";return t.type==="buy"?"买入":t.type==="sell"?"卖出":"V8 期初"}
function latestCorrectableTransaction(){return state.transactions.slice().reverse().find(t=>["buy","sell"].includes(t.type)&&!t.voided&&Object.prototype.hasOwnProperty.call(t,"positionBefore"))||null}
function renderTransactionTable(){const q=$("transactionSearch")?.value.trim().toUpperCase()||"",type=$("transactionTypeFilter")?.value||"all",latest=latestCorrectableTransaction(),filtered=state.transactions.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).filter(t=>(!q||String(t.symbol).includes(q))&&(type==="all"||t.type===type)),pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));transactionPage=Math.min(transactionPage,pages);const items=filtered.slice((transactionPage-1)*PAGE_SIZE,transactionPage*PAGE_SIZE);$("transactionBody").innerHTML=items.length?items.map(t=>`<tr class="${t.voided?"muted":""}"><td>${escapeHtml(t.date)}</td><td><span class="type-pill">${transactionLabel(t)}</span></td><td><strong>${escapeHtml(t.symbol)}</strong></td><td>${round(t.shares,4)}</td><td>${round(t.price,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fee,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fxRate,6)}</td><td class="${t.voided?"muted":cls(t.realizedPnlUSD)}">${t.type==="sell"?money(t.realizedPnlUSD):"—"}</td><td>${escapeHtml(t.note||"")}</td><td>${isAdminMode&&latest?.id===t.id?`<div class="correction-buttons"><button onclick="correctLastTransaction('${t.id}')">更正</button><button class="danger" onclick="undoLastTransaction('${t.id}')">撤销</button></div>`:"—"}</td></tr>`).join(""):'<tr><td colspan="10" class="muted">暂无交易记录</td></tr>';$("transactionPager").innerHTML=`<button ${transactionPage<=1?"disabled":""} onclick="transactionPage--;renderTransactionTable()">上一页</button><span>${transactionPage} / ${pages} · 共 ${filtered.length} 条</span><button ${transactionPage>=pages?"disabled":""} onclick="transactionPage++;renderTransactionTable()">下一页</button>`}function renderCashFlowTable(){$("cashFlowBody").innerHTML=state.cashFlows.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(x=>`<tr class="${x.voided?"muted":""}"><td>${escapeHtml(x.date)}</td><td>${x.voided?"已作废":x.type==="withdraw"?"提取本金":"追加本金"}</td><td class="${x.voided?"muted":x.type==="withdraw"?"red":"green"}">${x.type==="withdraw"?"-":"+"}${money(x.amountUSD)}</td><td>${escapeHtml(x.note||"")}</td><td>${x.migration||x.voided?"—":`<button class="danger" onclick="deleteCashFlow('${x.id}')">作废</button>`}</td></tr>`).join("")}
function switchLedgerTab(tab){if(!isAdminMode&&["cashflows","backup"].includes(tab))tab="transactions";activeLedgerTab=tab;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));["positions","transactions","cashflows","backup"].forEach(x=>$(x+"Pane").classList.toggle("hidden",x!==tab));if(tab==="backup")renderBackupList()}
function fillTradeFromPosition(p){if(!p)return;$("tradeSymbol").value=p.symbol;$("tradeName").value=p.name;$("tradeCurrency").value=p.currency;$("tradeFx").value=fx(p.currency);$("tradePrice").value=p.price||p.avgCost;$("tradeSource").value=p.source;$("tradeSector").value=p.sector;$("tradeColor").value=p.color;updateTradePreview()}
function openTrade(type,positionId=""){$("tradeType").value=type;$("tradeTitle").textContent=type==="buy"?"记录买入":"记录卖出";$("tradeDate").value=today();$("tradeSymbol").value="";$("tradeShares").value="";$("tradePrice").value="";$("tradeFee").value="0";$("tradeCurrency").value="USD";$("tradeFx").value="1";$("tradeName").value="";$("tradeSector").value="未分类";$("tradeColor").value="#38bdf8";$("tradeSource").value="twelve";$("tradeNote").value="";const existing=state.positions.find(p=>p.id===positionId);if(existing)fillTradeFromPosition(existing);["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(id=>$(id).classList.toggle("hidden",type==="sell"));updateTradePreview();$("tradeDialog").showModal();setTimeout(()=>$("tradeSymbol").focus(),30)}
function syncTradeSymbol(){const symbol=$("tradeSymbol").value.trim().toUpperCase(),p=state.positions.find(x=>x.symbol===symbol);if(p)fillTradeFromPosition(p);else{const sector=inferSector(symbol,$("tradeName").value,$("tradeSector").value);$("tradeSector").value=sector;$("tradeColor").value=colorForSectorMember(sector,state.positions.filter(x=>x.sector===sector).length);$("tradeFx").value=fx($("tradeCurrency").value)}updateTradePreview()}
function updateTradePreview(){const type=$("tradeType").value,qty=num($("tradeShares").value),price=num($("tradePrice").value),rate=num($("tradeFx").value),fee=num($("tradeFee").value),value=(qty*price+fee)*rate,symbol=$("tradeSymbol").value.trim().toUpperCase(),p=state.positions.find(x=>x.symbol===symbol);let text=`预计${type==="buy"?"占用":"收入"} ${money(type==="buy"?value:Math.max(0,(qty*price-fee)*rate))}`;if(type==="sell"&&p&&qty>0){const basis=num(p.costBasisUSD)/p.shares*qty,realized=(qty*price-fee)*rate-basis;text+=`，预计已实现盈亏 ${money(realized)}`}$("tradePreview").textContent=text}
function submitTrade(event){
  event.preventDefault();const type=$("tradeType").value,symbol=$("tradeSymbol").value.trim().toUpperCase(),date=$("tradeDate").value,shares=num($("tradeShares").value),price=num($("tradePrice").value),currency=$("tradeCurrency").value,rate=num($("tradeFx").value),fee=num($("tradeFee").value),note=$("tradeNote").value.trim();if(!symbol||!date||shares<=0||price<0||rate<=0||fee<0){alert("请检查交易信息");return}
  let p=state.positions.find(x=>x.symbol===symbol);if(type==="sell"&&(!p||shares>p.shares+1e-9)){alert("卖出数量超过当前持仓");return}if(type==="buy"&&p&&p.currency!==currency){alert("同一资产请使用相同币种；如需更正请先编辑资产资料");return}
  const positionBefore=p?structuredClone(p):null;
  createBackup(`${symbol} ${type==="buy"?"买入":"卖出"}前`);
  if(type==="buy"){
    const nativeCost=shares*price+fee,usdCost=nativeCost*rate;
    if(!p){p=normalizePosition({id:uid("pos"),symbol,name:$("tradeName").value.trim(),currency,source:$("tradeSource").value,shares,avgCost:nativeCost/shares,price,sector:$("tradeSector").value.trim()||"未分类",color:$("tradeColor").value,note:"",costBasisUSD:usdCost});state.positions.push(p)}
    else{const oldNative=p.avgCost*p.shares;p.avgCost=(oldNative+nativeCost)/(p.shares+shares);p.shares+=shares;p.costBasisUSD+=usdCost;p.price=price}
    state.transactions.push({id:uid("tx"),date,type,symbol,name:p.name,shares,price,currency,fxRate:rate,fee,feeUSD:fee*rate,costBasisUSD:usdCost,grossUSD:shares*price*rate,realizedPnlUSD:0,note,positionBefore,schemaVersion:"10"});
  }else{
    const basisPerShare=p.costBasisUSD/p.shares,basis=basisPerShare*shares,gross=shares*price*rate,feeUSD=fee*rate,realized=gross-feeUSD-basis;
    state.transactions.push({id:uid("tx"),date,type,symbol,name:p.name,shares,price,currency:p.currency,fxRate:rate,fee,feeUSD,costBasisUSD:basis,grossUSD:gross,realizedPnlUSD:realized,note,positionBefore,schemaVersion:"10"});p.shares=round(p.shares-shares,8);p.costBasisUSD=Math.max(0,p.costBasisUSD-basis);p.price=price;if(p.shares<=1e-8)state.positions=state.positions.filter(x=>x.id!==p.id);
  }
  captureSnapshot(false);markDirty(`${symbol} ${type==="buy"?"买入":"卖出"}交易已记录`);$("tradeDialog").close();renderAll();switchLedgerTab(type==="sell"?"transactions":"positions");
}
function restorePositionBefore(transaction){state.positions=state.positions.filter(p=>p.symbol!==transaction.symbol);if(transaction.positionBefore)state.positions.push(normalizePosition(structuredClone(transaction.positionBefore)));transaction.voided=true;transaction.voidedAt=new Date().toISOString()}
function undoLastTransaction(id){const t=latestCorrectableTransaction();if(!t||t.id!==id){alert("只能撤销最新一笔尚未撤销的 V9.1 及以后交易");return}if(!confirm(`确认撤销最新交易？\n${transactionLabel(t)} ${t.symbol} ${t.shares} 股 @ ${t.price} ${t.currency}\n\n原记录会标记为“已撤销”，不会从流水中删除。`))return;createBackup(`${t.symbol} 交易撤销前`);restorePositionBefore(t);captureSnapshot(false);markDirty(`${t.symbol} 最新交易已撤销`);renderAll();switchLedgerTab("transactions")}
function correctLastTransaction(id){const t=latestCorrectableTransaction();if(!t||t.id!==id){alert("只能更正最新一笔尚未撤销的 V9.1 及以后交易");return}if(!confirm(`更正 ${t.symbol} 最新交易？\n系统会先撤销原记录，再打开交易窗口重新填写。`))return;const old=structuredClone(t);createBackup(`${t.symbol} 交易更正前`);restorePositionBefore(t);captureSnapshot(false);markDirty(`${t.symbol} 原交易已撤销，等待重新录入`);renderAll();const restored=state.positions.find(p=>p.symbol===old.symbol);openTrade(old.type,restored?.id||"");$("tradeSymbol").value=old.symbol;$("tradeDate").value=old.date;$("tradeShares").value=old.shares;$("tradePrice").value=old.price;$("tradeCurrency").value=old.currency;$("tradeFx").value=old.fxRate;$("tradeFee").value=old.fee||0;$("tradeName").value=old.name||"";$("tradeNote").value=(old.note?old.note+"；":"")+"更正重录";updateTradePreview()}
function editPosition(id){const p=state.positions.find(x=>x.id===id);if(!p)return;const name=prompt("资产名称",p.name);if(name===null)return;const sector=prompt("所属板块",p.sector);if(sector===null)return;const source=prompt("数据源：twelve 或 manual",p.source);if(source===null)return;if(!["twelve","manual"].includes(source)){alert("数据源只能是 twelve 或 manual");return}createBackup(`${p.symbol} 资料编辑前`);p.name=name.trim();p.sector=sector.trim()||"未分类";p.source=source;if(source==="manual"){const price=prompt(`手动最新价（${p.currency}）`,p.price);if(price!==null&&num(price)>=0)p.price=num(price)}markDirty(`${p.symbol} 资产资料已编辑`);renderAll()}
function openCashFlow(){$("cashDate").value=today();$("cashAmount").value="";$("cashNote").value="";$("cashDialog").showModal()}
function submitCashFlow(event){event.preventDefault();const type=$("cashType").value,date=$("cashDate").value,amountUSD=num($("cashAmount").value),note=$("cashNote").value.trim();if(!date||amountUSD<=0){alert("请填写正确金额");return}createBackup("本金变动前");state.cashFlows.push({id:uid("cash"),date,type,amountUSD,note});captureSnapshot(false);markDirty("本金变动已记录");$("cashDialog").close();renderAll();switchLedgerTab("cashflows")}
function deleteCashFlow(id){const item=state.cashFlows.find(x=>x.id===id);if(!item||item.voided)return;if(!confirm("确认作废这条本金变动记录？原记录会保留在流水中。"))return;createBackup("作废资金流水前");item.voided=true;item.voidedAt=new Date().toISOString();captureSnapshot(false);markDirty("一条资金流水已作废");renderAll()}

function downloadJson(){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a"),url=URL.createObjectURL(blob);a.href=url;a.download="data-v10.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function importJson(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const incoming=JSON.parse(reader.result);createBackup("导入数据前");normalizeState(incoming);captureSnapshot(false);markDirty("已导入外部数据，等待安全核对");renderAll();alert("导入成功。保存前系统会与 GitHub 云端数据进行安全核对。") }catch(error){alert("JSON 格式或数据结构不正确："+error.message)}finally{event.target.value=""}};reader.readAsText(file)}

function transactionMetaMap(transactions=state.transactions){
  const map={};
  state.positions.forEach(p=>{map[p.symbol]={id:p.id,name:p.name,sector:p.sector,color:p.color,source:p.source,currency:p.currency,price:p.price,changePercent:p.changePercent,note:p.note}});
  transactions.forEach(t=>{const symbol=String(t.symbol||"").toUpperCase();if(!symbol)return;const sector=inferSector(symbol,t.name,t.sector||map[symbol]?.sector);map[symbol]={...(map[symbol]||{}),name:t.name||map[symbol]?.name||"",sector,color:validColor(t.color||map[symbol]?.color||sectorBaseColor(sector)),source:t.source==="manual"?"manual":map[symbol]?.source||"twelve",currency:String(t.currency||map[symbol]?.currency||"USD").toUpperCase()}});
  return map;
}
function rebuildCurrentPositionsFromTransactions(transactions=state.transactions){
  const meta=transactionMetaMap(transactions),positions=[],bySymbol={};
  state.transactions=transactions.map((original,index)=>{
    const t={...original,_order:index};
    if(t.voided)return t;
    const type=t.type==="sell"?"sell":"buy",symbol=String(t.symbol||"").trim().toUpperCase(),shares=num(t.shares),price=num(t.price),currency=String(t.currency||meta[symbol]?.currency||"USD").toUpperCase(),rate=num(t.fxRate)||fx(currency),fee=num(t.fee);
    if(!symbol||shares<=0||price<0||rate<=0||fee<0)throw new Error(`第 ${index+1} 条交易数据不完整`);
    const m=meta[symbol]||{},nativeValue=shares*price,feeUSD=fee*rate;
    if(type==="buy"){
      let p=bySymbol[symbol];
      const nativeCost=nativeValue+fee,usdCost=nativeCost*rate;
      if(!p){
        p=normalizePosition({id:m.id||uid("pos"),symbol,name:t.name||m.name||symbol,currency,source:t.source||m.source||"twelve",shares:0,avgCost:0,price:m.price||price,sector:t.sector||m.sector||"未分类",color:validColor(t.color||m.color),note:m.note||"",costBasisUSD:0,changePercent:m.changePercent||0});
        bySymbol[symbol]=p;positions.push(p);
      }
      if(p.currency!==currency)throw new Error(`${symbol} 存在不同币种交易，无法自动重算`);
      const oldNative=p.avgCost*p.shares;
      p.avgCost=(oldNative+nativeCost)/(p.shares+shares);
      p.shares=round(p.shares+shares,8);
      p.costBasisUSD=round(num(p.costBasisUSD)+usdCost,6);
      p.name=t.name||p.name;p.sector=t.sector||p.sector;p.color=validColor(t.color||p.color);p.source=t.source||p.source;p.price=num(m.price)||p.price||price;
      return {...t,type:original.type==="opening"?"opening":"buy",symbol,name:p.name,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:usdCost,grossUSD:nativeValue*rate,realizedPnlUSD:0,sector:p.sector,color:p.color,source:p.source,schemaVersion:"10.5"};
    }
    const p=bySymbol[symbol];
    if(!p)return {...t,type:"sell",symbol,name:t.name||m.name||symbol,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:num(t.costBasisUSD),grossUSD:nativeValue*rate,realizedPnlUSD:Number.isFinite(Number(t.realizedPnlUSD))?num(t.realizedPnlUSD):nativeValue*rate-feeUSD-num(t.costBasisUSD),sector:t.sector||m.sector,color:validColor(t.color||m.color),source:t.source||m.source||"twelve",schemaVersion:"10.5",closedHistory:true};
    if(p.shares+1e-9<shares)throw new Error(`${symbol} 卖出数量超过此前持仓，请先检查这笔交易前的买入记录`);
    const basis=p.costBasisUSD/p.shares*shares,grossUSD=nativeValue*rate,realized=grossUSD-feeUSD-basis;
    p.shares=round(p.shares-shares,8);p.costBasisUSD=round(Math.max(0,p.costBasisUSD-basis),6);p.price=num(m.price)||price;
    if(p.shares<=1e-8){delete bySymbol[symbol];const idx=positions.findIndex(x=>x.symbol===symbol);if(idx>=0)positions.splice(idx,1)}
    return {...t,type:"sell",symbol,name:t.name||m.name||symbol,shares,price,currency,fxRate:rate,fee,feeUSD,costBasisUSD:basis,grossUSD,realizedPnlUSD:realized,sector:t.sector||m.sector,color:validColor(t.color||m.color),source:t.source||m.source||"twelve",schemaVersion:"10.5"};
  }).map(({_order,...t})=>t);
  state.positions=positions.map(normalizePosition).filter(p=>p.symbol&&p.shares>0);applyAutoTaxonomy(true);
}
function tradeFormDraft(existing={}){
  const type=$("tradeType").value,symbol=$("tradeSymbol").value.trim().toUpperCase(),date=$("tradeDate").value,shares=num($("tradeShares").value),price=num($("tradePrice").value),currency=$("tradeCurrency").value,rate=num($("tradeFx").value),fee=num($("tradeFee").value),note=$("tradeNote").value.trim();
  if(!symbol||!date||shares<=0||price<0||rate<=0||fee<0)throw new Error("请检查交易信息");
  const sector=inferSector(symbol,$("tradeName").value.trim()||existing.name,$("tradeSector").value.trim());
  return {...existing,id:existing.id||uid("tx"),date,type:type==="opening"?"opening":type,symbol,name:$("tradeName").value.trim()||existing.name||symbol,shares,price,currency,fxRate:rate,fee,note,source:$("tradeSource").value,sector,color:validColor($("tradeColor").value||colorForSectorMember(sector,state.positions.filter(p=>p.sector===sector).length)),schemaVersion:"10.5"};
}
function commitTransactionChange(nextTransactions,reason){
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
  $("tradeEditId").value="";$("tradeType").value=type;$("tradeTitle").textContent=type==="buy"?"记录买入":"记录卖出";$("tradeDate").value=today();$("tradeSymbol").value="";$("tradeShares").value="";$("tradePrice").value="";$("tradeFee").value="0";$("tradeCurrency").value="USD";$("tradeFx").value="1";$("tradeName").value="";$("tradeSector").value="未分类";$("tradeColor").value="#38bdf8";$("tradeSource").value="twelve";$("tradeNote").value="";const existing=state.positions.find(p=>p.id===positionId);if(existing)fillTradeFromPosition(existing);["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(id=>$(id).classList.toggle("hidden",type==="sell"));updateTradePreview();$("tradeDialog").showModal();setTimeout(()=>$("tradeSymbol").focus(),30)
}
function openTradeEdit(id){
  const t=state.transactions.find(x=>x.id===id);if(!t||t.voided)return;
  const m=transactionMetaMap()[t.symbol]||{};
  $("tradeEditId").value=t.id;$("tradeType").value=t.type==="opening"?"opening":t.type;$("tradeTitle").textContent=`编辑交易：${t.symbol}`;$("tradeDate").value=t.date||today();$("tradeSymbol").value=t.symbol||"";$("tradeShares").value=t.shares||"";$("tradePrice").value=t.price||"";$("tradeFee").value=t.fee||0;$("tradeCurrency").value=t.currency||m.currency||"USD";$("tradeFx").value=t.fxRate||fx(t.currency);$("tradeName").value=t.name||m.name||"";$("tradeSector").value=t.sector||m.sector||"未分类";$("tradeColor").value=validColor(t.color||m.color);$("tradeSource").value=t.source||m.source||"twelve";$("tradeNote").value=t.note||"";["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(id=>$(id).classList.remove("hidden"));updateTradePreview();$("tradeDialog").showModal();
}
function submitTrade(event){
  event.preventDefault();
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
  const t=state.transactions.find(x=>x.id===id);if(!t)return;
  if(!confirm(`删除这条交易记录？\n${transactionLabel(t)} ${t.symbol} ${t.shares} 股 @ ${t.price} ${t.currency}\n\n系统会用剩余流水重新计算当前持仓。`))return;
  commitTransactionChange(state.transactions.filter(x=>x.id!==id),`${t.symbol} 交易已删除`);
}
function renderTransactionTable(){const q=$("transactionSearch")?.value.trim().toUpperCase()||"",type=$("transactionTypeFilter")?.value||"all",filtered=state.transactions.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).filter(t=>(!q||String(t.symbol).includes(q))&&(type==="all"||t.type===type)),pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));transactionPage=Math.min(transactionPage,pages);const items=filtered.slice((transactionPage-1)*PAGE_SIZE,transactionPage*PAGE_SIZE);$("transactionBody").innerHTML=items.length?items.map(t=>`<tr class="${t.voided?"muted":""}"><td>${escapeHtml(t.date)}</td><td><span class="type-pill">${transactionLabel(t)}</span></td><td><strong>${escapeHtml(t.symbol)}</strong></td><td>${round(t.shares,4)}</td><td>${round(t.price,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fee,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fxRate,6)}</td><td class="${t.voided?"muted":cls(t.realizedPnlUSD)}">${t.type==="sell"?money(t.realizedPnlUSD):"—"}</td><td>${escapeHtml(t.note||"")}</td><td>${isAdminMode&&!t.voided?`<div class="correction-buttons"><button onclick="openTradeEdit('${t.id}')">编辑</button><button class="danger" onclick="deleteTransaction('${t.id}')">删除</button></div>`:"—"}</td></tr>`).join(""):'<tr><td colspan="10" class="muted">暂无交易记录</td></tr>';$("transactionPager").innerHTML=`<button ${transactionPage<=1?"disabled":""} onclick="transactionPage--;renderTransactionTable()">上一页</button><span>${transactionPage} / ${pages} · 共 ${filtered.length} 条</span><button ${transactionPage>=pages?"disabled":""} onclick="transactionPage++;renderTransactionTable()">下一页</button>`}
function editPosition(id){
  const p=state.positions.find(x=>x.id===id);if(!p)return;$("positionEditId").value=p.id;$("positionEditTitle").textContent=`编辑资产：${p.symbol}`;$("positionEditName").value=p.name||"";$("positionEditSector").value=p.sector||"未分类";$("positionEditSource").value=p.source||"twelve";$("positionEditPrice").value=p.price||0;$("positionEditColor").value=validColor(p.color);$("positionDialog").showModal()
}
function setPositionEditColor(color){$("positionEditColor").value=validColor(color)}
function submitPositionEdit(event){
  event.preventDefault();const id=$("positionEditId").value,p=state.positions.find(x=>x.id===id);if(!p)return;const color=validColor($("positionEditColor").value),source=$("positionEditSource").value;if(!["twelve","manual"].includes(source)){alert("数据源只能是 Twelve 或 Manual");return}
  createBackup(`${p.symbol} 资料编辑前`);
  p.name=$("positionEditName").value.trim()||p.symbol;p.sector=$("positionEditSector").value.trim()||"未分类";p.source=source;p.color=color;if(source==="manual"&&num($("positionEditPrice").value)>=0)p.price=num($("positionEditPrice").value);
  state.transactions.forEach(t=>{if(t.symbol===p.symbol){t.name=p.name;t.sector=p.sector;t.source=p.source;t.color=p.color}});
  markDirty(`${p.symbol} 资产资料与颜色已编辑`);$("positionDialog").close();renderAll()
}
function renderSectorsV2(){const bar=$("sectorBar"),legend=$("sectorLegend"),total=Math.max(contributedCapital()+realizedPnl(),1);bar.innerHTML="";legend.innerHTML="";sectorItems().forEach(s=>{const pct=round(s.total/total*100),seg=document.createElement("div");seg.className="segment"+(pct>=14?" major":"");seg.style.width=Math.max(4,pct)+"%";seg.style.background=`linear-gradient(90deg, ${mixColor(s.color,"#ffffff",.14)}, ${mixColor(s.color,"#000000",.12)})`;seg.title=`${s.label} ${pct}%`;seg.textContent=pct>=14?`${s.label} ${pct}%`:"";bar.appendChild(seg);legend.insertAdjacentHTML("beforeend",`<span><i class="dot" style="background:${validColor(s.color)}"></i>${escapeHtml(s.label)} ${money(s.total)} <b class="${cls(s.pnl)}">${money(s.pnl)}</b></span>`)})}
function renderChartV2(){const svg=$("assetChart"),data=state.snapshots.slice(-120);if(data.length<2){svg.classList.add("hidden");$("chartEmpty").classList.remove("hidden");return}svg.classList.remove("hidden");$("chartEmpty").classList.add("hidden");const mobile=svg.clientWidth&&svg.clientWidth<700,W=mobile?430:1200,H=mobile?300:260,pad=mobile?{l:92,r:22,t:28,b:42}:{l:82,r:24,t:24,b:34},values=data.flatMap(x=>[num(x.netAsset),num(x.capital)]),min=Math.min(...values),max=Math.max(...values),range=Math.max(max-min,1),x=i=>pad.l+i*(W-pad.l-pad.r)/Math.max(data.length-1,1),y=v=>pad.t+(max-v)*(H-pad.t-pad.b)/range,path=key=>data.map((d,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(num(d[key])).toFixed(1)).join(" "),area=`${path("netAsset")} L ${x(data.length-1)} ${H-pad.b} L ${x(0)} ${H-pad.b} Z`;let grid="";for(let i=0;i<4;i++){const val=max-range*i/3,yy=y(val);grid+=`<line class="chart-grid" x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/><text class="chart-label" x="${mobile?4:8}" y="${yy+5}">${money(val)}</text>`}svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.innerHTML=`<defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4f9a" stop-opacity=".25"/><stop offset="1" stop-color="#ff4f9a" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-capital" d="${path("capital")}"/><path class="chart-asset" d="${path("netAsset")}"/><circle class="chart-dot" cx="${x(data.length-1)}" cy="${y(data.at(-1).netAsset)}" r="${mobile?6:5}"/><text class="chart-line-label" text-anchor="end" x="${W-pad.r}" y="${Math.max(18,y(data.at(-1).netAsset)-10)}">${money(data.at(-1).netAsset)}</text><text class="chart-label" x="${pad.l}" y="${H-8}">${escapeHtml(data[0].date)}</text><text class="chart-label" text-anchor="end" x="${W-pad.r}" y="${H-8}">${escapeHtml(data.at(-1).date)}</text>`}
function renderHoldingCardsV2(){const box=$("holdingCards");if(!state.positions.length){box.innerHTML='<div class="empty">暂无当前持仓</div>';return}const total=Math.max(contributedCapital()+realizedPnl(),1);box.innerHTML=state.positions.slice().sort((a,b)=>num(b.costBasisUSD)-num(a.costBasisUSD)).map(p=>{const pnl=floatingPnlUSD(p),ret=round(p.costBasisUSD?pnl/p.costBasisUSD*100:0),weight=round(p.costBasisUSD/total*100),change=round(p.changePercent||0);return`<div class="holding-card"><div class="holding-main"><div><div class="symbol">${escapeHtml(p.symbol)}</div><div class="name">${escapeHtml(p.name)||escapeHtml(p.sector)}</div></div><div class="holding-value"><strong>${money(marketUSD(p))}</strong><span class="${cls(pnl)}">${money(pnl)} / ${ret}%</span></div></div><div class="holding-meta"><span>${escapeHtml(p.sector)}</span><span class="${cls(change)}">${change?`${change}%`:"--"}</span></div><div class="holding-progress"><i style="width:${Math.min(100,Math.max(2,weight))}%;background:${validColor(p.color)}"></i></div><div class="grid compact"><div><div class="label">成本仓位</div><div class="value">${weight}%</div></div><div><div class="label">数量</div><div class="value">${round(p.shares,4)}</div></div><div><div class="label">最新价</div><div class="value">${round(p.price,4)} ${escapeHtml(p.currency)}</div></div><div><div class="label">投入成本</div><div class="value">${money(p.costBasisUSD)}</div></div></div></div>`}).join("")}
function renderAll(){renderKpis();renderTreemap();renderSectorsV2();renderChartV2();renderHoldingCardsV2();renderPositionTable();renderTransactionTable();renderCashFlowTable();renderBackupList();$("positionCount").textContent=state.positions.length;$("transactionCount").textContent=state.transactions.length;$("cashFlowCount").textContent=state.cashFlows.length;$("pageTitle").textContent=state.settings.title;document.title=state.settings.title;$("titleInput").value=state.settings.title;$("cacheInput").value=state.settings.priceCacheMinutes;if($("proxyInput"))$("proxyInput").value=priceProxyUrl();$("apiKeyInput").value=marketKey();renderSyncStatus();renderDiagnostics()}
function initAdminMode(){isAdminMode=new URLSearchParams(location.search).get("admin")==="1";document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdminMode));document.body.classList.toggle("viewer-mode",!isAdminMode)}
function canAutoRefreshPrices(){return navigator.onLine&&document.visibilityState!=="hidden"&&!!priceProxyUrl()}
function kickAutoRefresh(force=false){
  if(!isAdminMode||!canAutoRefreshPrices())return;
  const now=Date.now();
  if(!force&&now-lastAutoRefreshKick<RESUME_REFRESH_GAP_MS)return;
  if(!force&&priceCacheValid()){applyPriceCache();renderAll();return}
  lastAutoRefreshKick=now;
  refreshPrices(true);
}
function initAutoRefreshHooks(){
  if(autoRefreshTimer)clearInterval(autoRefreshTimer);
  if(sharedDataTimer)clearInterval(sharedDataTimer);
  sharedDataTimer=setInterval(()=>checkSharedDataUpdate(false),SHARED_DATA_CHECK_MS);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkSharedDataUpdate(true)});
  window.addEventListener("focus",()=>checkSharedDataUpdate(true));
  window.addEventListener("pageshow",()=>checkSharedDataUpdate(false));
}
window.addEventListener("resize",()=>{renderTreemap();renderChartV2()});
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue=""}});
window.addEventListener("online",()=>{updateNetworkStatus();checkSharedDataUpdate(true)});
window.addEventListener("offline",updateNetworkStatus);
window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstallPrompt=event;updateInstallButton()});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;$("installDialog")?.close();updateInstallButton()});
document.addEventListener("DOMContentLoaded",()=>{
  initAdminMode();fillAdmin();normalizeState(defaultState);renderAll();updateNetworkStatus();updateInstallButton();registerPwa();
  initAutoRefreshHooks();
  ["tradeShares","tradePrice","tradeFx","tradeFee"].forEach(id=>$(id).addEventListener("input",updateTradePreview));$("tradeSymbol").addEventListener("change",syncTradeSymbol);$("tradeCurrency").addEventListener("change",()=>{$("tradeFx").value=fx($("tradeCurrency").value);updateTradePreview()});
  loadSharedData(true);
});




