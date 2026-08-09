const VERSION="V11.5.0 稳定性修正版";
const RELEASE="11.5.0";
const LEDGER_SCHEMA_VERSION="10.33";
const STATE_KEY="v9_last_state";
const RETURN_SNAPSHOT_KEY="v10_return_snapshots";
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
const SHARED_DATA_CHECK_MS=5*60000;
const US_MARKET_TZ="America/New_York";
const US_MARKET_OPEN_MIN=9*60+30;
const US_MARKET_CLOSE_MIN=16*60;
const US_EARLY_CLOSE_MIN=13*60;
const US_STATIC_HOLIDAYS={"2026-01-01":"元旦","2026-01-19":"马丁路德金纪念日","2026-02-16":"总统日","2026-04-03":"耶稣受难日","2026-05-25":"阵亡将士纪念日","2026-06-19":"六月节","2026-07-03":"独立日观察休市","2026-09-07":"劳动节","2026-11-26":"感恩节","2026-12-25":"圣诞节"};
const US_STATIC_EARLY_CLOSES={"2026-11-27":"感恩节后提前收盘","2026-12-24":"圣诞夜提前收盘"};
Object.assign(US_STATIC_HOLIDAYS,{"2027-01-01":"元旦","2027-01-18":"马丁路德金纪念日","2027-02-15":"总统日","2027-03-26":"耶稣受难日","2027-05-31":"阵亡将士纪念日","2027-06-18":"六月节观察休市","2027-07-05":"独立日观察休市","2027-09-06":"劳动节","2027-11-25":"感恩节","2027-12-24":"圣诞节观察休市","2028-01-17":"马丁路德金纪念日","2028-02-21":"总统日","2028-04-14":"耶稣受难日","2028-05-29":"阵亡将士纪念日","2028-06-19":"六月节","2028-07-04":"独立日","2028-09-04":"劳动节","2028-11-23":"感恩节","2028-12-25":"圣诞节"});
const TAXONOMY_VERSION="sector-color-v10";
const ADMIN_PASSWORD_HASH="e9cf0653c1f1de4720a1984d6b8f1f7caef8207edf46a7d7fdc4950522df12f1";
const ADMIN_AUTH_KEY="myh88_admin_auth_v1046";
const ADMIN_AUTH_TTL_MS=12*60*60*1000;

const defaultState={settings:{title:"孟一晗的梦想金库",priceCacheMinutes:30,lastPriceRefresh:0,lastPriceRefreshText:"",schemaVersion:LEDGER_SCHEMA_VERSION},fxRates:{USD:1,EUR:1.16,HKD:.128,JPY:.0067,GBP:1.27},positions:[],transactions:[],cashFlows:[],snapshots:[]};
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
let adminAccessRequested=false;
let priceRefreshPromise=null;
let autoRefreshTimer=null;
let sharedDataTimer=null;
let lastAutoRefreshKick=0;
let lastSharedRaw="";
let lastMarketRoute="pending";
let lastMarketProvider="";
let lastMarketError="";
let marketClockState=null;
let workerHealth=null;
let lastQuoteCache="";
let lastQuoteWarnings="";
let tradeSectorAuto=true;
let tradeColorAuto=true;
let buildMeta={release:RELEASE,version:VERSION,serviceWorker:RELEASE,worker:"10.54"};
let serviceWorkerVersion="";

