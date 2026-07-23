const VERSION="V10.47 PWAå®¶åº­ç‰ˆ";
const RELEASE="10.47";
const LEDGER_SCHEMA_VERSION="10.33";
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
const SHARED_DATA_CHECK_MS=5*60000;
const US_MARKET_TZ="America/New_York";
const US_MARKET_OPEN_MIN=9*60+30;
const US_MARKET_CLOSE_MIN=16*60;
const US_EARLY_CLOSE_MIN=13*60;
const US_STATIC_HOLIDAYS={"2026-01-01":"å…ƒæ—¦","2026-01-19":"é©¬ä¸è·¯å¾·é‡‘çºªå¿µæ—¥","2026-02-16":"æ€»ç»Ÿæ—¥","2026-04-03":"è€¶ç¨£å—éš¾æ—¥","2026-05-25":"é˜µäº¡å°†å£«çºªå¿µæ—¥","2026-06-19":"å…­æœˆèŠ‚","2026-07-03":"ç‹¬ç«‹æ—¥è§‚å¯Ÿä¼‘å¸‚","2026-09-07":"åŠ³åŠ¨èŠ‚","2026-11-26":"æ„Ÿæ©èŠ‚","2026-12-25":"åœ£è¯žèŠ‚"};
const US_STATIC_EARLY_CLOSES={"2026-11-27":"æ„Ÿæ©èŠ‚åŽæå‰æ”¶ç›˜","2026-12-24":"åœ£è¯žå¤œæå‰æ”¶ç›˜"};
Object.assign(US_STATIC_HOLIDAYS,{"2027-01-01":"å…ƒæ—¦","2027-01-18":"é©¬ä¸è·¯å¾·é‡‘çºªå¿µæ—¥","2027-02-15":"æ€»ç»Ÿæ—¥","2027-03-26":"è€¶ç¨£å—éš¾æ—¥","2027-05-31":"é˜µäº¡å°†å£«çºªå¿µæ—¥","2027-06-18":"å…­æœˆèŠ‚è§‚å¯Ÿä¼‘å¸‚","2027-07-05":"ç‹¬ç«‹æ—¥è§‚å¯Ÿä¼‘å¸‚","2027-09-06":"åŠ³åŠ¨èŠ‚","2027-11-25":"æ„Ÿæ©èŠ‚","2027-12-24":"åœ£è¯žèŠ‚è§‚å¯Ÿä¼‘å¸‚","2028-01-17":"é©¬ä¸è·¯å¾·é‡‘çºªå¿µæ—¥","2028-02-21":"æ€»ç»Ÿæ—¥","2028-04-14":"è€¶ç¨£å—éš¾æ—¥","2028-05-29":"é˜µäº¡å°†å£«çºªå¿µæ—¥","2028-06-19":"å…­æœˆèŠ‚","2028-07-04":"ç‹¬ç«‹æ—¥","2028-09-04":"åŠ³åŠ¨èŠ‚","2028-11-23":"æ„Ÿæ©èŠ‚","2028-12-25":"åœ£è¯žèŠ‚"});
const TAXONOMY_VERSION="sector-color-v10";
const ADMIN_PASSWORD_HASH="e9cf0653c1f1de4720a1984d6b8f1f7caef8207edf46a7d7fdc4950522df12f1";
const ADMIN_AUTH_KEY="myh88_admin_auth_v1046";
const ADMIN_AUTH_TTL_MS=12*60*60*1000;

const defaultState={settings:{title:"å­Ÿä¸€æ™—çš„æ¢¦æƒ³é‡‘åº“",priceCacheMinutes:30,lastPriceRefresh:0,lastPriceRefreshText:"",schemaVersion:LEDGER_SCHEMA_VERSION},fxRates:{USD:1,EUR:1.16,HKD:.128,JPY:.0067,GBP:1.27},positions:[],transactions:[],cashFlows:[],snapshots:[]};
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
let buildMeta={release:RELEASE,version:VERSION,serviceWorker:RELEASE,worker:RELEASE};
let serviceWorkerVersion="";

