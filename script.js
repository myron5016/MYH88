const VERSION="V10.1 PWA家庭版";
const STATE_KEY="v9_last_state";
const BACKUP_KEY="v9_backups";
const PRICE_CACHE_KEY="v9_price_cache";
const FX_CACHE_KEY="v9_fx_cache";
const MARKET_KEY="v9_market_key";
const PAGE_SIZE=20;
const FETCH_TIMEOUT_MS=12000;
const AUTO_REFRESH_CHECK_MS=5*60000;
const RESUME_REFRESH_GAP_MS=20000;

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
let lastAutoRefreshKick=0;

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
function marketKey(){return localStorage.getItem(MARKET_KEY)||state.settings?.publicMarketKey||state.settings?.apiKey||""}
function priceProxyUrl(){return String(state.settings?.priceProxyUrl||localStorage.getItem("v10_price_proxy")||"").trim().replace(/\/+$/,"")}
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
    if(swRegistration.waiting)showUpdateBanner();
    swRegistration.addEventListener("updatefound",()=>{const worker=swRegistration.installing;if(!worker)return;worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller)showUpdateBanner()})});
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(updateReloading)return;updateReloading=true;location.reload()});
  }catch(error){console.warn("PWA 注册失败",error)}
}

function normalizePosition(p){
  p.id=p.id||uid("pos");p.symbol=String(p.symbol||"").trim().toUpperCase();p.name=String(p.name||"");p.currency=String(p.currency||"USD").toUpperCase();p.source=p.source==="manual"?"manual":"twelve";p.shares=num(p.shares);p.avgCost=num(p.avgCost);p.price=num(p.price);p.sector=String(p.sector||"未分类");p.color=validColor(p.color);p.note=String(p.note||"");
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
  state={...structuredClone(defaultState),...(raw||{})};
  state.settings={...defaultState.settings,...(state.settings||{}),version:VERSION};
  if(state.settings.apiKey&&!state.settings.publicMarketKey)state.settings.publicMarketKey=String(state.settings.apiKey);
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
    const shared=await response.json(),versionChanged=shared?.settings?.version!==VERSION;normalizeState(shared);applyPriceCache();cloudState=structuredClone(state);const snapshotChanged=isAdminMode?captureSnapshot(false):false;dirty=isAdminMode&&(versionChanged||snapshotChanged);lastMutationReason=isAdminMode?(versionChanged?"账本已升级到 V10，等待首次安全保存":snapshotChanged?"今日资产快照":""):"";saveLocal();renderAll();renderSyncStatus();
    status.textContent=navigator.onLine?`已读取共享数据：${new Date().toLocaleString("zh-CN")}`:"离线模式：已读取设备中最近缓存的数据";
    if(admin.owner&&admin.repo&&admin.token)checkCloudStatus(false);if(autoRefresh)refreshPrices(true);
  }catch(error){
    console.warn("共享数据读取失败",error);
    const cached=localStorage.getItem(STATE_KEY)||localStorage.getItem("v8_last_state");
    if(cached){normalizeState(readJson(cached,defaultState));applyPriceCache();dirty=true;lastMutationReason="正在使用本机缓存";renderAll();status.textContent="读取失败，已使用本机缓存"}
    else{normalizeState(defaultState);dirty=true;lastMutationReason="云端读取失败";renderAll();status.textContent="读取失败，已使用默认数据"}
    renderSyncStatus();
  }
}