const SECTOR_RULES=[
  {label:"AI基建",color:"#22d38a",symbols:["NVDA","VRT"],keywords:["英伟达","维谛","ai基建","ai基础设施","算力","数据中心","电力"]},
  {label:"半导体",color:"#ff8a3d",symbols:["MU","DRAM","XFAB","AVGO","AMD","TSM","ASML","ARM","QCOM","AMAT","LRCX"],keywords:["半导体","芯片","晶圆","设备","美光","存储","内存","dram","hbm"]},
  {label:"光通信",color:"#18c9d7",symbols:["MRVL","AAOI","LITE"],keywords:["光通信","光通讯","光模块","光电","光芯片","迈威尔","应用光电","lumentum","鲁门特姆","朗美通"]},
  {label:"太空",color:"#ef476f",symbols:["RKLB","SPCX"],keywords:["太空","航天","火箭","rocket","space","spacex"]},
  {label:"科技平台",color:"#8b5cf6",symbols:["GOOGL","GOOG","META","MSFT","AMZN","AAPL","PLTR","CRM","ORCL","IBM","TSLA","RIVN","LCID","NIO","XPEV","LI"],keywords:["谷歌","平台","云","搜索","广告","软件","特斯拉","智能汽车","电动车","新能源车","自动驾驶"]},
  {label:"医疗",color:"#f472b6",symbols:["UNH","LLY","NVO","MRK","PFE","JNJ","TMO","ISRG"],keywords:["医疗","医药","制药","生物","器械"]},
  {label:"现金",color:"#f9d95c",symbols:["CASH"],keywords:["现金","cash"]},
  {label:"未分类",color:"#64748b",symbols:[],keywords:["未分类"]}
];
const SECTOR_ALIAS={"光通讯":"光通信","通信光":"光通信","AI":"AI基建","人工智能":"AI基建","算力":"AI基建","航天":"太空","宇宙":"太空","智能汽车":"科技平台","AI存储":"半导体","AI存儲":"半导体","现金":"现金","CASH":"现金"};