const SECTOR_RULES=[
  {label:"AIåŸºå»º",color:"#22d38a",symbols:["NVDA","VRT"],keywords:["è‹±ä¼Ÿè¾¾","ç»´è°›","aiåŸºå»º","aiåŸºç¡€è®¾æ–½","ç®—åŠ›","æ•°æ®ä¸­å¿ƒ","ç”µåŠ›"]},
  {label:"åŠå¯¼ä½“",color:"#ff8a3d",symbols:["MU","DRAM","XFAB","AVGO","AMD","TSM","ASML","ARM","QCOM","AMAT","LRCX"],keywords:["åŠå¯¼ä½“","èŠ¯ç‰‡","æ™¶åœ†","è®¾å¤‡","ç¾Žå…‰","å­˜å‚¨","å†…å­˜","dram","hbm"]},
  {label:"å…‰é€šä¿¡",color:"#18c9d7",symbols:["MRVL","AAOI","LITE"],keywords:["å…‰é€šä¿¡","å…‰é€šè®¯","å…‰æ¨¡å—","å…‰ç”µ","å…‰èŠ¯ç‰‡","è¿ˆå¨å°”","åº”ç”¨å…‰ç”µ","lumentum","é²é—¨ç‰¹å§†","æœ—ç¾Žé€š"]},
  {label:"å¤ªç©º",color:"#ef476f",symbols:["RKLB","SPCX"],keywords:["å¤ªç©º","èˆªå¤©","ç«ç®­","rocket","space","spacex"]},
  {label:"ç§‘æŠ€å¹³å°",color:"#8b5cf6",symbols:["GOOGL","GOOG","META","MSFT","AMZN","AAPL","PLTR","CRM","ORCL","IBM","TSLA","RIVN","LCID","NIO","XPEV","LI"],keywords:["è°·æ­Œ","å¹³å°","äº‘","æœç´¢","å¹¿å‘Š","è½¯ä»¶","ç‰¹æ–¯æ‹‰","æ™ºèƒ½æ±½è½¦","ç”µåŠ¨è½¦","æ–°èƒ½æºè½¦","è‡ªåŠ¨é©¾é©¶"]},
  {label:"åŒ»ç–—",color:"#f472b6",symbols:["UNH","LLY","NVO","MRK","PFE","JNJ","TMO","ISRG"],keywords:["åŒ»ç–—","åŒ»è¯","åˆ¶è¯","ç”Ÿç‰©","å™¨æ¢°"]},
  {label:"çŽ°é‡‘",color:"#f9d95c",symbols:["CASH"],keywords:["çŽ°é‡‘","cash"]},
  {label:"æœªåˆ†ç±»",color:"#64748b",symbols:[],keywords:["æœªåˆ†ç±»"]}
];
const SECTOR_ALIAS={"å…‰é€šè®¯":"å…‰é€šä¿¡","é€šä¿¡å…‰":"å…‰é€šä¿¡","AI":"AIåŸºå»º","äººå·¥æ™ºèƒ½":"AIåŸºå»º","ç®—åŠ›":"AIåŸºå»º","èˆªå¤©":"å¤ªç©º","å®‡å®™":"å¤ªç©º","æ™ºèƒ½æ±½è½¦":"ç§‘æŠ€å¹³å°","AIå­˜å‚¨":"åŠå¯¼ä½“","AIå­˜å„²":"åŠå¯¼ä½“","çŽ°é‡‘":"çŽ°é‡‘","CASH":"çŽ°é‡‘"};

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
function formatDuration(ms){const mins=Math.max(0,Math.ceil(ms/60000)),h=Math.floor(mins/60),m=mins%60;return h?`${h}å°æ—¶${m}åˆ†`:`${m}åˆ†`}
function nyParts(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:US_MARKET_TZ,weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  if(parts.hour==="24")parts.hour="00";
  return{weekday:parts.weekday,year:num(parts.year),month:num(parts.month),day:num(parts.day),date:`${parts.year}-${parts.month}-${parts.day}`,hour:num(parts.hour),minute:num(parts.minute)};
}
function nextBusinessDayLabel(parts){
  const order=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],zh=["å‘¨æ—¥","å‘¨ä¸€","å‘¨äºŒ","å‘¨ä¸‰","å‘¨å››","å‘¨äº”","å‘¨å…­"],idx=order.indexOf(parts.weekday);
  const add=idx===5?3:idx===6?2:1;
  return zh[(idx+add)%7];
}
function marketClock(now=new Date()){
  const p=nyParts(now),weekend=p.weekday==="Sat"||p.weekday==="Sun",mins=p.hour*60+p.minute;
  const holiday=US_STATIC_HOLIDAYS[p.date]||"",earlyClose=US_STATIC_EARLY_CLOSES[p.date]||"",closeMin=earlyClose?US_EARLY_CLOSE_MIN:US_MARKET_CLOSE_MIN;
  if(holiday)return{phase:"holiday",isOpen:false,label:`ç¾Žè‚¡ä¼‘å¸‚ Â· ${holiday}`,detail:"ä¼‘å¸‚æ—¥ä¼˜å…ˆä½¿ç”¨ç¼“å­˜",source:"local",date:p.date,holiday,earlyClose:""};
  if(weekend)return{phase:"weekend",isOpen:false,label:`ç¾Žè‚¡å‘¨æœ«ä¼‘å¸‚ Â· ä¸‹æ¬¡å¼€ç›˜ ${nextBusinessDayLabel(p)} 09:30 ET`,detail:"ä¼‘å¸‚æ—¥ä¼˜å…ˆä½¿ç”¨ç¼“å­˜",source:"local",date:p.date,holiday:"",earlyClose:""};
  if(mins>=US_MARKET_OPEN_MIN&&mins<closeMin){
    const closeMs=(closeMin-mins)*60000;
    return{phase:"open",isOpen:true,label:`ç¾Žè‚¡ç›˜ä¸­ Â· è·ç¦»æ”¶ç›˜çº¦ ${formatDuration(closeMs)}`,detail:"ç›˜ä¸­è‡ªåŠ¨åˆ·æ–°",source:"local",date:p.date,holiday:"",earlyClose};
  }
  if(!weekend&&mins<US_MARKET_OPEN_MIN){
    const openMs=(US_MARKET_OPEN_MIN-mins)*60000;
    return{phase:"pre",isOpen:false,label:`ç¾Žè‚¡æœªå¼€ç›˜ Â· è·ç¦»å¼€ç›˜çº¦ ${formatDuration(openMs)}`,detail:"å¼€ç›˜å‰ä¼˜å…ˆä½¿ç”¨ç¼“å­˜",source:"local",date:p.date,holiday:"",earlyClose};
  }
  return{phase:"closed",isOpen:false,label:`ç¾Žè‚¡å·²æ”¶ç›˜ Â· ä¸‹æ¬¡å¼€ç›˜ ${nextBusinessDayLabel(p)} 09:30 ET`,detail:earlyClose?`ä»Šæ—¥${earlyClose}`:"æ”¶ç›˜åŽä¼˜å…ˆä½¿ç”¨ç¼“å­˜",source:"local",date:p.date,holiday:"",earlyClose};
}
function marketClockDisplay(clock=marketClock()){
  if(clock.label)return clock.label;
  const source=clock.source==="finnhub"?"å®žæ—¶å¸‚åœºçŠ¶æ€":"æœ¬åœ°ä¼‘å¸‚è¡¨";
  if(clock.isOpen)return`ç¾Žè‚¡ç›˜ä¸­ Â· ${source}`;
  if(clock.holiday)return`ç¾Žè‚¡ä¼‘å¸‚ Â· ${clock.holiday}`;
  if(clock.earlyClose)return`ç¾Žè‚¡éžç›˜ä¸­ Â· ${clock.earlyClose}`;
  return marketClock().label;
}
function isUsMarketOpen(){return Boolean((marketClockState||marketClock()).isOpen||(marketClockState||marketClock()).phase==="open")}
function validColor(v){return /^#[0-9a-f]{6}$/i.test(v||"")?v:"#888888"}
function hexToRgb(hex){const v=validColor(hex).slice(1);return{r:parseInt(v.slice(0,2),16),g:parseInt(v.slice(2,4),16),b:parseInt(v.slice(4,6),16)}}
function rgbToHex({r,g,b}){return"#"+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("")}
function mixColor(a,b,weight=.5){const x=hexToRgb(a),y=hexToRgb(b);return rgbToHex({r:x.r+(y.r-x.r)*weight,g:x.g+(y.g-x.g)*weight,b:x.b+(y.b-x.b)*weight})}
function sectorRule(label){const key=String(label||"æœªåˆ†ç±»").trim();return SECTOR_RULES.find(r=>r.label===key)||SECTOR_RULES.at(-1)}
function sectorBaseColor(label){return sectorRule(label).color}
function normalizeSectorName(value){
  const raw=String(value||"").trim();
  if(!raw)return"æœªåˆ†ç±»";
  const direct=SECTOR_ALIAS[raw]||SECTOR_ALIAS[raw.toUpperCase()];
  if(direct)return direct;
  const lower=raw.toLowerCase();
  const rule=SECTOR_RULES.find(r=>r.label===raw||r.keywords.some(k=>lower.includes(String(k).toLowerCase())));
  return rule?.label||raw;
}
function inferSector(symbol,name="",sector=""){
  const normalized=normalizeSectorName(sector);
  if(normalized&&normalized!=="æœªåˆ†ç±»")return normalized;
  const ticker=String(symbol||"").trim().toUpperCase();
  const text=`${ticker} ${name}`.toLowerCase();
  const rule=SECTOR_RULES.find(r=>r.symbols.includes(ticker)||r.keywords.some(k=>text.includes(String(k).toLowerCase())));
  return rule?.label||"æœªåˆ†ç±»";
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
function parseProxyUrls(value){return String(value||"").split(/[\n,ï¼Œ\s]+/).map(normalizeProxyUrl).filter(Boolean)}
function priceProxyUrls(){
  const configured=[...(Array.isArray(state.settings?.priceProxyUrls)?state.settings.priceProxyUrls:[]),state.settings?.priceProxyUrl,localStorage.getItem("v10_price_proxy")];
  const urls=[...configured.flatMap(parseProxyUrls),...DEFAULT_PRICE_PROXY_URLS];
  return [...new Set(urls)];
}
function priceProxyUrl(){return priceProxyUrls()[0]||""}
function isStandalone(){return window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true}
function isIos(){return /iphone|ipad|ipod/i.test(navigator.userAgent)}
function updateNetworkStatus(){
  const online=navigator.onLine,badge=$("networkBadge");if(badge){badge.textContent=online?"åœ¨çº¿":"ç¦»çº¿";badge.className=`network-badge ${online?"online":"offline"}`}
  const refresh=$("refreshButton"),save=$("githubSaveButton");if(refresh)refresh.disabled=!online;if(save)save.disabled=!online;
  if(!online){$("status").textContent="å½“å‰ç¦»çº¿ï¼šæ­£åœ¨æ˜¾ç¤ºè®¾å¤‡ä¸­æœ€è¿‘ç¼“å­˜çš„æ•°æ®"}
}
function updateInstallButton(){const button=$("installAppButton");if(!button)return;button.classList.toggle("hidden",isStandalone())}
function installApp(){
  if(isStandalone()){alert("æ¢¦æƒ³é‡‘åº“å·²ç»å®‰è£…åœ¨è¿™å°è®¾å¤‡ä¸Š");return}
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
  }catch(error){console.warn("æž„å»ºä¿¡æ¯è¯»å–å¤±è´¥",error)}
  try{serviceWorkerVersion=await queryServiceWorkerVersion()}catch{}
  renderDiagnosticÛn¸æÚ$z{-®éÜj×VF—D–B"’çfÇVS°¢–b†VF—D–B—°¢6öç7BW†—7F–æs×7FFRçG&ç67F–öç2æf–æB‡CÓçBæ–CÓÓÖVF—D–B“¶–b‚W†—7F–ær—&WGW&ã°¢G'—¶6öç7BG&gC×G&FTf÷&ÔG&gB†W†—7F–ær’ÆæW‡C×7FFRçG&ç67F–öç2æÖ‡CÓçBæ–CÓÓÖVF—D–CöG&gC§B“¶6öÖÖ—EG&ç67F–öä6†ævR†æW‡BÆG¶G&gBç7–Ö&öÇÒKªNi‰>[{.{Én‹é“²B‚'G&FTF–Æör"’æ6Æ÷6R‚—Ö6F6‚†W'&÷"—¶ÆW'B†W'&÷"æÖW76vR—Ð¢&WGW&ã°¢Ð¢G'—°¢6öç7BG&gC×G&FTf÷&ÔG&gB‡·Ò“°¢6öÖÖ—EG&ç67F–öä6†ævR…²ââç7FFRçG&ç67F–öç2ÆG&gEÒÆG¶G&gBç7–Ö&öÇÒG¶G&gBçG—SÓÓÒ'6VÆÂ#ò.XÙnX{¢#¢.K›XZR'ÞKªNi‰>[{.Šë[ÙV“°¢B‚'G&FTF–Æör"’æ6Æ÷6R‚“·7v—F6„ÆVFvW%F"†G&gBçG—SÓÓÒ'6VÆÂ#ò'G&ç67F–öç2#¢'÷6—F–öç2"“°¢Ö6F6‚†W'&÷"—¶ÆW'B†W'&÷"æÖW76vR—Ð§Ð¦gVæ7F–öâFVÆWFUG&ç67F–öâ†–B—°¢6öç7BC×7FFRçG&ç67F–öç2æf–æB‡ƒÓç‚æ–CÓÓÖ–B“¶–b‚B—&WGW&ã°¢–b‚6öæf—&Ò†XŠ™šN‹ùžiÚKªNi‰>Šë[Ù^ûÉõÆâG·G&ç67F–öäÆ&VÂ‡B—ÒG·Bç7–Ö&öÇÒG·Bç6†&W7Òˆ*G·Bç&–6WÒG·Bæ7W'&Væ7—ÕÆåÆî{;¾{¹þKÉ®yJŽXšžKÙžkXkN˜xÞikŠêzé~[Ù>X˜ÞhÈK¹>8&’—&WGW&ã°¢6öÖÖ—EG&ç67F–öä6†ævR‡7FFRçG&ç67F–öç2æf–ÇFW"‡ƒÓç‚æ–BÓÖ–B’ÆG·Bç7–Ö&öÇÒKªNi‰>[{.XŠ™šF“°§Ð¦gVæ7F–öâ&VæFW%G&ç67F–öåF&ÆR‚—¶6öç7BÒB‚'G&ç67F–öå6V&6‚"“òçfÇVRçG&–Ò‚’çFõWW$66R‚—ÇÂ""ÇG—SÒB‚'G&ç67F–öåG—Tf–ÇFW""“òçfÇVWÇÂ&ÆÂ"Æf–ÇFW&VC×7FFRçG&ç67F–öç2ç6Æ–6R‚’ç6÷'B‚†Æ"“Óå7G&–ær†"æFFR’æÆö6ÆT6ö×&R…7G&–ær†æFFR’’’æf–ÇFW"‡CÓâ‚ÇÅ7G&–ær‡Bç7–Ö&öÂ’æ–æ6ÇVFW2‡’’bb‡G—SÓÓÒ&ÆÂ'ÇÇBçG—SÓÓ×G—R’’ÇvW3ÔÖF‚æÖ‚ƒÄÖF‚æ6V–Â†f–ÇFW&VBæÆVæwF‚õtUõ4•¤R’“·G&ç67F–öåvSÔÖF‚æÖ–â‡G&ç67F–öåvRÇvW2“¶6öç7B—FV×3Öf–ÇFW&VBç6Æ–6R‚‡G&ç67F–öåvRÓ’¥tUõ4•¤RÇG&ç67F–öåvR¥tUõ4•¤R“²B‚'G&ç67F–öä&öG’"’æ–ææW$…DÔÃÖ—FV×2æÆVæwFƒö—FV×2æÖ‡CÓæÇG"6Æ73Ò"G·Bçfö–FVCò&×WFVB#¢"'Ò#ãÇFCâG¶W66T‡FÖÂ‡BæFFR—ÓÂ÷FCãÇFCãÇ7â6Æ73Ò'G—R×–ÆÂ#âG·G&ç67F–öäÆ&VÂ‡B—ÓÂ÷7ããÂ÷FCãÇFCãÇ7G&öæsâG¶W66T‡FÖÂ‡Bç7–Ö&öÂ—ÓÂ÷7G&öæsãÂ÷FCãÇFCâG·&÷VæB‡Bç6†&W2ÃB—ÓÂ÷FCãÇFCâG·&÷VæB‡Bç&–6RÃB—ÒG¶W66T‡FÖÂ‡Bæ7W'&Væ7’—ÓÂ÷FCãÇFCâG·&÷VæB‡BæfVRÃB—ÒG¶W66T‡FÖÂ‡Bæ7W'&Væ7’—ÓÂ÷FCãÇFCâG·&÷VæB‡Bæg…&FRÃb—ÓÂ÷FCãÇFB6Æ73Ò"G·Bçfö–FVCò&×WFVB#¦6Ç2‡Bç&VÆ—¦VEæÅU4B—Ò#âG·BçG—SÓÓÒ'6VÆÂ#öÖöæW’‡Bç&VÆ—¦VEæÅU4B“¢.(	B'ÓÂ÷FCãÇFCâG¶W66T‡FÖÂ‡Bææ÷FWÇÂ""—ÓÂ÷FCãÇFCâG¶—4FÖ–äÖöFRbbBçfö–FVCöÆF—b6Æ73Ò&6÷'&V7F–öâÖ'WGFöç2#ãÆ'WGFöâöæ6Æ–6³Ò&÷VåG&FTVF—B‚rG·Bæ–GÒr’#î{Én‹éÂö'WGFöããÆ'WGFöâ6Æ73Ò&FævW""öæ6Æ–6³Ò&FVÆWFUG&ç67F–öâ‚rG·Bæ–GÒr’#îXŠ™šCÂö'WGFöããÂöF—cæ¢.(	B'ÓÂ÷FCãÂ÷G#æ’æ¦ö–â‚""“¢sÇG#ãÇFB6öÇ7ãÒ#"6Æ73Ò&×WFVB#îi¨.izKªNi‰>Šë[ÙSÂ÷FCãÂ÷G#âs²B‚'G&ç67F–öåvW""’æ–ææW$…DÔÃÖÆ'WGFöâG·G&ç67F–öåvSÃÓò&F—6&ÆVB#¢"'Òöæ6Æ–6³Ò'G&ç67F–öåvRÒÓ·&VæFW%G&ç67F–öåF&ÆR‚’#îKˆ®KˆšSÂö'WGFöããÇ7ãâG·G&ç67F–öåvWÒòG·vW7Ò+rX[G¶f–ÇFW&VBæÆVæwF‡ÒiÚÂ÷7ããÆ'WGFöâG·G&ç67F–öåvSã×vW3ò&F—6&ÆVB#¢"'Òöæ6Æ–6³Ò'G&ç67F–öåvR²³·&VæFW%G&ç67F–öåF&ÆR‚’#îKˆ¾KˆšSÂö'WGFöãæÐ¦gVæ7F–öâVF—E÷6—F–öâ†–B—°¢6öç7B×7FFRç÷6—F–öç2æf–æB‡ƒÓç‚æ–CÓÓÖ–B“¶–b‚—&WGW&ã²B‚'÷6—F–öäVF—D–B"’çfÇVS×æ–C²B‚'÷6—F–öäVF—EF—FÆR"’çFW‡D6öçFVçCÖ{Én‹é‹XNKª~ûÉ¢G·ç7–Ö&öÇÖ²B‚'÷6—F–öäVF—DæÖR"’çfÇVS×ææÖWÇÂ"#²B‚'÷6—F–öäVF—E6V7F÷""’çfÇVS×ç6V7F÷'ÇÂ.iÊ®Xˆn{²#²B‚'÷6—F–öäVF—E6V7F÷$Æö6¶VB"’æ6†V6¶VCÔ&ööÆVâ‡ç6V7F÷$Æö6¶VB“²B‚'÷6—F–öäVF—E6÷W&6R"’çfÇVS×ç6÷W&6WÇÂ'GvVÇfR#²B‚'÷6—F–öäVF—E&–6R"’çfÇVS×ç&–6WÇÃ²B‚'÷6—F–öäVF—D6öÆ÷""’çfÇVS×fÆ–D6öÆ÷"‡æ6öÆ÷"“²B‚'÷6—F–öäVF—D6öÆ÷$Æö6¶VB"’æ6†V6¶VCÔ&ööÆVâ‡æ6öÆ÷$Æö6¶VB“²B‚'÷6—F–öäF–Æör"’ç6†÷tÖöFÂ‚§Ð¦gVæ7F–öâ6WE÷6—F–öäVF—D6öÆ÷"†6öÆ÷"—²B‚'÷6—F–öäVF—D6öÆ÷""’çfÇVS×fÆ–D6öÆ÷"†6öÆ÷"—Ð¦gVæ7F–öâ7V&Ö—E÷6—F–öäVF—B†WfVçB—°¢WfVçBç&WfVçDFVfVÇB‚“¶6öç7B–CÒB‚'÷6—F–öäVF—D–B"’çfÇVRÇ×7FFRç÷6—F–öç2æf–æB‡ƒÓç‚æ–CÓÓÖ–B“¶–b‚—&WGW&ã¶6öç7B6öÆ÷#×fÆ–D6öÆ÷"‚B‚'÷6—F–öäVF—D6öÆ÷""’çfÇVR’Ç6÷W&6SÒB‚'÷6—F–öäVF—E6÷W&6R"’çfÇVS¶–b‚²'GvVÇfR"Â&ÖçVÂ%Òæ–æ6ÇVFW2‡6÷W&6R’—¶ÆW'B‚.i[hÚîk©Xú®ˆ;ÞiŠòGvVÇfRh‰bÖçVÂ"“·&WGW&çÐ¢7&VFT&6·W†G·ç7–Ö&öÇÒ‹XNiiž{Én‹éX˜Ö“°¢ææÖSÒB‚'÷6—F–öäVF—DæÖR"’çfÇVRçG&–Ò‚—ÇÇç7–Ö&öÃ·ç6V7F÷#ÒB‚'÷6—F–öäVF—E6V7F÷""’çfÇVRçG&–Ò‚—ÇÂ.iÊ®Xˆn{²#·ç6V7F÷$Æö6¶VCÒB‚'÷6—F–öäVF—E6V7F÷$Æö6¶VB"’æ6†V6¶VC·ç6÷W&6S×6÷W&6S·æ6öÆ÷#Ö6öÆ÷#·æ6öÆ÷$Æö6¶VCÒB‚'÷6—F–öäVF—D6öÆ÷$Æö6¶VB"’æ6†V6¶VC¶–b‡6÷W&6SÓÓÒ&ÖçVÂ"bfçVÒ‚B‚'÷6—F–öäVF—E&–6R"’çfÇVR“ãÓ—·ç&–6SÖçVÒ‚B‚'÷6—F–öäVF—E&–6R"’çfÇVR“·ç&–6U6÷W&6SÒ&ÖçVÂ#·ç&–6U&÷f–FW#Ò&ÖçVÂ#·ç&–6UWFFVDCÖæWrFFR‚’çFô•4õ7G&–ær‚—Ð¢7FFRçG&ç67F–öç2æf÷$V6‚‡CÓç¶–b‡Bç7–Ö&öÃÓÓ×ç7–Ö&öÂ—·BææÖS×ææÖS·Bç6V7F÷#×ç6V7F÷#·Bç6÷W&6S×ç6÷W&6S·Bæ6öÆ÷#×æ6öÆ÷'×Ò“°¢Ö&´F—'G’†G·ç7–Ö&öÇÒ‹XNKª~‹XNiižKˆîš)Îˆ›.[{.{Én‹é“²B‚'÷6—F–öäF–Æör"’æ6Æ÷6R‚“·&VæFW$ÆÂ‚§Ð¦gVæ7F–öâ&VæFW%6V7F÷'5c"‚—¶6öç7B&#ÒB‚'6V7F÷$&""’ÆÆVvVæCÒB‚'6V7F÷$ÆVvVæB"’ÇF÷FÃÔÖF‚æÖ‚†6öçG&–'WFVD6—FÂ‚’·&VÆ—¦VEæÂ‚’Ã“¶&"æ–ææW$…DÔÃÒ"#¶ÆVvVæBæ–ææW$…DÔÃÒ"#·6V7F÷$—FV×2‚’æf÷$V6‚‡3Óç¶6öç7B7C×&÷VæB‡2çF÷FÂ÷F÷FÂ£’Ç6VsÖFö7VÖVçBæ7&VFTVÆVÖVçB‚&F—b"“·6Vræ6Æ74æÖSÒ'6VvÖVçB"²‡7CãÓCò"Ö¦÷"#¢""“·6Vrç7G–ÆRçv–GFƒÔÖF‚æÖ‚ƒBÇ7B’²"R#·6Vrç7G–ÆRæ&6¶w&÷VæCÖÆ–æV"Öw&F–VçBƒ“FVrÂG¶Ö—„6öÆ÷"‡2æ6öÆ÷"Â"6fffffb"ÂãB—ÒÂG¶Ö—„6öÆ÷"‡2æ6öÆ÷"Â"3"Âã"—Ò–·6VrçF—FÆSÖG·2æÆ&VÇÒG·7GÒV·6VrçFW‡D6öçFVçC×7CãÓCöG·2æÆ&VÇÒG·7GÒV¢"#¶&"æVæD6†–ÆB‡6Vr“¶ÆVvVæBæ–ç6W'DF¦6VçD…DÔÂ‚&&Vf÷&VVæB"ÆÇ7ããÆ’6Æ73Ò&F÷B"7G–ÆSÒ&&6¶w&÷VæC¢G·fÆ–D6öÆ÷"‡2æ6öÆ÷"—Ò#ãÂö“âG¶W66T‡FÖÂ‡2æÆ&VÂ—ÒG¶ÖöæW’‡2çF÷FÂ—ÒÆ"6Æ73Ò"G¶6Ç2‡2çæÂ—Ò#âG¶ÖöæW’‡2çæÂ—ÓÂö#ãÂ÷7ãæ—Ò—Ð¦gVæ7F–öâ&VæFW$6†'Ec"‚—¶6öç7B7fsÒB‚&76WD6†'B"’ÆFF×7FFRç6æ6†÷G2ç6Æ–6R‚Ó#“¶–b†FFæÆVæwFƒÃ"—·7fræ6Æ74Æ—7BæFB‚&†–FFVâ"“²B‚&6†'DV×G’"’æ6Æ74Æ—7Bç&VÖ÷fR‚&†–FFVâ"“·&WGW&ç×7fræ6Æ74Æ—7Bç&VÖ÷fR‚&†–FFVâ"“²B‚&6†'DV×G’"’æ6Æ74Æ—7BæFB‚&†–FFVâ"“¶6öç7BÖö&–ÆS×7fræ6Æ–VçEv–GF‚bg7fræ6Æ–VçEv–GFƒÃsÅsÖÖö&–ÆSóC3£#ÄƒÖÖö&–ÆSó3£#cÇCÖÖö&–ÆS÷¶Ã£“"Ç#£#"ÇC£#‚Æ#£C'Ó§¶Ã£ƒ"Ç#£#BÇC£#BÆ#£3GÒÇfÇVW3ÖFFæfÆDÖ‡ƒÓå¶çVÒ‡‚ææWD76WB’ÆçVÒ‡‚æ6—FÂ•Ò’ÆÖ–ãÔÖF‚æÖ–â‚ââçfÇVW2’ÆÖƒÔÖF‚æÖ‚‚ââçfÇVW2’Ç&ævSÔÖF‚æÖ‚†Ö‚ÖÖ–âÃ’ÇƒÖ“ÓçBæÂ¶’¢…r×BæÂ×Bç"’ôÖF‚æÖ‚†FFæÆVæwF‚ÓÃ’Ç“×cÓçBçB²†Ö‚×b’¢„‚×BçB×Bæ"’÷&ævRÇFƒÖ¶W“ÓæFFæÖ‚†BÆ’“Óâ†“ò$Â#¢$Ò"’·‚†’’çFôf—†VBƒ’²""·’†çVÒ†E¶¶W•Ò’’çFôf—†VBƒ’’æ¦ö–â‚""’Æ&VÖG·F‚‚&æWD76WB"—ÒÂG·‚†FFæÆVæwF‚Ó—ÒG´‚×Bæ'ÒÂG·‚ƒ—ÒG´‚×Bæ'Ò¦¶ÆWBw&–CÒ"#¶f÷"†ÆWB“Ó¶“ÃC¶’²²—¶6öç7BfÃÖÖ‚×&ævR¦’ó2Ç—“×’‡fÂ“¶w&–B³ÖÆÆ–æR6Æ73Ò&6†'BÖw&–B"ƒÒ"G·BæÇÒ"“Ò"G·——Ò"ƒ#Ò"Gµr×Bç'Ò"“#Ò"G·——Ò"óãÇFW‡B6Æ73Ò&6†'BÖÆ&VÂ"ƒÒ"G¶Öö&–ÆSóC£‡Ò"“Ò"G·—’³WÒ#âG¶ÖöæW’‡fÂ—ÓÂ÷FW‡Cæ×7frç6WDGG&–'WFR‚'f–Wt&÷‚"ÆGµwÒG´‡Ö“·7fræ–ææW$…DÔÃÖÆFVg3ãÆÆ–æV$w&F–VçB–CÒ&&Vw&F–VçB"ƒÒ#"“Ò#"ƒ#Ò#"“#Ò##ãÇ7F÷öfg6WCÒ#"7F÷Ö6öÆ÷#Ò"6fcFc–"7F÷Ö÷6—G“Ò"ã#R"óãÇ7F÷öfg6WCÒ#"7F÷Ö6öÆ÷#Ò"6fcFc–"7F÷Ö÷6—G“Ò#"óãÂöÆ–æV$w&F–VçCãÂöFVg3âG¶w&–GÓÇF‚6Æ73Ò&6†'BÖ&V"CÒ"G¶&VÒ"óãÇF‚6Æ73Ò&6†'BÖ6—FÂ"CÒ"G·F‚‚&6—FÂ"—Ò"óãÇF‚6Æ73Ò&6†'BÖ76WB"CÒ"G·F‚‚&æWD76WB"—Ò"óãÆ6—&6ÆR6Æ73Ò&6†'BÖF÷B"7ƒÒ"G·‚†FFæÆVæwF‚Ó—Ò"7“Ò"G·’†FFæB‚Ó’ææWD76WB—Ò"#Ò"G¶Öö&–ÆSóc£WÒ"óãÇFW‡B6Æ73Ò&6†'BÖÆ–æRÖÆ&VÂ"FW‡BÖæ6†÷#Ò&VæB"ƒÒ"Gµr×Bç'Ò"“Ò"G´ÖF‚æÖ‚ƒ‚Ç’†FFæB‚Ó’ææWD76WB’Ó—Ò#âG¶ÖöæW’†FFæB‚Ó’ææWD76WB—ÓÂ÷FW‡CãÇFW‡B6Æ73Ò&6†'BÖÆ&VÂ"ƒÒ"G·BæÇÒ"“Ò"G´‚Ó‡Ò#âG¶W66T‡FÖÂ†FF³ÒæFFR—ÓÂ÷FW‡CãÇFW‡B6Æ73Ò&6†'BÖÆ&VÂ"FW‡BÖæ6†÷#Ò&VæB"ƒÒ"Gµr×Bç'Ò"“Ò"G´‚Ó‡Ò#âG¶W66T‡FÖÂ†FFæB‚Ó’æFFR—ÓÂ÷FW‡CæÐ¦gVæ7F–öâ&VæFW$†öÆF–æt6&G5c"‚—°¢6öç7B&÷ƒÒB‚&†öÆF–æt6&G2"“°¢–b‚7FFRç÷6—F–öç2æÆVæwF‚—¶&÷‚æ–ææW$…DÔÃÒsÆF—b6Æ73Ò&V×G’#îi¨.iz[Ù>X˜ÞhÈK¹3ÂöF—câs·&WGW&çÐ¢6öç7BF÷FÃÔÖF‚æÖ‚†6öçG&–'WFVD6—FÂ‚’·&VÆ—¦VEæÂ‚’Ã“°¢&÷‚æ–ææW$…DÔÃ×7FFRç÷6—F–öç2ç6Æ–6R‚’ç6÷'B‚†Æ"“ÓæçVÒ†"æ6÷7D&6—5U4B’ÖçVÒ†æ6÷7D&6—5U4B’’æÖ‡Óç°¢6öç7BæÃÖfÆöF–æuæÅU4B‡’Ç&WC×&÷VæB‡æ6÷7D&6—5U4C÷æÂ÷æ6÷7D&6—5U4B££’ÇvV–v‡C×&÷VæB‡æ6÷7D&6—5U4B÷F÷FÂ£’Æ6†ævS×&÷VæB‡æ6†ævUW&6VçGÇÃ’Æ6†ævUFW‡CÖ6†ævSö6†ævR²"R#¢"ÒÒ"Ç6÷W&6S×&–6U6÷W&6TÆ&VÂ‡“°¢&WGW&âsÆF—b6Æ73Ò&†öÆF–ærÖ6&B#ãÆF—b6Æ73Ò&†öÆF–ærÖÖ–â#ãÆF—cãÆF—b6Æ73Ò'7–Ö&öÂ#âr¶W66T‡FÖÂ‡ç7–Ö&öÂ’²sÂöF—cãÆF—b6Æ73Ò&æÖR#âr²†W66T‡FÖÂ‡ææÖR—ÇÆW66T‡FÖÂ‡ç6V7F÷"’’²sÂöF—cãÂöF—cãÆF—b6Æ73Ò&†öÆF–ær×fÇVR#ãÇ7G&öæsâr¶ÖöæW’†Ö&¶WEU4B‡’’²sÂ÷7G&öæsãÇ7â6Æ73Ò"r¶6Ç2‡æÂ’²r#âr¶ÖöæW’‡æÂ’²ròr·&WB²rSÂ÷7ããÂöF—cãÂöF—cãÆF—b6Æ73Ò&†öÆF–ærÖÖWF#ãÇ7ãâr¶W66T‡FÖÂ‡ç6V7F÷"’²sÂ÷7ããÇ7â6Æ73Ò"r¶6Ç2†6†ævR’²r#âr¶6†ævUFW‡B²sÂ÷7ããÂöF—cãÆF—b6Æ73Ò'V÷FRÖÆ–æR#ãÇ7â6Æ73Ò'V÷FR×6÷W&6Rr·&–6U6÷W&6T6Æ72‡’²r#âr¶W66T‡FÖÂ‡6÷W&6R’²sÂ÷7ããÇ6ÖÆÃâr·&÷VæB‡ç&–6RÃB’²rr¶W66T‡FÖÂ‡æ7W'&Væ7’’²sÂ÷6ÖÆÃãÂöF—cãÆF—b6Æ73Ò&†öÆF–ær×&öw&W72#ãÆ’7G–ÆSÒ'v–GFƒ¢r´ÖF‚æÖ–âƒÄÖF‚æÖ‚ƒ"ÇvV–v‡B’’²rS¶&6¶w&÷VæC¢r·fÆ–D6öÆ÷"‡æ6öÆ÷"’²r#ãÂö“ãÂöF—cãÆF—b6Æ73Ò&w&–B6ö×7B#ãÆF—cãÆF—b6Æ73Ò&Æ&VÂ#îh‰iÊÎK¹>KØÓÂöF—cãÆF—b6Æ73Ò'fÇVR#âr·vV–v‡B²rSÂöF—cãÂöF—cãÆF—cãÆF—b6Æ73Ò&Æ&VÂ#îi[˜xóÂöF—cãÆF—b6Æ73Ò'fÇVR#âr·&÷VæB‡ç6†&W2ÃB’²sÂöF—cãÂöF—cãÆF—cãÆF—b6Æ73Ò&Æ&VÂ#î[›>YØ~h‰iÊÃÂöF—cãÆF—b6Æ73Ò'fÇVR#âr·&÷VæB‡æft6÷7BÃB’²rr¶W66T‡FÖÂ‡æ7W'&Væ7’’²sÂöF—cãÂöF—cãÆF—cãÆF—b6Æ73Ò&Æ&VÂ#îh©^XZ^h‰iÊÃÂöF—cãÆF—b6Æ73Ò'fÇVR#âr¶ÖöæW’‡æ6÷7D&6—5U4B’²sÂöF—cãÂöF—cãÂöF—cãÂöF—câp¢Ò’æ¦ö–â‚""§Ð ¦gVæ7F–öâ&VæFW$Ö†öÆF–æuF&ÆR‚—°¢6öç7B&öG“ÒB‚&Ö†öÆF–æt&öG’"“¶–b‚&öG’—&WGW&ã°¢6öç7BF÷FÃÔÖF‚æÖ‚†6öçG&–'WFVD6—FÂ‚’·&VÆ—¦VEæÂ‚’Ã“°¢6öç7B&÷w3×7FFRç÷6—F–öç2ç6Æ–6R‚’ç6÷'B‚†Æ"“ÓæçVÒ†"æ6÷7D&6—5U4B’ÖçVÒ†æ6÷7D&6—5U4B’’æÖ‡Óç°¢6öç7BæÃÖfÆöF–æuæÅU4B‡’ÇvV–v‡C×&÷VæB‡æ6÷7D&6—5U4B÷F÷FÂ£“°¢&WGW&âÇG#ãÇFCãÆ’7G–ÆSÒ&&6¶w&÷VæC¢G·fÆ–D6öÆ÷"‡æ6öÆ÷"—Ò#ãÂö“ãÇ7G&öæsâG¶W66T‡FÖÂ‡ç7–Ö&öÂ—ÓÂ÷7G&öæsãÇ6ÖÆÃâG¶W66T‡FÖÂ‡ç6V7F÷"—ÓÂ÷6ÖÆÃãÂ÷FCãÇFCâG¶ÖöæW’†Ö&¶WEU4B‡’—ÓÂ÷FCãÇFCâG·vV–v‡GÒSÂ÷FCãÇFB6Æ73Ò"G¶6Ç2‡æÂ—Ò#âG¶ÖöæW’‡æÂ—ÓÂ÷FCãÂ÷G#æ ¢Ò’æ¦ö–â‚""“°¢6öç7B66ƒÖ66„&Ææ6R‚“°¢&öG’æ–ææW$…DÔÃ×&÷w2²†66ƒãöÇG#ãÇFCãÆ’7G–ÆSÒ&&6¶w&÷VæC¢G·6V7F÷$&6T6öÆ÷"‚.xë˜y"—Ò#ãÂö“ãÇ7G&öæsä44ƒÂ÷7G&öæsãÇ6ÖÆÃîxë˜yÂ÷6ÖÆÃãÂ÷FCãÇFCâG¶ÖöæW’†66‚—ÓÂ÷FCãÇFCâG·&÷VæB†66‚÷F÷FÂ£—ÒSÂ÷FCãÇFB6Æ73Ò&×WFVB#î(	CÂ÷FCãÂ÷G#æ¢""“°§Ð ¦gVæ7F–öâ&VæFW$ÆÂ‚—·&VæFW$·—2‚“·&VæFW%G&VVÖ‚“·&VæFW%6V7F÷'5c"‚“·&VæFW$Ö†öÆF–æuF&ÆR‚“·&VæFW$6†'Ec"‚“·&VæFW$†öÆF–æt6&G5c"‚“·&VæFW%÷6—F–öåF&ÆR‚“·&VæFW%G&ç67F–öåF&ÆR‚“·&VæFW$66„fÆ÷uF&ÆR‚“·&VæFW$&6·WÆ—7B‚“·&VæFW%6V7F÷$FÖ–åæVÂ‚“²B‚'÷6—F–öä6÷VçB"’çFW‡D6öçFVçC×7FFRç÷6—F–öç2æÆVæwFƒ²B‚'G&ç67F–öä6÷VçB"’çFW‡D6öçFVçC×7FFRçG&ç67F–öç2æÆVæwFƒ²B‚&66„fÆ÷t6÷VçB"’çFW‡D6öçFVçC×7FFRæ66„fÆ÷w2æÆVæwFƒ·7v—F6„ÆVFvW%F"†7F—fTÆVFvW%F"“²B‚'vUF—FÆR"’çFW‡D6öçFVçC×7FFRç6WGF–æw2çF—FÆS¶Fö7VÖVçBçF—FÆS×7FFRç6WGF–æw2çF—FÆS²B‚'F—FÆT–çWB"’çfÇVS×7FFRç6WGF–æw2çF—FÆS²B‚&66†T–çWB"’çfÇVS×7FFRç6WGF–æw2ç&–6T66†TÖ–çWFW3¶–b‚B‚&WW$g„–çWB"’’B‚&WW$g„–çWB"’çfÇVS×7FFRæg…&FW2äUU'ÇÆFVfVÇE7FFRæg…&FW2äUU#¶–b‚B‚'&÷‡”–çWB"’’B‚'&÷‡”–çWB"’çfÇVS×&–6U&÷‡•W&Â‚“·&VæFW%7–æ57FGW2‚“·&VæFW$F–væ÷7F–72‚—Ð¦gVæ7F–öâ†4FÖ–å6W76–öâ‚—¶6öç7BWFƒ×&VD§6öâ‡6W76–öå7F÷&vRævWD—FVÒ„DÔ”åôUD…ô´U’’ÆçVÆÂ“·&WGW&â&ööÆVâ†WFƒòæBbdFFRææ÷r‚’ÖçVÒ†WF‚æB“ÄDÔ”åôUD…õEDÅôÕ2—Ð¦7–æ2gVæ7F–öâF–vW7EFW‡B‡fÇVR—¶6öç7B'—FW3ÖæWrFW‡DVæ6öFW"‚’æVæ6öFR‡fÇVR’Æ†6ƒÖv—B7'—Fòç7V'FÆRæF–vW7B‚%4„Ó#Sb"Æ'—FW2“·&WGW&â²ââææWrV–çC„'&’††6‚•ÒæÖ‡cÓçbçFõ7G&–ærƒb’çE7F'Bƒ"Â#"’’æ¦ö–â‚""—Ð¦gVæ7F–öâ6†÷tFÖ–äÆöv–â‚—¶6öç7BF–ÆösÒB‚&FÖ–äÆöv–äF–Æör"“¶–b†F–ÆörbbF–Æöræ÷Vâ–F–Æörç6†÷tÖöFÂ‚—Ð¦7–æ2gVæ7F–öâfW&–g”FÖ–äÆöv–â†WfVçB—¶WfVçBç&WfVçDFVfVÇB‚“¶6öç7B–çWCÒB‚&FÖ–å77v÷&B"’ÆW'&÷#ÒB‚&FÖ–äÆöv–äW'&÷""’Ç77v÷&CÖ–çWBçfÇVS¶–b‚77v÷&B—¶W'&÷"çFW‡D6öçFVçCÒ.Šû~‹é>XZ^zêynYŽZønz#·&WGW&çÖ–b†v—BF–vW7EFW‡B‡77v÷&B’ÓÔDÔ”åõ55tõ$Eô„4‚—¶W'&÷"çFW‡D6öçFVçCÒ.ZønzKˆÞjÚ>zîûÈÎŠû~˜xÞik‹é>XZR#¶–çWBç6VÆV7B‚“·&WGW&ç×6W76–öå7F÷&vRç6WD—FVÒ„DÔ”åôUD…ô´U’Ä¥4ôâç7G&–æv–g’‡¶C¤FFRææ÷r‚—Ò’“¶Æö6F–öâç&VÆöB‚—Ð¦gVæ7F–öâÆöv÷WDFÖ–â‚—·6W76–öå7F÷&vRç&VÖ÷fT—FVÒ„DÔ”åôUD…ô´U’“¶6öç7BW&ÃÖæWrU$Â†Æö6F–öâæ‡&Vb“·W&Âç6V&6…&×2æFVÆWFR‚&FÖ–â"“¶Æö6F–öâæ‡&Vc×W&ÂçF†æÖR·W&Âç6V&6‡Ð¦gVæ7F–öâ–æ—DFÖ–äÖöFR‚—¶FÖ–ä66W75&WVW7FVCÖæWrU$Å6V&6…&×2†Æö6F–öâç6V&6‚’ævWB‚&FÖ–â"“ÓÓÒ##¶—4FÖ–äÖöFSÖFÖ–ä66W75&WVW7FVBbf†4FÖ–å6W76–öâ‚“¶Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"æFÖ–âÖöæÇ’"’æf÷$V6‚†VÃÓæVÂæ6Æ74Æ—7BçFövvÆR‚&†–FFVâ"Â—4FÖ–äÖöFR’“¶Fö7VÖVçBæ&öG’æ6Æ74Æ—7BçFövvÆR‚'f–WvW"ÖÖöFR"Â—4FÖ–äÖöFR“¶–b†FÖ–ä66W75&WVW7FVBbb—4FÖ–äÖöFR—6WEF–ÖV÷WB‡6†÷tFÖ–äÆöv–âÃ—Ð¦gVæ7F–öâ6äWFõ&Vg&W6…&–6W2‚—·&WGW&âæf–vF÷"æöäÆ–æRbfFö7VÖVçBçf—6–&–Æ—G•7FFRÓÒ&†–FFVâ"bb&–6U&÷‡•W&Â‚—Ð¦gVæ7F–öâ¶–6´WFõ&Vg&W6‚†f÷&6SÖfÇ6R—°¢–b‚6äWFõ&Vg&W6…&–6W2‚’—&WGW&ã°¢6öç7Bæ÷sÔFFRææ÷r‚“°¢–b‚f÷&6Rbfæ÷rÖÆ7DWFõ&Vg&W6„¶–6³Å$U5TÔUõ$Te$U4…ôtôÕ2—&WGW&ã°¢–b‚†Ö&¶WD6Æö6µ7FFSòæ—4÷VçÇÆÖ&¶WD6Æö6µ7FFSòç†6SÓÓÒ&÷Vâ"’—¶Æ7DWFõ&Vg&W6„¶–6³Öæ÷s·&Vg&W6„Æ7D6Æ÷6U&–6W2†Ö&¶WD6Æö6µ7FFWÇÆÖ&¶WD6Æö6²‚’“·&WGW&çÐ¢–b‚f÷&6Rbg&–6T66†UfÆ–B‚’—¶Ç•&–6T66†R‚“·&VæFW$ÆÂ‚“·&WGW&çÐ¢Æ7DWFõ&Vg&W6„¶–6³Öæ÷s°¢&Vg&W6…&–6W2†fÇ6R“°§Ð¦gVæ7F–öâ–æ—DWFõ&Vg&W6„†öö·2‚—°¢–b†WFõ&Vg&W6…F–ÖW"–6ÆV$–çFW'fÂ†WFõ&Vg&W6…F–ÖW"“°¢–b‡6†&VDFFF–ÖW"–6ÆV$–çFW'fÂ‡6†&VDFFF–ÖW"“°¢6†&VDFFF–ÖW#×6WD–çFW'fÂ‚‚“Óæ6†V6µ6†&VDFFWFFR†fÇ6R’Å4„$TEôDDô4„T4µôÕ2“°¢WFõ&Vg&W6…F–ÖW#×6WD–çFW'fÂ‚‚“Óç¶–b†Fö7VÖVçBçf—6–&–Æ—G•7FFSÓÓÒ'f—6–&ÆR"—&Vg&W6„Ö&¶WD6Æö6²‚’çF†Vâ‚‚“Óæ¶–6´WFõ&Vg&W6‚†fÇ6R’—ÒÄUDõõ$Te$U4…ô4„T4µôÕ2“°¢Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚'f—6–&–Æ—G–6†ævR"Â‚“Óç¶–b†Fö7VÖVçBçf—6–&–Æ—G•7FFSÓÓÒ'f—6–&ÆR"—¶6†V6µ6†&VDFFWFFR‡G'VR“·&Vg&W6„Ö&¶WD6Æö6²‚’çF†Vâ‚‚“Óæ¶–6´WFõ&Vg&W6‚‡G'VR’—×Ò“°¢v–æF÷ræFDWfVçDÆ—7FVæW"‚&fö7W2"Â‚“Óç¶6†V6µ6†&VDFFWFFR‡G'VR“·&Vg&W6„Ö&¶WD6Æö6²‚’çF†Vâ‚‚“Óæ¶–6´WFõ&Vg&W6‚†fÇ6R’—Ò“°¢v–æF÷ræFDWfVçDÆ—7FVæW"‚'vW6†÷r"Â‚“Óæ6†V6µ6†&VDFFWFFR†fÇ6R’“°§Ð§v–æF÷ræFDWfVçDÆ—7FVæW"‚'&W6—¦R"Â‚“Óç·&VæFW%G&VVÖ‚“·&VæFW$6†'Ec"‚—Ò“°§v–æF÷ræFDWfVçDÆ—7FVæW"‚&&Vf÷&WVæÆöB"ÆWfVçCÓç¶–b†F—'G’—¶WfVçBç&WfVçDFVfVÇB‚“¶WfVçBç&WGW&åfÇVSÒ"'×Ò“°§v–æF÷ræFDWfVçDÆ—7FVæW"‚&öæÆ–æR"Â‚“Óç·WFFTæWGv÷&µ7FGW2‚“¶6†V6µ6†&VDFFWFFR‡G'VR—Ò“°§v–æF÷ræFDWfVçDÆ—7FVæW"‚&öffÆ–æR"ÇWFFTæWGv÷&µ7FGW2“°§v–æF÷ræFDWfVçDÆ—7FVæW"‚&&Vf÷&V–ç7FÆÇ&ö×B"ÆWfVçCÓç¶WfVçBç&WfVçDFVfVÇB‚“¶FVfW'&VD–ç7FÆÅ&ö×CÖWfVçC·WFFT–ç7FÆÄ'WGFöâ‚—Ò“°§v–æF÷ræFDWfVçDÆ—7FVæW"‚&–ç7FÆÆVB"Â‚“Óç¶FVfW'&VD–ç7FÆÅ&ö×CÖçVÆÃ²B‚&–ç7FÆÄF–Æör"“òæ6Æ÷6R‚“·WFFT–ç7FÆÄ'WGFöâ‚—Ò“°¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚$DôÔ6öçFVçDÆöFVB"Â‚“Óç°¢–æ—DFÖ–äÖöFR‚“¶f–ÆÄFÖ–â‚“¶æ÷&ÖÆ—¦U7FFR†FVfVÇE7FFR“·&VæFW$ÆÂ‚“·WFFTæWGv÷&µ7FGW2‚“·WFFT–ç7FÆÄ'WGFöâ‚“·&Vv—7FW%v‚“°¢–æ—DWFõ&Vg&W6„†öö·2‚“°¢&Vg&W6…v÷&¶W$†VÇF‚‚“°¢²'G&FU6†&W2"Â'G&FU&–6R"Â'G&FTg‚"Â'G&FTfVR%Òæf÷$V6‚†–CÓâB†–B’æFDWfVçDÆ—7FVæW"‚&–çWB"ÇWFFUG&FU&Wf–Wr’“²B‚'G&FU7–Ö&öÂ"’æFDWfVçDÆ—7FVæW"‚&–çWB"Ç7–æ5G&FU7–Ö&öÂ“²B‚'G&FU7–Ö&öÂ"’æFDWfVçDÆ—7FVæW"‚&6†ævR"Ç7–æ5G&FU7–Ö&öÂ“²B‚'G&FTæÖR"’æFDWfVçDÆ—7FVæW"‚&–çWB"Â‚“Óç¶–b‡G&FU6V7F÷$WF÷ÇÇG&FT6öÆ÷$WFò—7–æ5G&FU7–Ö&öÂ‚“¶VÇ6RWFFUG&FU&Wf–Wr‚—Ò“²B‚'G&FU6V7F÷""’æFDWfVçDÆ—7FVæW"‚&–çWB"Â‚“Óç·G&FU6V7F÷$WFóÖfÇ6S¶–b‡G&FT6öÆ÷$WFò—¶6öç7B6V7F÷#Ö–æfW%6V7F÷"‚B‚'G&FU7–Ö&öÂ"’çfÇVRÂB‚'G&FTæÖR"’çfÇVRÂB‚'G&FU6V7F÷""’çfÇVR“²B‚'G&FT6öÆ÷""’çfÇVSÖ6öÆ÷$f÷%6V7F÷$ÖVÖ&W"‡6V7F÷"Ç7FFRç÷6—F–öç2æf–ÇFW"‡ƒÓæ–æfW%6V7F÷"‡‚ç7–Ö&öÂÇ‚ææÖRÇ‚ç6V7F÷"“ÓÓ×6V7F÷"’æÆVæwF‚—×WFFUG&FU&Wf–Wr‚—Ò“²B‚'G&FT6öÆ÷""’æFDWfVçDÆ—7FVæW"‚&–çWB"Â‚“Óç·G&FT6öÆ÷$WFóÖfÇ6S·WFFUG&FU&Wf–Wr‚—Ò“²B‚'G&FT7W'&Væ7’"’æFDWfVçDÆ—7FVæW"‚&6†ævR"Â‚“Óç²B‚'G&FTg‚"’çfÇVSÖg‚‚B‚'G&FT7W'&Væ7’"’çfÇVR“·WFFUG&FU&Wf–Wr‚—Ò“°¢ÆöE6†&VDFF‡G'VR“°§Ò“° Ð Ð Ð Ð 