function saveLocal(){localStorage.setItem(STATE_KEY,JSON.stringify(state))}
function markDirty(reason="本地数据已修改"){dirty=true;lastMutationReason=reason;state.settings.localUpdatedAt=new Date().toISOString();saveLocal();renderSyncStatus()}
function summaryOf(s){return{positions:Array.isArray(s?.positions)?s.positions.length:0,transactions:Array.isArray(s?.transactions)?s.transactions.length:0,cashFlows:Array.isArray(s?.cashFlows)?s.cashFlows.length:0,snapshots:Array.isArray(s?.snapshots)?s.snapshots.length:0}}
function dangerBetween(local,remote){const l=summaryOf(local),r=summaryOf(remote),reasons=[];if(l.transactions<r.transactions)reasons.push(`交易流水从 ${r.transactions} 条减少到 ${l.transactions} 条`);if(l.cashFlows<r.cashFlows)reasons.push(`资金流水从 ${r.cashFlows} 条减少到 ${l.cashFlows} 条`);if(!l.positions&&r.positions&&l.transactions<=r.transactions)reasons.push(`当前持仓从 ${r.positions} 个变成 0 个`);return reasons}
function renderSyncStatus(mode=""){
  const dot=$("syncDot"),label=$("syncLabel"),detail=$("syncDetail");if(!dot||!label||!detail)return;
  dot.className="sync-dot";
  if(mode==="checking"){dot.classList.add("checking");label.textContent="正在核对云端数据";detail.textContent="读取 GitHub 最新账本…";return}
  const danger=cloudState?dangerBetween(state,cloudState):[];
  if(danger.length){dot.classList.add("danger");label.textContent="已阻止危险覆盖";detail.textContent=danger.join("；");return}
  if(dirty){dot.classList.add("dirty");label.textContent="有尚未保存的本地修改";detail.textContent=lastMutationReason||"保存到 GitHub 后其他设备才能看到";return}
  dot.classList.add("clean");label.textContent=cloudState?"账本已与 GitHub 同步":"已载入账本";detail.textContent=state.settings.lastCloudSaveAt?`上次云端保存：${new Date(state.settings.lastCloudSaveAt).toLocaleString("zh-CN")}`:"当前没有未保存修改";
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
async function refreshFx(force=false){
  const proxy=priceProxyUrl(),key=marketKey();if(!proxy&&!key)return;const cached=getFxCache();if(!force&&cached?.time&&Date.now()-cached.time<24*3600000){state.fxRates={...state.fxRates,...cached.fxRates,USD:1};return}
  const currencies=[...new Set(state.positions.map(p=>p.currency).filter(c=>c!=="USD"))];
  if(proxy&&currencies.length){const res=await fetchJson(`${proxy}/fx?currencies=${encodeURIComponent(currencies.join(","))}`);state.fxRates={...state.fxRates,...(res.rates||{}),USD:1}}
  else for(const c of currencies){const res=await fetchJson(`https://api.twelvedata.com/exchange_rate?symbol=${c}/USD&apikey=${encodeURIComponent(key)}`);if(res.rate)state.fxRates[c]=num(res.rate)}
  state.fxRates.USD=1;localStorage.setItem(FX_CACHE_KEY,JSON.stringify({time:Date.now(),fxRates:state.fxRates}));
}
async function fetchQuoteBatch(symbols,key){
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const proxy=priceProxyUrl();
      const res=proxy?await fetchJson(`${proxy}/quotes?symbols=${encodeURIComponent(symbols.join(","))}`):await fetchJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${encodeURIComponent(key)}`);
      if(res.code||res.status==="error")throw new Error(res.message||"Twelve Data 错误");
      return res;
    }catch(error){
      lastError=error;
      await new Promise(resolve=>setTimeout(resolve, attempt*900));
    }
  }
  throw lastError;
}
async function refreshPrices(useCache=true){
  if(priceRefreshPromise)return priceRefreshPromise;
  priceRefreshPromise=doRefreshPrices(useCache).finally(()=>{priceRefreshPromise=null});
  return priceRefreshPromise;
}
async function doRefreshPrices(useCache=true){
  const status=$("status"),button=$("refreshButton"),key=marketKey(),proxy=priceProxyUrl();
  if(!navigator.onLine){status.textContent="当前离线，无法刷新行情；正在显示最近缓存价格";return}
  if(useCache&&priceCacheValid()){applyPriceCache();renderAll();status.textContent="已使用缓存行情："+(state.settings.lastPriceRefreshText||"");return}
  if(!proxy&&!key){status.textContent="刷新失败：管理员需要先填写 Cloudflare Worker 行情代理地址，或 Twelve Data Key";if(!useCache)alert(status.textContent);return}
  status.textContent=proxy?"正在通过行情代理刷新实时价格...":"正在通过 Twelve Data 刷新实时价格...";if(button)button.disabled=true;
  try{
    await refreshFx(false);const items=state.positions.filter(p=>p.source==="twelve"&&p.symbol),symbols=[...new Set(items.map(p=>p.symbol))];
    if(symbols.length){
      const res=await fetchQuoteBatch(symbols,key);
      items.forEach(p=>{const q=symbols.length===1?res:res[p.symbol];const price=num(q?.close||q?.price);if(price>0)p.price=price;p.changePercent=num(q?.percent_change)});
    }
    state.settings.lastPriceRefresh=Date.now();state.settings.lastPriceRefreshText=new Date().toLocaleString("zh-CN");savePriceCache();
    if(isAdminMode){captureSnapshot(false);markDirty("实时行情与今日快照已更新")}else saveLocal();
    renderAll();status.textContent=isAdminMode?"已刷新："+state.settings.lastPriceRefreshText+"。保存到 GitHub 后家人可见":"已刷新："+state.settings.lastPriceRefreshText+"。本次价格已缓存在本设备";
  }catch(error){applyPriceCache();renderAll();status.textContent="行情刷新失败，已保留最近行情："+friendlyFetchError(error);if(!useCache)alert(status.textContent)}finally{if(button)button.disabled=false}
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
function saveSettings(){state.settings.title=$("titleInput").value.trim()||defaultState.settings.title;state.settings.priceCacheMinutes=Math.max(5,num($("cacheInput").value)||30);const proxy=$("proxyInput")?.value.trim()||"";if(proxy){localStorage.setItem("v10_price_proxy",proxy);state.settings.priceProxyUrl=proxy}else{localStorage.removeItem("v10_price_proxy");delete state.settings.priceProxyUrl}const key=$("apiKeyInput").value.trim();if(key){localStorage.setItem(MARKET_KEY,key);state.settings.publicMarketKey=key}else{localStorage.removeItem(MARKET_KEY);delete state.settings.publicMarketKey}markDirty("看板设置已修改，行情代理地址会随下次 GitHub 保存共享给访客");renderAll();alert("设置已应用。安全保存到 GitHub 后，家人访问页面会通过 Cloudflare Worker 行情代理刷新。")}

function treemapItems(){const arr=state.positions.map(p=>({label:p.symbol,value:num(p.costBasisUSD),color:p.color})).filter(x=>x.value>0),cash=cashBalance();if(cash>0)arr.push({label:"CASH",value:cash,color:"#ffd84d"});return arr.sort((a,b)=>b.value-a.value)}
function layout(items,x,y,w,h){if(!items.length)return[];if(items.length===1)return[{...items[0],x,y,w,h}];const total=items.reduce((s,i)=>s+i.value,0);let acc=0,split=0;for(let i=0;i<items.length;i++){if(acc<total/2){acc+=items[i].value;split=i+1}}split=Math.max(1,Math.min(items.length-1,split));const a=items.slice(0,split),b=items.slice(split),at=a.reduce((s,i)=>s+i.value,0);if(w>=h){const aw=w*at/total;return[...layout(a,x,y,aw,h),...layout(b,x+aw,y,w-aw,h)]}const ah=h*at/total;return[...layout(a,x,y,w,ah),...layout(b,x,y+ah,w,h-ah)]}
function renderTreemap(){const box=$("treemap");box.innerHTML="";const rect=box.getBoundingClientRect(),items=treemapItems(),denom=Math.max(contributedCapital()+realizedPnl(),1);layout(items,0,0,rect.width,rect.height).forEach(t=>{const d=document.createElement("div"),area=t.w*t.h;d.className="tile"+(area<13000?" tiny":"");Object.assign(d.style,{left:t.x+"px",top:t.y+"px",width:t.w+"px",height:t.h+"px",background:t.color,color:["#ffd84d","#eeee00","#f1a2ef"].includes(t.color)?"#07101a":"white"});d.innerHTML=`<div>${escapeHtml(t.label)}<small>${money(t.value)}｜${round(t.value/denom*100)}%</small></div>`;box.appendChild(d)})}
function sectorItems(){const map={};state.positions.forEach(p=>{const key=p.sector||"未分类";if(!map[key])map[key]={label:key,total:0,pnl:0,color:p.color};map[key].total+=num(p.costBasisUSD);map[key].pnl+=floatingPnlUSD(p)});const cash=cashBalance();if(cash>0)map["现金"]={label:"现金",total:cash,pnl:0,color:"#ffd84d"};return Object.values(map).sort((a,b)=>b.total-a.total)}
function renderSectors(){const bar=$("sectorBar"),legend=$("sectorLegend"),total=Math.max(contributedCapital()+realizedPnl(),1);bar.innerHTML="";legend.innerHTML="";sectorItems().forEach(s=>{const seg=document.createElement("div");seg.className="segment";seg.style.width=Math.max(3,s.total/total*100)+"%";seg.style.background=s.color;seg.textContent=`${s.label} ${round(s.total/total*100)}%`;bar.appendChild(seg);legend.insertAdjacentHTML("beforeend",`<span><i class="dot" style="background:${validColor(s.color)}"></i>${escapeHtml(s.label)} ${money(s.total)} <b class="${cls(s.pnl)}">${money(s.pnl)}</b></span>`)})}
function renderKpis(){$("kpiCapital").textContent=money(contributedCapital());$("kpiNetAsset").textContent=money(netAsset());$("kpiMarket").textContent=money(marketTotal());$("kpiCash").textContent=money(cashBalance());$("kpiCash").className=cls(cashBalance());if($("kpiRealized")){$("kpiRealized").textContent=money(realizedPnl());$("kpiRealized").className=cls(realizedPnl())}$("kpiFloating").textContent=`${money(floatingPnl())} / ${round(floatingReturn())}%`;$("kpiFloating").className=cls(floatingPnl());$("kpiPnl").textContent=`${money(totalPnl())} / ${round(totalReturn())}%`;$("kpiPnl").className=cls(totalPnl())}function renderHoldingCards(){const box=$("holdingCards");if(!state.positions.length){box.innerHTML='<div class="empty">暂无当前持仓</div>';return}box.innerHTML=state.positions.slice().sort((a,b)=>num(b.costBasisUSD)-num(a.costBasisUSD)).map(p=>`<div class="holding-card"><div class="top"><div><div class="symbol">${escapeHtml(p.symbol)}</div><div class="name">${escapeHtml(p.name)}</div></div><div class="sector-pill">${escapeHtml(p.sector)}</div></div><div class="grid"><div><div class="label">数量</div><div class="value">${round(p.shares,4)}</div></div><div><div class="label">最新价</div><div class="value">${round(p.price,4)} ${escapeHtml(p.currency)}</div></div><div><div class="label">单股成本</div><div class="value">${round(p.avgCost,4)} ${escapeHtml(p.currency)}</div></div><div><div class="label">投入成本</div><div class="value">${money(p.costBasisUSD)}</div></div><div><div class="label">市值</div><div class="value">${money(marketUSD(p))}</div></div><div><div class="label">成本仓位</div><div class="value">${round(p.costBasisUSD/Math.max(contributedCapital()+realizedPnl(),1)*100)}%</div></div><div><div class="label">浮动盈亏</div><div class="value ${cls(floatingPnlUSD(p))}">${money(floatingPnlUSD(p))} / ${round(p.costBasisUSD?floatingPnlUSD(p)/p.costBasisUSD*100:0)}%</div></div></div></div>`).join("")}function captureSnapshot(manual=false){const date=today(),snap={date,capital:round(contributedCapital()),netAsset:round(netAsset()),market:round(marketTotal()),cash:round(cashBalance())},i=state.snapshots.findIndex(x=>x.date===date),before=i>=0?JSON.stringify(state.snapshots[i]):"",changed=before!==JSON.stringify(snap);if(i>=0)state.snapshots[i]=snap;else state.snapshots.push(snap);state.snapshots.sort((a,b)=>a.date.localeCompare(b.date));saveLocal();if(manual){markDirty("今日资产快照已记录");renderChart();alert("今日资产快照已记录，尚未保存到 GitHub")}return changed}
function renderChart(){const svg=$("assetChart"),data=state.snapshots.slice(-120);if(data.length<2){svg.classList.add("hidden");$("chartEmpty").classList.remove("hidden");return}svg.classList.remove("hidden");$("chartEmpty").classList.add("hidden");const W=1200,H=250,pad={l:62,r:20,t:20,b:30},values=data.flatMap(x=>[num(x.netAsset),num(x.capital)]),min=Math.min(...values),max=Math.max(...values),range=Math.max(max-min,1),x=i=>pad.l+i*(W-pad.l-pad.r)/Math.max(data.length-1,1),y=v=>pad.t+(max-v)*(H-pad.t-pad.b)/range,path=key=>data.map((d,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(num(d[key])).toFixed(1)).join(" "),area=`${path("netAsset")} L ${x(data.length-1)} ${H-pad.b} L ${x(0)} ${H-pad.b} Z`;let grid="";for(let i=0;i<4;i++){const val=max-range*i/3,yy=y(val);grid+=`<line class="chart-grid" x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/><text class="chart-label" x="4" y="${yy+4}">${money(val)}</text>`}svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.innerHTML=`<defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4f9a" stop-opacity=".25"/><stop offset="1" stop-color="#ff4f9a" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-capital" d="${path("capital")}"/><path class="chart-asset" d="${path("netAsset")}"/><circle class="chart-dot" cx="${x(data.length-1)}" cy="${y(data.at(-1).netAsset)}" r="5"/><text class="chart-label" x="${pad.l}" y="${H-5}">${escapeHtml(data[0].date)}</text><text class="chart-label" text-anchor="end" x="${W-pad.r}" y="${H-5}">${escapeHtml(data.at(-1).date)}</text>`}

function renderPositionTable(){const q=$("positionSearch")?.value.trim().toUpperCase()||"",items=state.positions.filter(p=>!q||p.symbol.includes(q)||p.name.toUpperCase().includes(q));$("positionBody").innerHTML=items.length?items.map(p=>`<tr><td class="asset-cell"><strong>${escapeHtml(p.symbol)}</strong><small>${escapeHtml(p.name)} · ${escapeHtml(p.currency)}</small></td><td>${round(p.shares,4)}</td><td>${round(p.avgCost,4)} ${escapeHtml(p.currency)}</td><td>${money(p.costBasisUSD)}</td><td>${money(marketUSD(p))}</td><td class="${cls(floatingPnlUSD(p))}">${money(floatingPnlUSD(p))}</td><td>${escapeHtml(p.sector)}</td><td>${isAdminMode?`<div class="row-buttons"><button onclick="openTrade('buy','${p.id}')">买入</button><button onclick="openTrade('sell','${p.id}')">卖出</button><button onclick="editPosition('${p.id}')">编辑</button></div>`:"—"}</td></tr>`).join(""):'<tr><td colspan="8" class="muted">没有匹配的持仓</td></tr>'}function transactionLabel(t){if(t.voided)return"已撤销";return t.type==="buy"?"买入":t.type==="sell"?"卖出":"V8 期初"}
function latestCorrectableTransaction(){return state.transactions.slice().reverse().find(t=>["buy","sell"].includes(t.type)&&!t.voided&&Object.prototype.hasOwnProperty.call(t,"positionBefore"))||null}
function renderTransactionTable(){const q=$("transactionSearch")?.value.trim().toUpperCase()||"",type=$("transactionTypeFilter")?.value||"all",latest=latestCorrectableTransaction(),filtered=state.transactions.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).filter(t=>(!q||String(t.symbol).includes(q))&&(type==="all"||t.type===type)),pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));transactionPage=Math.min(transactionPage,pages);const items=filtered.slice((transactionPage-1)*PAGE_SIZE,transactionPage*PAGE_SIZE);$("transactionBody").innerHTML=items.length?items.map(t=>`<tr class="${t.voided?"muted":""}"><td>${escapeHtml(t.date)}</td><td><span class="type-pill">${transactionLabel(t)}</span></td><td><strong>${escapeHtml(t.symbol)}</strong></td><td>${round(t.shares,4)}</td><td>${round(t.price,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fee,4)} ${escapeHtml(t.currency)}</td><td>${round(t.fxRate,6)}</td><td class="${t.voided?"muted":cls(t.realizedPnlUSD)}">${t.type==="sell"?money(t.realizedPnlUSD):"—"}</td><td>${escapeHtml(t.note||"")}</td><td>${isAdminMode&&latest?.id===t.id?`<div class="correction-buttons"><button onclick="correctLastTransaction('${t.id}')">更正</button><button class="danger" onclick="undoLastTransaction('${t.id}')">撤销</button></div>`:"—"}</td></tr>`).join(""):'<tr><td colspan="10" class="muted">暂无交易记录</td></tr>';$("transactionPager").innerHTML=`<button ${transactionPage<=1?"disabled":""} onclick="transactionPage--;renderTransactionTable()">上一页</button><span>${transactionPage} / ${pages} · 共 ${filtered.length} 条</span><button ${transactionPage>=pages?"disabled":""} onclick="transactionPage++;renderTransactionTable()">下一页</button>`}function renderCashFlowTable(){$("cashFlowBody").innerHTML=state.cashFlows.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(x=>`<tr class="${x.voided?"muted":""}"><td>${escapeHtml(x.date)}</td><td>${x.voided?"已作废":x.type==="withdraw"?"提取本金":"追加本金"}</td><td class="${x.voided?"muted":x.type==="withdraw"?"red":"green"}">${x.type==="withdraw"?"-":"+"}${money(x.amountUSD)}</td><td>${escapeHtml(x.note||"")}</td><td>${x.migration||x.voided?"—":`<button class="danger" onclick="deleteCashFlow('${x.id}')">作废</button>`}</td></tr>`).join("")}
function switchLedgerTab(tab){if(!isAdminMode&&["cashflows","backup"].includes(tab))tab="transactions";activeLedgerTab=tab;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));["positions","transactions","cashflows","backup"].forEach(x=>$(x+"Pane").classList.toggle("hidden",x!==tab));if(tab==="backup")renderBackupList()}
function fillTradeFromPosition(p){if(!p)return;$("tradeSymbol").value=p.symbol;$("tradeName").value=p.name;$("tradeCurrency").value=p.currency;$("tradeFx").value=fx(p.currency);$("tradePrice").value=p.price||p.avgCost;$("tradeSource").value=p.source;$("tradeSector").value=p.sector;$("tradeColor").value=p.color;updateTradePreview()}
function openTrade(type,positionId=""){$("tradeType").value=type;$("tradeTitle").textContent=type==="buy"?"记录买入":"记录卖出";$("tradeDate").value=today();$("tradeSymbol").value="";$("tradeShares").value="";$("tradePrice").value="";$("tradeFee").value="0";$("tradeCurrency").value="USD";$("tradeFx").value="1";$("tradeName").value="";$("tradeSector").value="未分类";$("tradeColor").value="#38bdf8";$("tradeSource").value="twelve";$("tradeNote").value="";const existing=state.positions.find(p=>p.id===positionId);if(existing)fillTradeFromPosition(existing);["sourceLabel","nameLabel","sectorLabel","colorLabel"].forEach(id=>$(id).classList.toggle("hidden",type==="sell"));updateTradePreview();$("tradeDialog").showModal();setTimeout(()=>$("tradeSymbol").focus(),30)}
function syncTradeSymbol(){const symbol=$("tradeSymbol").value.trim().toUpperCase(),p=state.positions.find(x=>x.symbol===symbol);if(p)fillTradeFromPosition(p);else{$("tradeFx").value=fx($("tradeCurrency").value)}updateTradePreview()}
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