function $(id){return document.getElementById(id)}
function readJson(text,fallback){try{return JSON.parse(text)||fallback}catch{return fallback}}
function uid(prefix="id"){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}
function dateInTimeZone(timeZone="Asia/Shanghai"){const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`}
function today(){return dateInTimeZone()}
function num(v){return Number(v)||0}
function round(v,d=2){const p=10**d;return Math.round((num(v)+Number.EPSILON)*p)/p}
function money(v){const n=num(v),sign=n<0?"-":"";return sign+"$"+new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(Math.abs(n))}
function cls(v){return num(v)>0?"red":num(v)<0?"green":"muted"}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function formatDuration(ms){const mins=Math.max(0,Math.ceil(ms/60000)),h=Math.floor(mins/60),m=mins%60;return h?`${h}小时${m}分`:`${m}分`}
function nyParts(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:US_MARKET_TZ,weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  if(parts.hour==="24")parts.hour="00";
  return{weekday:parts.weekday,year:num(parts.year),month:num(parts.month),day:num(parts.day),date:`${parts.year}-${parts.month}-${parts.day}`,hour:num(parts.hour),minute:num(parts.minute)};
}
function nextBusinessDayLabel(parts){
  const order=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],zh=["周日","周一","周二","周三","周四","周五","周六"],idx=order.indexOf(parts.weekday);
  const add=idx===5?3:idx===6?2:1;
  return zh[(idx+add)%7];
}
function marketClock(now=new Date()){
  const p=nyParts(now),weekend=p.weekday==="Sat"||p.weekday==="Sun",mins=p.hour*60+p.minute;
  const holiday=US_STATIC_HOLIDAYS[p.date]||"",earlyClose=US_STATIC_EARLY_CLOSES[p.date]||"",closeMin=earlyClose?US_EARLY_CLOSE_MIN:US_MARKET_CLOSE_MIN;
  if(holiday)return{phase:"holiday",isOpen:false,label:`美股休市 · ${holiday}`,detail:"休市日优先使用缓存",source:"local",date:p.date,holiday,earlyClose:""};
  if(weekend)return{phase:"weekend",isOpen:false,label:`美股周末休市 · 下次开盘 ${nextBusinessDayLabel(p)} 09:30 ET`,detail:"休市日优先使用缓存",source:"local",date:p.date,holiday:"",earlyClose:""};
  if(mins>=US_MARKET_OPEN_MIN&&mins<closeMin){
    const closeMs=(closeMin-mins)*60000;
    return{phase:"open",isOpen:true,label:`美股盘中 · 距离收盘约 ${formatDuration(closeMs)}`,detail:"盘中自动刷新",source:"local",date:p.date,holiday:"",earlyClose};
  }
  if(!weekend&&mins<US_MARKET_OPEN_MIN){
    const openMs=(US_MARKET_OPEN_MIN-mins)*60000;
    return{phase:"pre",isOpen:false,label:`美股未开盘 · 距离开盘约 ${formatDuration(openMs)}`,detail:"开盘前优先使用缓存",source:"local",date:p.date,holiday:"",earlyClose};
  }
  return{phase:"closed",isOpen:false,label:`美股已收盘 · 下次开盘 ${nextBusinessDayLabel(p)} 09:30 ET`,detail:earlyClose?`今日${earlyClose}`:"收盘后优先使用缓存",source:"local",date:p.date,holiday:"",earlyClose};
}
function marketClockDisplay(clock=marketClock()){
  if(clock.label)return clock.label;
  const source=clock.source==="finnhub"?"实时市场状态":"本地休市表";
  if(clock.isOpen)return`美股盘中 · ${source}`;
  if(clock.holiday)return`美股休市 · ${clock.holiday}`;
  if(clock.earlyClose)return`美股非盘中 · ${clock.earlyClose}`;
  return marketClock().label;
}
function isUsMarketOpen(){return Boolean((marketClockState||marketClock()).isOpen||(marketClockState||marketClock()).phase==="open")}
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
    mixColor(base,"#000000",.02),
    mixColor(base,"#ffffff",.14),
    mixColor(base,"#000000",.13),
    mixColor(base,"#ffffff",.24),
    mixColor(base,"#07101f",.10),
    mixColor(base,"#ffffff",.08)
  ];
  return variants[index%variants.length];
}
function autoColorForPosition(p){return colorForSectorMember(p.sector,sectorPeerIndex(p.symbol,p.sector))}
function applyAutoTaxonomy(force=false,options={}){
  const ignoreLocks=options.ignoreLocks===true,recolorOnly=options.recolorOnly===true;
  if(!recolorOnly)state.positions.forEach(p=>{if(ignoreLocks||!p.sectorLocked)p.sector=inferSector(p.symbol,p.name,force?"":p.sector)});
  state.positions.forEach(p=>{if((ignoreLocks||!p.colorLocked)&&(force||!p.color||p.color==="#888888"))p.color=autoColorForPosition(p)});
  if(Array.isArray(state.transactions)){
    const bySymbol=new Map(state.positions.map(p=>[p.symbol,p]));
    state.transactions.forEach(t=>{const p=bySymbol.get(String(t.symbol||"").toUpperCase());if(!p)return;if(ignoreLocks||!p.sectorLocked)t.sector=p.sector;if(ignoreLocks||!p.colorLocked)t.color=p.color});
  }
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
async function queryServiceWorkerVersion(){
  const worker=navigator.serviceWorker?.controller||swRegistration?.active;
  if(!worker)return"";
  return new Promise(resolve=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>resolve(""),1500);
    channel.port1.onmessage=event=>{clearTimeout(timer);resolve(String(event.data?.release||""))};
    worker.postMessage({type:"GET_VERSION"},[channel.port2]);
  });
}
async function refreshDeploymentFingerprint(){
  try{
    const response=await fetch(`build-meta.json?t=${Date.now()}`,{cache:"no-store"});
    if(response.ok)buildMeta={...buildMeta,...await response.json()};
  }catch(error){console.warn("构建信息读取失败",error)}
  try{serviceWorkerVersion=await queryServiceWorkerVersion()}catch{}
  renderDiagnostics();
}
async function registerPwa(){
  if(!("serviceWorker" in navigator)||!window.isSecureContext)return;
  try{
    swRegistration=await navigator.serviceWorker.register("./service-worker.js");
    if(swRegistration.waiting){showUpdateBanner();if(!isAdminMode&&!dirty)applyAppUpdate()}
    swRegistration.addEventListener("updatefound",()=>{const worker=swRegistration.installing;if(!worker)return;worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller){showUpdateBanner();if(!isAdminMode&&!dirty)applyAppUpdate()}})});
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(updateReloading)return;updateReloading=true;location.reload()});
    await refreshDeploymentFingerprint();
  }catch(error){console.warn("PWA 注册失败",error)}
}

function normalizePosition(p){
  p.id=p.id||uid("pos");p.symbol=String(p.symbol||"").trim().toUpperCase();p.name=String(p.name||"");p.currency=String(p.currency||"USD").toUpperCase();p.source=p.source==="manual"?"manual":"twelve";p.shares=num(p.shares);p.avgCost=num(p.avgCost);p.price=num(p.price);p.sector=inferSector(p.symbol,p.name,p.sector);p.color=validColor(p.color||autoColorForPosition(p));p.sectorLocked=Boolean(p.sectorLocked);p.colorLocked=Boolean(p.colorLocked);p.note=String(p.note||"");p.priceSource=String(p.priceSource||p.quoteSource||(p.source==="manual"?"manual":"")).toLowerCase();p.priceProvider=String(p.priceProvider||"").toLowerCase();p.priceUpdatedAt=p.priceUpdatedAt||"";p.priceAsOf=p.priceAsOf||p.priceUpdatedAt||"";
  if(!Number.isFinite(Number(p.costBasisUSD)))p.costBasisUSD=p.shares*p.avgCost*fx(p.currency);else p.costBasisUSD=num(p.costBasisUSD);
  return p;
}

function migrateV8(raw){
  const migrated=structuredClone(defaultState);
  migrated.settings={...migrated.settings,...(raw.settings||{}),schemaVersion:LEDGER_SCHEMA_VERSION,migratedFrom:"V8.0",migratedAt:new Date().toISOString()};
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
  state.settings={...defaultState.settings,...(state.settings||{})};
  if(state.settings.apiKey&&!state.settings.publicMarketKey)state.settings.publicMarketKey=String(state.settings.apiKey);
  state.fxRates={...defaultState.fxRates,...(state.fxRates||{}),USD:1};
  state.positions=(Array.isArray(state.positions)?state.positions:[]).map(normalizePosition).filter(p=>p.symbol&&p.shares>0);
  applyAutoTaxonomy(incomingTaxonomy!==TAXONOMY_VERSION);
  state.settings.taxonomyVersion=TAXONOMY_VERSION;
  state.transactions=Array.isArray(state.transactions)?state.transactions:[];
  state.cashFlows=Array.isArray(state.cashFlows)?state.cashFlows:[];
  state.snapshots=Array.isArray(state.snapshots)?state.snapshots:[];
  if(!state.cashFlows.length){const legacy=num(state.settings.totalAsset)||15000;state.cashFlows=[{id:uid("cash"),date:today(),type:"deposit",amountUSD:legacy,note:"迁移本金",migration:true}]}
  if(state.transactions.length){
    try{rebuildCurrentPositionsFromTransactions(state.transactions)}
    catch(error){console.warn("Position rebuild skipped during normalizeState",error)}
  }
  delete state.data;delete state.settings.totalAsset;delete state.settings.version;
}

async function fetchSharedText(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch("data.json",{cache:"no-cache",signal:controller.signal});
    if(!response.ok)throw new Error("找不到 data.json");
    return await response.text();
  }finally{
    clearTimeout(timer);
  }
}
function applySharedDataText(raw,reason=""){
  normalizeState(JSON.parse(raw));mergeLocalReturnSnapshots();applyPriceCache();cloudState=structuredClone(state);lastSharedRaw=raw;dirty=false;lastMutationReason="";saveLocal();renderAll();renderSyncStatus();if(reason)$("status").textContent=reason;
}
function startInitialLoadTasks(autoRefresh=false){
  const tasks=[{label:"opening snapshot",task:()=>ensureCurrentMonthOpeningSnapshot()}];
  if(autoRefresh)tasks.push({label:"initial price refresh",task:()=>smartRefreshPricesOnLoad()});
  MYH88Core.scheduleBackgroundTasks(tasks,(error,label)=>{
    console.warn(`MYH88 ${label} failed`,error);
    lastQuoteWarnings=[lastQuoteWarnings,error?.message||String(error)].filter(Boolean).join("; ");
    renderDiagnostics();
  });
}
function addMarketCalendarDays(dateString,days){const date=new Date(`${dateString}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
function isCompletedTradingDate(dateString){const weekday=new Date(`${dateString}T12:00:00Z`).getUTCDay();return weekday!==0&&weekday!==6&&!US_STATIC_HOLIDAYS[dateString]}
function lastCompletedMarketDate(now=new Date()){
  const clock=marketClock(now);let date=clock.date;
  if(clock.phase==="pre"||clock.phase==="open"||clock.phase==="weekend"||clock.phase==="holiday")date=addMarketCalendarDays(date,-1);
  while(!isCompletedTradingDate(date))date=addMarketCalendarDays(date,-1);
  return date;
}
async function fetchStaticQuoteCache(symbols){
  const data=await fetchJson(STATIC_QUOTES_URL,{timeout:FETCH_TIMEOUT_MS});
  const parsed=MYH88Core.parseStaticQuoteCache(data);
  const referenceDate=lastCompletedMarketDate();
  if(!parsed)throw new Error("静态行情缓存格式无效");
  if(!MYH88Core.isStaticQuoteFresh(parsed,referenceDate,US_STATIC_HOLIDAYS,2))throw new Error(`静态行情已过期：${parsed.asOfDate||"未知日期"}，基准日 ${referenceDate}`);
  const quotes=parsed.quotes;
  const picked={};
  symbols.forEach(symbol=>{if(quotes?.[symbol])picked[symbol]=quotes[symbol]});
  if(Object.keys(picked).length)return symbols.length===1?picked[symbols[0]]:picked;
  throw new Error("Static quote cache missing requested symbols");
}
async function loadSharedData(autoRefresh=false){
  const status=$("status");status.textContent="正在读取 GitHub 共享数据...";
  try{
    const raw=await fetchSharedText();applySharedDataText(raw);startInitialLoadTasks(autoRefresh);
    status.textContent=navigator.onLine?(isAdminMode?`已读取共享数据：${new Date().toLocaleString("zh-CN")}`:"已读取最新云端账本"):"离线模式：已读取设备中最近缓存的数据";
    if(admin.owner&&admin.repo&&admin.token)checkCloudStatus(false);
  }catch(error){
    console.warn("共享数据读取失败",error);
    const cached=localStorage.getItem(STATE_KEY)||localStorage.getItem("v8_last_state");
    if(cached){normalizeState(readJson(cached,defaultState));applyPriceCache();dirty=isAdminMode;lastMutationReason=isAdminMode?"正在使用本机缓存":"";renderAll();startInitialLoadTasks(autoRefresh);status.textContent="读取失败，已使用本机缓存"}
    else{normalizeState(defaultState);dirty=isAdminMode;lastMutationReason=isAdminMode?"云端读取失败":"";renderAll();status.textContent="读取失败，已使用默认数据"}
    renderSyncStatus();
  }
}

async function smartRefreshPricesOnLoad(){
  const clock=await refreshMarketClock();
  if(clock?.isOpen||clock?.phase==="open"){
    refreshPrices(false);
    return;
  }
  refreshLastClosePrices(clock);
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

function mergeLocalReturnSnapshots(){
  const local=readJson(localStorage.getItem(RETURN_SNAPSHOT_KEY),[]),merged=new Map();
  (Array.isArray(local)?local:[]).forEach(s=>{if(s?.date)merged.set(String(s.date),s)});
  state.snapshots.forEach(s=>{if(s?.date)merged.set(String(s.date),s)});
  state.snapshots=[...merged.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-400);
}
function saveLocal(){
  localStorage.setItem(STATE_KEY,JSON.stringify(state));
  localStorage.setItem(RETURN_SNAPSHOT_KEY,JSON.stringify(state.snapshots.slice(-400)));
}
function markDirty(reason="本地数据已修改"){dirty=true;lastMutationReason=reason;state.settings.localUpdatedAt=new Date().toISOString();saveLocal();renderSyncStatus()}
function summaryOf(s){return{positions:Array.isArray(s?.positions)?s.positions.length:0,transactions:Array.isArray(s?.transactions)?s.transactions.length:0,cashFlows:Array.isArray(s?.cashFlows)?s.cashFlows.length:0,snapshots:Array.isArray(s?.snapshots)?s.snapshots.length:0,dcaEntries:Array.isArray(s?.dcaPlan?.entries)?s.dcaPlan.entries.length:0}}
function dangerBetween(local,remote){const l=summaryOf(local),r=summaryOf(remote),reasons=[],intentionalTransactionDelete=dirty&&/交易已删除/.test(lastMutationReason),intentionalDcaDelete=dirty&&/定投记录已删除/.test(lastMutationReason);if(l.transactions<r.transactions&&!intentionalTransactionDelete)reasons.push(`交易流水从 ${r.transactions} 条减少到 ${l.transactions} 条`);if(l.cashFlows<r.cashFlows)reasons.push(`资金流水从 ${r.cashFlows} 条减少到 ${l.cashFlows} 条`);if(l.dcaEntries<r.dcaEntries&&!intentionalDcaDelete)reasons.push(`定投记录从 ${r.dcaEntries} 条减少到 ${l.dcaEntries} 条`);if(!l.positions&&r.positions&&l.transactions<=r.transactions)reasons.push(`当前持仓从 ${r.positions} 个变成 0 个`);return reasons}
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
function priceSourceLabel(p){
  if(p.source==="manual"||p.priceSource==="manual")return"手填价";
  if(p.priceSource==="last-close")return"上个交易日收盘价";
  if(p.priceSource==="finnhub"||p.priceProvider==="finnhub")return"FIN 行情";
  if(p.priceSource==="twelve"||p.priceProvider==="twelve")return"TWE 行情";
  if(p.priceSource==="static")return"静态兜底";
  if(lastMarketRoute==="last-close")return"上个交易日收盘价";
  return"待刷新";
}
function priceSourceClass(p){
  const label=priceSourceLabel(p);
  if(label.includes("TWE"))return"source-twe";
  if(label.includes("FIN"))return"source-fin";
  if(label.includes("手填"))return"source-manual";
  if(label.includes("收盘"))return"source-close";
  return"source-muted";
}
function quoteDateLabel(p){const stamp=p.priceAsOf||p.priceUpdatedAt;if(!stamp)return"";const tradingDay=MYH88Core.quoteTradingDay(stamp,true);if(p.priceSource==="last-close")return tradingDay?`${tradingDay} 收盘价`:"";if(p.priceSource==="static")return tradingDay?`${tradingDay} 静态兜底价`:"";const date=new Date(stamp);if(Number.isNaN(date.getTime()))return"";return `更新于 ${date.toLocaleString("zh-CN")}`}
function quoteSourceSummary(){
  const counts={twe:0,fin:0,manual:0,close:0,static:0,pending:0};
  state.positions.forEach(p=>{
    const label=priceSourceLabel(p);
    if(label.includes("TWE"))counts.twe++;
    else if(label.includes("FIN"))counts.fin++;
    else if(label.includes("手填"))counts.manual++;
    else if(label.includes("收盘"))counts.close++;
    else if(label.includes("静态"))counts.static++;
    else counts.pending++;
  });
  return counts;
}
