function marketRouteLabel(){
  const provider=marketProviderLabel();
  if(lastMarketRoute==="proxy")return provider?`行情：${provider} 代理`:"行情：代理线路";
  if(lastMarketRoute==="fallback")return provider?`行情：${provider} 备用`:"行情：备用线路";
  if(lastMarketRoute==="direct")return"行情：直连线路";
  if(lastMarketRoute==="last-close")return"行情：上个交易日收盘价";
  if(lastMarketRoute==="cache")return"行情：本机缓存";
  if(lastMarketRoute==="static")return"行情：静态缓存";
  if(lastMarketRoute==="failed")return"行情：刷新失败";
  return"行情：等待刷新";
}
function deploymentFingerprint(){
  const frontend=buildMeta.release||RELEASE,sw=serviceWorkerVersion||"检测中",worker=workerHealth?.version||"检测中";
  const expected=[frontend,buildMeta.serviceWorker||frontend,buildMeta.worker||frontend].filter(Boolean);
  const actual=[frontend,serviceWorkerVersion,workerHealth?.version].filter(Boolean);
  const mismatch=actual.some(version=>!expected.includes(version));
  return{label:`版本：V${frontend} · SW ${sw} · Worker ${worker}`,mismatch};
}
function renderDiagnostics(){
  const version=$("versionStatus"),route=$("marketRouteStatus"),clock=$("marketClockStatus"),cloud=$("cloudFreshStatus");
  if(version){const fingerprint=deploymentFingerprint();version.textContent=fingerprint.label;version.classList.toggle("version-mismatch",fingerprint.mismatch)}
  if(route)route.textContent=marketRouteLabel();
  if(clock)clock.textContent=marketClockDisplay(marketClockState||marketClock());
  if(cloud)cloud.textContent=isAdminMode?(cloudState?"账本：已核对 GitHub":"账本：等待核对"):(cloudState?"账本：云端最新":"账本：本机缓存");
  renderMarketAdminPanel();
}
function yesNo(value){return value?"正常":"异常"}
function autoRefreshPlan(){
  const clock=marketClockState||marketClock();
  if(!navigator.onLine)return"离线：不刷新";
  if(clock.isOpen||clock.phase==="open")return"盘中：自动实时刷新";
  return"休市：读取上个交易日收盘价";
}
function renderMarketAdminPanel(){
  const box=$("marketAdminGrid");if(!box)return;
  const live=[...new Set(state.positions.filter(p=>p.source==="twelve"&&p.symbol).map(p=>p.symbol))];
  const manual=state.positions.filter(p=>p.source==="manual").map(p=>p.symbol).filter(Boolean);
  const sourceCounts=quoteSourceSummary();
  const health=workerHealth||{};
  const twelveConfigured=health.providers?.twelve??health.secretConfigured;
  const finnhubConfigured=health.providers?.finnhub??health.finnhubConfigured;
  const clock=marketClockState||marketClock();
  const checked=health.checkedAt?new Date(health.checkedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"未检测";
  const last=state.settings.lastPriceRefreshText||"暂无";
  box.innerHTML=[
    ["行情来源",marketRouteLabel(),lastQuoteCache?`缓存头：${lastQuoteCache}`:"等待下一次刷新"],
    ["来源分布",`TWE ${sourceCounts.twe} / FIN ${sourceCounts.fin} / 收盘 ${sourceCounts.close}` ,`手填 ${sourceCounts.manual} / 静态 ${sourceCounts.static} / 待刷新 ${sourceCounts.pending}`],
    ["美股时钟",marketClockDisplay(clock),clock.source==="finnhub"?"Finnhub 实时状态":"本地休市表兜底"],
    ["自动刷新",autoRefreshPlan(),clock.isOpen?"盘中会主动消耗额度":"非盘中不自动消耗额度"],
    ["实时标的",`${live.length} 只`,live.join(", ")||"无"],
    ["手动资产",manual.length?manual.join(", "):"无","手动资产不消耗行情 API"],
    ["EUR/USD",round(state.fxRates.EUR||defaultState.fxRates.EUR,6),"手动汇率，不请求 TWE 汇率接口"],
    ["Worker",health.ok===undefined?"未检测":yesNo(health.ok),`V${health.version||"?"} / TWE ${twelveConfigured?"已配":"未配"} / FIN ${finnhubConfigured?"已配":"未配"} / KV ${health.sharedCache?"已启用":"未启用"} / ${checked}`],
    ["行情分配",health.routing?`TWE ${health.routing.twelve?.length||0} / FIN ${health.routing.finnhub?.length||0}`:"等待检测",health.routing?`TWE：${health.routing.twelve?.join(", ")||"无"}；FIN：${health.routing.finnhub?.join(", ")||"无"}`:"固定优先级和逐股缓存"],
    ["部署指纹",deploymentFingerprint().mismatch?"版本不一致":"版本一致",deploymentFingerprint().label],
    ["最近刷新",last,lastQuoteWarnings?`警告：${lastQuoteWarnings}`:"暂无行情警告"]
  ].map(([title,value,detail])=>`<div class="market-admin-item"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`).join("");
}
function sectorPositions(label){return state.positions.filter(p=>normalizeSectorName(p.sector)===label)}
function renderSectorAdminPanel(){
  const box=$("sectorRuleGrid");if(!box)return;
  const unknown=state.positions.filter(p=>normalizeSectorName(p.sector)==="未分类").map(p=>p.symbol);
  const locked=state.positions.filter(p=>p.sectorLocked||p.colorLocked).map(p=>`${p.symbol}${p.sectorLocked?" 板块锁":""}${p.colorLocked?" 颜色锁":""}`);
  const cards=SECTOR_RULES.filter(r=>r.label!=="未分类").map(rule=>{
    const items=sectorPositions(rule.label).map(p=>`${p.symbol}${p.colorLocked?" 颜色锁":""}`);
    return `<div class="sector-rule-card"><div class="sector-rule-head"><i style="background:${rule.color}"></i><strong>${escapeHtml(rule.label)}</strong></div><p>${escapeHtml(rule.symbols.join(", ")||"暂无固定代码")}</p><small>当前：${escapeHtml(items.join(", ")||"暂无持仓")}</small></div>`;
  }).join("");
  box.innerHTML=cards+`<div class="sector-rule-card sector-rule-summary"><div class="sector-rule-head"><i style="background:#f59e0b"></i><strong>待处理</strong></div><p>未分类：${escapeHtml(unknown.join(", ")||"无")}</p><small>已锁定：${escapeHtml(locked.join(" / ")||"无")}</small></div>`;
}
function applySectorRules(mode){
  createBackup("板块分类与颜色调整前");
  if(mode==="merge"){
    state.positions.forEach(p=>{if(!p.sectorLocked)p.sector=normalizeSectorName(p.sector)});
    state.positions.forEach(p=>{if(!p.colorLocked)p.color=autoColorForPosition(p)});
    markDirty("已合并同义板块并同步颜色");
  }else if(mode==="colors"){
    state.positions.forEach(p=>{if(!p.colorLocked)p.color=autoColorForPosition(p)});
    markDirty("已按板块重配颜色");
  }else{
    applyAutoTaxonomy(true);
    markDirty("已按规则重新分类并配色");
  }
  renderAll();
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

function ledgerMetrics(){return MYH88Core.computeLedgerMetrics(state)}
function contributedCapital(){return ledgerMetrics().contributedCapital}
function realizedPnl(){return ledgerMetrics().realizedPnl}
function currentCost(){return ledgerMetrics().currentCost}
function marketUSD(p){return MYH88Core.marketUSD(p,state.fxRates)}
function marketTotal(){return ledgerMetrics().marketTotal}
function floatingPnlUSD(p){return marketUSD(p)-num(p.costBasisUSD)}
function floatingPnl(){return ledgerMetrics().floatingPnl}
function cashBalance(){return ledgerMetrics().cashBalance}
function netAsset(){return ledgerMetrics().netAsset}
function totalPnl(){return ledgerMetrics().totalPnl}
function totalReturn(){return ledgerMetrics().totalReturn}
function floatingReturn(){return ledgerMetrics().floatingReturn}

function getPriceCache(){return readJson(localStorage.getItem(PRICE_CACHE_KEY),null)}
function getFxCache(){return readJson(localStorage.getItem(FX_CACHE_KEY),null)}
function applyPriceCache(){const pc=getPriceCache();const fc=getFxCache();if(fc?.fxRates)state.fxRates={...state.fxRates,...fc.fxRates,USD:1};if(pc?.prices)trackedQuoteItems().forEach(p=>{const q=pc.prices[p.symbol];if(q&&num(q.price)>0){p.price=num(q.price);p.changePercent=num(q.changePercent);p.priceSource=q.priceSource||p.priceSource;p.priceProvider=q.priceProvider||p.priceProvider;p.priceUpdatedAt=q.priceUpdatedAt||p.priceUpdatedAt;p.priceAsOf=q.priceAsOf||q.priceUpdatedAt||p.priceAsOf}});if(pc?.lastPriceRefresh){state.settings.lastPriceRefresh=pc.lastPriceRefresh;state.settings.lastPriceRefreshText=pc.lastPriceRefreshText||""}}
function automaticQuoteSymbols(){return[...new Set(trackedQuoteItems().filter(item=>item?.source==="twelve"&&item?.symbol).map(item=>String(item.symbol).trim().toUpperCase()).filter(Boolean))]}
function priceCacheValid(){const cache=getPriceCache(),last=num(cache?.lastPriceRefresh),mins=num(state.settings.priceCacheMinutes)||30;return Boolean(last&&Date.now()-last<mins*60000&&MYH88Core.quoteCacheCoversSymbols(cache,automaticQuoteSymbols()))}
function savePriceCache(){const prices={};trackedQuoteItems().forEach(p=>prices[p.symbol]={price:p.price,changePercent:p.changePercent||0,priceSource:p.priceSource||"",priceProvider:p.priceProvider||"",priceUpdatedAt:p.priceUpdatedAt||"",priceAsOf:p.priceAsOf||""});localStorage.setItem(PRICE_CACHE_KEY,JSON.stringify({lastPriceRefresh:state.settings.lastPriceRefresh,lastPriceRefreshText:state.settings.lastPriceRefreshText,prices}))}
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
async function fetchJsonWithHeaders(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeout||FETCH_TIMEOUT_MS);
  try{
    const r=await fetch(url,{cache:"no-store",credentials:"omit",...options,signal:controller.signal});
    if(!r.ok)throw new Error("网络错误 "+r.status);
    return{data:await r.json(),headers:r.headers};
  }catch(error){
    throw new Error(friendlyFetchError(error));
  }finally{
    clearTimeout(timer);
  }
}
function monthOpeningTradingDate(date){
  const cursor=new Date(`${String(date).slice(0,7)}-01T12:00:00Z`);
  for(let offset=0;offset<10;offset++){
    const iso=cursor.toISOString().slice(0,10),day=cursor.getUTCDay();
    if(day!==0&&day!==6&&!US_STATIC_HOLIDAYS[iso])return iso;
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return String(date);
}
async function ensureCurrentMonthOpeningSnapshot(){
  const latestDate=state.snapshots.map(item=>String(item?.date||"")).filter(Boolean).sort().at(-1)||today();
  const openingDate=monthOpeningTradingDate(latestDate);
  if(state.snapshots.some(item=>String(item?.date||"")===openingDate))return;
  const datedTransactions=state.transactions.filter(item=>!item?.voided&&String(item.date||"")<=openingDate);
  const lots=MYH88Core.lotsBeforeTransaction(datedTransactions);
  const currentBySymbol=new Map(state.positions.map(item=>[String(item.symbol||"").toUpperCase(),item]));
  const transactionBySymbol=new Map();
  datedTransactions.forEach(item=>transactionBySymbol.set(String(item.symbol||"").toUpperCase(),item));
  const symbols=Object.entries(lots).filter(([,items])=>items.some(item=>num(item.remainingShares)>0)).map(([symbol])=>symbol);
  const automatic=symbols.filter(symbol=>String((currentBySymbol.get(symbol)||transactionBySymbol.get(symbol)||{}).source||"twelve").toLowerCase()!=="manual");
  if(!automatic.length)return;
  try{
    const proxy=priceProxyUrl();if(!proxy)throw new Error("未配置行情代理");
    const url=`${proxy}/quotes?symbols=${encodeURIComponent(automatic.join(","))}&mode=historical-close&date=${encodeURIComponent(openingDate)}`;
    const quotes=await fetchJson(url,{timeout:PROXY_TIMEOUT_MS});
    const built=MYH88Core.buildHistoricalSnapshot(state,openingDate,quotes);
    if(!built.complete)throw new Error(`缺少 ${built.missingSymbols.join(", ")} 的 ${openingDate} 收盘价`);
    state.snapshots=state.snapshots.filter(item=>String(item?.date||"")!==openingDate);
    state.snapshots.push({...built.snapshot,reconstructedAt:new Date().toISOString()});
    state.snapshots.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    saveLocal();renderReturnDashboard();
  }catch(error){
    console.warn("月初收盘基准重建失败",error);
  }
}
async function refreshWorkerHealth(){
  const proxy=priceProxyUrl();
  if(!proxy){workerHealth={ok:false,error:"未配置行情代理地址"};renderDiagnostics();return workerHealth}
  try{
    const meta=await fetchJsonWithHeaders(proxy,{timeout:8000});
    workerHealth={...meta.data,checkedAt:new Date().toISOString()};
  }catch(error){
    workerHealth={ok:false,error:error.message,checkedAt:new Date().toISOString()};
  }
  renderDiagnostics();
  return workerHealth;
}
async function refreshMarketClock(){
  const proxy=priceProxyUrl();
  marketClockState=marketClock();
  if(proxy&&navigator.onLine){
    try{
      const remote=await fetchJson(`${proxy}/market-clock`,{timeout:8000});
      marketClockState={...marketClock(),...remote};
    }catch(error){
      console.warn("Market clock fallback to local calendar",error);
    }
  }
  renderDiagnostics();
  return marketClockState;
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
  try{
    const proxy=priceProxyUrl();
    if(!proxy)throw new Error("缺少 Cloudflare Worker 行情代理地址");
    const res=await fetchJson(`${proxy}/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,{timeout:PROXY_TIMEOUT_MS});
    if(res.code||res.status==="error")throw new Error(res.message||"行情代理错误");
    lastMarketRoute="proxy";
    return res;
  }catch(error){
    lastError=error;
  }
  throw lastError;
}
async function fetchQuoteBatchResilient(symbols,mode="live"){
  let lastError=null;
  const proxies=priceProxyUrls();
  if(!proxies.length)throw new Error("Missing Cloudflare Worker price proxy URL");
  for(const proxy of proxies){
    try{
      const modeParam=mode==="last-close"?"&mode=last-close":"";
      const meta=await fetchJsonWithHeaders(`${proxy}/quotes?symbols=${encodeURIComponent(symbols.join(","))}${modeParam}`,{timeout:PROXY_TIMEOUT_MS});
      const res=meta.data;
      lastQuoteCache=meta.headers.get("X-MYH88-Cache")||"";
      lastQuoteWarnings=meta.headers.get("X-MYH88-Warnings")||"";
      const sourceHeader=String(meta.headers.get("X-MYH88-Source")||"").toLowerCase();
      if(sourceHeader)lastMarketProvider=sourceHeader;
      if(res.code||res.status==="error")throw new Error(res.message||"Quote proxy error");
      lastMarketRoute=proxy===proxies[0]?"proxy":"fallback";
      return res;
    }catch(error){
      lastError=error;
    }
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
async function refreshPricesSmart(){const clock=await refreshMarketClock();return clock?.isOpen||clock?.phase==="open"?refreshPrices(false):refreshLastClosePrices(clock)}
function refreshPricesForced(){return refreshPrices(false)}
async function refreshAutomaticQuoteGroups(mode="live"){
  const providers=new Set(),routes=new Set(),errors=[];let updated=0;
  for(const items of automaticQuoteGroups()){
    const symbols=[...new Set(items.map(item=>item.symbol))];
    try{
      const res=await fetchQuoteBatchResilient(symbols,mode);routes.add(lastMarketRoute);
      items.forEach(item=>{
        const quote=symbols.length===1?res:res[item.symbol],provider=String(quote?.source||(mode==="last-close"?"last-close":"twelve")).toLowerCase(),price=num(quote?.close||quote?.price);
        if(!(price>0))return;
        item.price=price;item.changePercent=num(quote?.percent_change);item.priceSource=mode==="last-close"?"last-close":(provider==="static"?"static":provider);item.priceProvider=provider;
        item.priceUpdatedAt=quote?.as_of||quote?.datetime||quote?.last_quote_at||new Date().toISOString();item.priceAsOf=item.priceUpdatedAt;
        if(provider)providers.add(provider);updated++;
      });
    }catch(error){errors.push(error)}
  }
  if(!updated)throw errors[0]||new Error("No valid quotes returned");
  if(routes.has("proxy"))lastMarketRoute=routes.size>1?"mixed-cache":"proxy";
  else if(routes.has("fallback"))lastMarketRoute=routes.size>1?"mixed-cache":"fallback";
  else if(routes.has("static"))lastMarketRoute="static";
  if(providers.size===1)lastMarketProvider=[...providers][0];
  else if(providers.size>1)lastMarketProvider="mixed";
  if(errors.length){const warning=errors.map(friendlyFetchError).join("; ");lastQuoteWarnings=[lastQuoteWarnings,warning].filter(Boolean).join("; ");lastMarketError=warning}
  return updated;
}
async function refreshLastClosePrices(clock=marketClockState||marketClock()){
  const status=$("status"),button=$("refreshButton");
  if(!navigator.onLine||!priceProxyUrl()){
    lastMarketRoute="cache";applyPriceCache();renderAll();
    if(status)status.textContent=`${marketClockDisplay(clock)}；离线或未配置代理，显示本机历史价格：${state.settings.lastPriceRefreshText||"暂无记录"}`;
    return;
  }
  if(button)button.disabled=true;
  try{
    if(automaticQuoteGroups().length){
      await refreshAutomaticQuoteGroups("last-close");
      if(lastMarketRoute!=="static"&&lastMarketRoute!=="mixed-cache")lastMarketRoute="last-close";
    }else lastMarketRoute="last-close";
    state.settings.lastPriceRefresh=Date.now();state.settings.lastPriceRefreshText=new Date().toLocaleString("zh-CN");savePriceCache();
    captureSnapshot(false);
    renderAll();
    if(status)status.textContent=`${marketClockDisplay(clock)}；已使用上个交易日收盘价`;
  }catch(error){
    lastMarketRoute="cache";applyPriceCache();renderAll();
    if(status)status.textContent=`${marketClockDisplay(clock)}；收盘价读取失败，显示本机历史价格：${friendlyFetchError(error)}`;
  }finally{
    renderDiagnostics();
    if(button)button.disabled=false;
  }
}
async function doRefreshPrices(useCache=true){
  const status=$("status"),button=$("refreshButton"),proxy=priceProxyUrl();
  if(!navigator.onLine){status.textContent="当前离线，无法刷新行情；正在显示最近缓存价格";return}
  if(useCache&&priceCacheValid()){lastMarketRoute="cache";applyPriceCache();renderAll();status.textContent="已使用缓存行情："+(state.settings.lastPriceRefreshText||"");return}
  if(!proxy){status.textContent="刷新失败：管理员需要先填写 Cloudflare Worker 行情代理地址";if(!useCache)alert(status.textContent);return}
  status.textContent="正在通过行情代理刷新实时价格...";if(button)button.disabled=true;
  lastMarketError="";
  lastQuoteCache="";
  lastQuoteWarnings="";
  try{
    try{await refreshFx(false)}catch(error){console.warn("FX refresh failed; keep cached rates",error);state.fxRates={...state.fxRates,...(getFxCache()?.fxRates||{}),USD:1}}
    if(automaticQuoteGroups().length)await refreshAutomaticQuoteGroups("live");
    state.settings.lastPriceRefresh=Date.now();state.settings.lastPriceRefreshText=new Date().toLocaleString("zh-CN");savePriceCache();
    if(lastMarketRoute!=="static")captureSnapshot(false);else saveLocal();
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
  try{const remote=await getRemoteData();cloudState=remote.data;cloudSha=remote.sha;renderSyncStatus();if(manual){const l=summaryOf(state),r=summaryOf(cloudState),danger=dangerBetween(state,cloudState);alert(danger.length?`发现危险差异，保存已被锁定：\n${danger.join("\n")}`:`核对完成。\n本地：${l.positions} 个持仓 / ${l.transactions} 条交易 / ${l.dcaEntries} 条定投\n云端：${r.positions} 个持仓 / ${r.transactions} 条交易 / ${r.dcaEntries} 条定投`)}return remote}catch(error){cloudState=null;renderSyncStatus();if(manual)alert("云端核对失败："+error.message);return null}
}
async function createCloudBackup(remote){
  if(!remote?.sha)return null;const stamp=new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,17),path=`backups/data-${stamp}.json`;const result=await putGithubFile(path,remote.raw,`Backup data.json before V10 save (${stamp})`);const box=$("cloudBackupStatus");if(box)box.textContent=`已备份旧云端账本：${path}`;return{path,result}
}
function ledgerForCloud(){
  const ledger=structuredClone(state);
  ledger.settings={...ledger.settings,schemaVersion:LEDGER_SCHEMA_VERSION};
  delete ledger.settings.version;delete ledger.settings.lastPriceRefresh;delete ledger.settings.lastPriceRefreshText;delete ledger.settings.localUpdatedAt;delete ledger.settings.publicMarketKey;delete ledger.settings.apiKey;
  ledger.positions.forEach(p=>{if(p.source!=="manual"){delete p.price;delete p.changePercent;delete p.priceSource;delete p.priceProvider;delete p.priceUpdatedAt;delete p.priceAsOf}});
  return ledger;
}
async function saveToGithub(){
  if(!navigator.onLine){alert("当前离线，不能保存到 GitHub。联网后再试，所有本地修改仍保留在本机。");return}
  saveAdminSettings(false);if(!admin.owner||!admin.repo||!admin.token){alert("请先填写 GitHub 用户名、仓库名和 Token");return}
  const button=$("githubSaveButton");button.disabled=true;renderSyncStatus("checking");$("status").textContent="正在进行保存前安全核对...";
  try{
    const remote=await getRemoteData(),danger=dangerBetween(state,remote.data);cloudState=remote.data;cloudSha=remote.sha;
    if(danger.length){renderSyncStatus();throw new Error(`安全锁已阻止覆盖：${danger.join("；")}。请先恢复或重新载入云端数据。`)}
    const l=summaryOf(state),r=summaryOf(remote.data);
    if(!confirm(`即将安全保存到 GitHub：\n\n本地：${l.positions} 个持仓 / ${l.transactions} 条交易 / ${l.cashFlows} 条资金流水 / ${l.dcaEntries} 条定投\n云端：${r.positions} 个持仓 / ${r.transactions} 条交易 / ${r.cashFlows} 条资金流水 / ${r.dcaEntries} 条定投\n\n系统会先备份旧云端账本，再执行保存。是否继续？`)){renderSyncStatus();return}
    createBackup("安全保存 GitHub 前");$("status").textContent="正在备份旧的云端账本...";await createCloudBackup(remote);
    state.settings.lastCloudSaveAt=new Date().toISOString();const raw=JSON.stringify(ledgerForCloud(),null,2);$("status").textContent="云端备份完成，正在保存新账本...";const result=await putGithubFile("data.json",raw,"Update baby dream fund data V10",remote.sha);
    cloudSha=result.content?.sha||null;cloudState=structuredClone(state);dirty=false;lastMutationReason="";saveLocal();renderSyncStatus();$("status").textContent="安全保存完成：旧账本已备份，新账本已同步。";alert("V10 安全保存完成。旧的云端账本已经自动备份。")
  }catch(error){renderSyncStatus();$("status").textContent="保存失败："+error.message;alert($("status").textContent)}finally{button.disabled=!navigator.onLine}
}
function saveSettings(){state.settings.title=$("titleInput").value.trim()||defaultState.settings.title;state.settings.priceCacheMinutes=Math.max(30,num($("cacheInput").value)||30);const eur=num($("eurFxInput")?.value);if(eur>0)state.fxRates.EUR=eur;state.fxRates.USD=1;localStorage.setItem(FX_CACHE_KEY,JSON.stringify({time:Date.now(),fxRates:state.fxRates,manual:true}));const proxy=$("proxyInput")?.value.trim()||"";if(proxy){localStorage.setItem("v10_price_proxy",proxy);state.settings.priceProxyUrl=proxy}else{localStorage.removeItem("v10_price_proxy");delete state.settings.priceProxyUrl}localStorage.removeItem(MARKET_KEY);delete state.settings.publicMarketKey;delete state.settings.apiKey;markDirty("看板设置已修改，汇率使用手动值，行情只通过 Cloudflare Worker 代理读取");renderAll();alert("设置已应用。汇率将使用手动值，不再调用 Twelve 汇率接口；安全保存到 GitHub 后，家人访问页面同步生效。")}

function treemapItems(){const arr=state.positions.map(p=>({label:p.symbol,value:num(p.costBasisUSD),color:p.color})).filter(x=>x.value>0),cash=cashBalance();if(cash>0)arr.push({label:"CASH",value:cash,color:"#ffd84d"});return arr.sort((a,b)=>b.value-a.value)}