function renderAll(){renderKpis();renderTreemap();renderSectors();renderChart();renderHoldingCards();renderPositionTable();renderTransactionTable();renderCashFlowTable();renderBackupList();$("positionCount").textContent=state.positions.length;$("transactionCount").textContent=state.transactions.length;$("cashFlowCount").textContent=state.cashFlows.length;$("pageTitle").textContent=state.settings.title;document.title=state.settings.title;$("titleInput").value=state.settings.title;$("cacheInput").value=state.settings.priceCacheMinutes;if($("proxyInput"))$("proxyInput").value=priceProxyUrl();$("apiKeyInput").value=marketKey();renderSyncStatus()}
function initAdminMode(){isAdminMode=new URLSearchParams(location.search).get("admin")==="1";document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdminMode));document.body.classList.toggle("viewer-mode",!isAdminMode)}
function canAutoRefreshPrices(){return navigator.onLine&&document.visibilityState!=="hidden"&&(priceProxyUrl()||marketKey())}
function kickAutoRefresh(force=false){
  if(!canAutoRefreshPrices())return;
  const now=Date.now();
  if(!force&&now-lastAutoRefreshKick<RESUME_REFRESH_GAP_MS)return;
  if(!force&&priceCacheValid()){applyPriceCache();renderAll();return}
  lastAutoRefreshKick=now;
  refreshPrices(true);
}
function initAutoRefreshHooks(){
  if(autoRefreshTimer)clearInterval(autoRefreshTimer);
  autoRefreshTimer=setInterval(()=>kickAutoRefresh(false),AUTO_REFRESH_CHECK_MS);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")kickAutoRefresh(false)});
  window.addEventListener("focus",()=>kickAutoRefresh(false));
  window.addEventListener("pageshow",event=>kickAutoRefresh(!!event.persisted));
}
window.addEventListener("resize",renderTreemap);
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue=""}});
window.addEventListener("online",()=>{updateNetworkStatus();kickAutoRefresh(true)});
window.addEventListener("offline",updateNetworkStatus);
window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstallPrompt=event;updateInstallButton()});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;$("installDialog")?.close();updateInstallButton()});
document.addEventListener("DOMContentLoaded",()=>{
  initAdminMode();fillAdmin();normalizeState(defaultState);renderAll();updateNetworkStatus();updateInstallButton();registerPwa();
  initAutoRefreshHooks();
  ["tradeShares","tradePrice","tradeFx","tradeFee"].forEach(id=>$(id).addEventListener("input",updateTradePreview));$("tradeSymbol").addEventListener("change",syncTradeSymbol);$("tradeCurrency").addEventListener("change",()=>{$("tradeFx").value=fx($("tradeCurrency").value);updateTradePreview()});
  loadSharedData(true);
});




