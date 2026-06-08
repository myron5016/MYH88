const defaultState={
  "settings":{
    "title":"孟一晗的梦想金库",
    "totalAsset":15000,
    "apiKey":"",
    "priceCacheMinutes":30,
    "lastPriceRefresh":0,
    "lastPriceRefreshText":"",
    "version":"V8.0 盈亏结算版"
  },
  "fxRates":{"USD":1,"EUR":1.16,"HKD":0.128,"JPY":0.0067,"GBP":1.27},
  "data":[]
};

let state=structuredClone(defaultState);
let admin=JSON.parse(localStorage.getItem("v8_admin")||"null")||{owner:"",repo:"",branch:"main",token:""};

async function loadSharedData(autoRefresh=false){
  const st=document.getElementById("status");
  st.textContent="正在读取 GitHub 共享数据...";
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    const res=await fetch("data.json?ts="+Date.now(),{cache:"no-store",signal:controller.signal});
    clearTimeout(timer);
    if(!res.ok)throw new Error("找不到 data.json");
    state=await res.json();
    normalizeState();
    localStorage.setItem("v8_last_state",JSON.stringify(state));
    applyPriceCache();
    renderAll();
    st.textContent="已读取共享数据："+new Date().toLocaleString("zh-CN");
    if(autoRefresh)refreshPrices(true);
  }catch(e){
    console.warn("共享数据读取失败",e);
    const cached=localStorage.getItem("v8_last_state") || localStorage.getItem("v6_last_state");
    try{
      if(cached){
        state=JSON.parse(cached);
        normalizeState();
        renderAll();
        st.textContent="读取失败，已使用本机缓存";
      }else{
        state=structuredClone(defaultState);
        normalizeState();
        renderAll();
        st.textContent="读取失败，已使用默认数据";
      }
    }catch(err){
      state=structuredClone(defaultState);
      normalizeState();
      renderAll();
      st.textContent="读取失败，已使用默认数据";
    }
  }
}

function normalizeState(){
  state.settings=state.settings||{};
  state.settings.title=state.settings.title||"孟一晗的梦想金库";
  state.settings.totalAsset=Number(state.settings.totalAsset)||15000;
  state.settings.priceCacheMinutes=Number(state.settings.priceCacheMinutes)||30;
  state.settings.lastPriceRefresh=Number(state.settings.lastPriceRefresh)||0;
  state.settings.version=state.settings.version||"V8.0 盈亏结算版";
  state.fxRates=state.fxRates||{USD:1};
  state.fxRates.USD=1;
  state.data=Array.isArray(state.data)?state.data:[];
  state.data.forEach(x=>{
    x.symbol=String(x.symbol||"").trim().toUpperCase();
    x.currency=String(x.currency||"USD").toUpperCase();
    x.source=x.source||"twelve";
    x.status=x.status==="sold"?"sold":"holding";
    x.shares=Number(x.shares)||0;
    x.avgCost=Number(x.avgCost)||0;
    x.price=Number(x.price)||0;
    if(x.sellPrice===undefined||x.sellPrice===null)x.sellPrice="";
    if(x.sellDate===undefined||x.sellDate===null)x.sellDate="";
    if(x.sellNote===undefined||x.sellNote===null)x.sellNote="";
  });
}

function saveAdminSettings(){
  admin={owner:ghOwner.value.trim(),repo:ghRepo.value.trim(),branch:ghBranch.value.trim()||"main",token:ghToken.value.trim()};
  localStorage.setItem("v8_admin",JSON.stringify(admin));
  alert("管理员设置已保存到当前浏览器");
}

function fillAdmin(){
  ghOwner.value=admin.owner||"";
  ghRepo.value=admin.repo||"";
  ghBranch.value=admin.branch||"main";
  ghToken.value=admin.token||"";
}

async function getLatestSha(){
  const api=`https://api.github.com/repos/${admin.owner}/${admin.repo}/contents/data.json?ref=${encodeURIComponent(admin.branch)}`;
  const res=await fetch(api,{headers:{Authorization:`Bearer ${admin.token}`,Accept:"application/vnd.github+json"}});
  if(res.status===404)return null;
  const json=await res.json();
  if(!res.ok)throw new Error(json.message||"获取 data.json SHA 失败");
  return json.sha;
}

async function saveToGithub(){
  saveAdminSettings();
  if(!admin.owner||!admin.repo||!admin.token){
    alert("请先填写 GitHub 用户名、仓库名和 Token");
    return;
  }
  try{
    status.textContent="正在保存到 GitHub...";
    const latestSha=await getLatestSha();
    const content=btoa(unescape(encodeURIComponent(JSON.stringify(state,null,2))));
    const body={message:"Update baby dream fund data V8",content,branch:admin.branch};
    if(latestSha)body.sha=latestSha;
    const put=await fetch(`https://api.github.com/repos/${admin.owner}/${admin.repo}/contents/data.json`,{
      method:"PUT",
      headers:{Authorization:`Bearer ${admin.token}`,Accept:"application/vnd.github+json","Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const result=await put.json();
    if(!put.ok)throw new Error(result.message||"保存失败");
    localStorage.setItem("v8_last_state",JSON.stringify(state));
    status.textContent="已保存到 GitHub。其他设备约 30 秒后刷新可见。";
    alert("已保存到 GitHub。其他浏览器/手机刷新后即可看到。");
  }catch(e){
    alert("保存到 GitHub 失败："+e.message);
  }
}

function money(n){
  const v=Number(n)||0;
  const sign=v<0?"-":"";
  return sign+"$"+new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(Math.abs(v));
}
function round(n){return Math.round((Number(n)||0)*100)/100}
function cls(n){return n>0?"green":n<0?"red":"muted"}
function fx(cur){return Number(state.fxRates?.[String(cur||"USD").toUpperCase()])||1}
function isSold(x){return x.status==="sold"}
function holdingItems(){return state.data.filter(x=>!isSold(x))}
function soldItems(){return state.data.filter(x=>isSold(x))}
function priceUSD(x){return (Number(x.price)||0)*fx(x.currency)}
function sellPriceUSD(x){return (Number(x.sellPrice)||0)*fx(x.currency)}
function marketUSD(x){return isSold(x)?0:(Number(x.shares)||0)*priceUSD(x)}
function costUSD(x){return (Number(x.shares)||0)*(Number(x.avgCost)||0)*fx(x.currency)}
function holdingCostUSD(x){return isSold(x)?0:costUSD(x)}
function realizedUSD(x){return isSold(x)?((Number(x.sellPrice)||0)-(Number(x.avgCost)||0))*(Number(x.shares)||0)*fx(x.currency):0}
function floatingPnlUSD(x){return isSold(x)?0:marketUSD(x)-costUSD(x)}
function rowPnlUSD(x){return isSold(x)?realizedUSD(x):floatingPnlUSD(x)}
function retPct(x){
  const c=costUSD(x);
  return c?rowPnlUSD(x)/c*100:0;
}
function invested(){return state.data.reduce((s,x)=>s+marketUSD(x),0)}
function currentCost(){return state.data.reduce((s,x)=>s+holdingCostUSD(x),0)}
function allCost(){return state.data.reduce((s,x)=>s+costUSD(x),0)}
function floatingPnl(){return state.data.reduce((s,x)=>s+floatingPnlUSD(x),0)}
function realizedPnl(){return state.data.reduce((s,x)=>s+realizedUSD(x),0)}
function totalPnl(){return floatingPnl()+realizedPnl()}
function autoCash(){
  // 本金扣除仍在持有的成本，再加上已实现盈亏。已卖出记录成为历史，不再占用持仓成本。
  return (Number(state.settings.totalAsset)||0)-currentCost()+realizedPnl();
}
function totalReturn(){
  const c=allCost();
  return c?totalPnl()/c*100:0;
}
function floatingReturn(){
  const c=currentCost();
  return c?floatingPnl()/c*100:0;
}

async function fetchJson(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error("网络错误 "+r.status);
  return await r.json();
}

const PRICE_CACHE_KEY="v8_price_cache";
const FX_CACHE_KEY="v8_fx_cache";
const FX_CACHE_HOURS=24;

function getPriceCache(){try{return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY)||"null")}catch(e){return null}}
function getFxCache(){try{return JSON.parse(localStorage.getItem(FX_CACHE_KEY)||"null")}catch(e){return null}}
function fxCacheValid(){
  const cache=getFxCache();
  const last=Number(cache?.lastFxRefresh)||0;
  return last&&(Date.now()-last)<FX_CACHE_HOURS*60*60*1000;
}
function saveFxCache(){
  localStorage.setItem(FX_CACHE_KEY,JSON.stringify({
    lastFxRefresh:Date.now(),
    lastFxRefreshText:new Date().toLocaleString("zh-CN"),
    fxRates:{...(state.fxRates||{}),USD:1}
  }));
}
function applyFxCache(){
  const cache=getFxCache();
  if(cache?.fxRates){
    state.fxRates={...(state.fxRates||{}),...cache.fxRates,USD:1};
    return true;
  }
  return false;
}
function savePriceCache(){
  const prices={};
  holdingItems().forEach(x=>{
    if(x.source==="twelve"&&x.symbol){
      prices[String(x.symbol).trim().toUpperCase()]={price:Number(x.price)||0,changePercent:Number(x.changePercent)||0};
    }
  });
  localStorage.setItem(PRICE_CACHE_KEY,JSON.stringify({
    lastPriceRefresh:Number(state.settings.lastPriceRefresh)||Date.now(),
    lastPriceRefreshText:state.settings.lastPriceRefreshText||new Date().toLocaleString("zh-CN"),
    prices
  }));
}
function applyPriceCache(){
  const cache=getPriceCache();
  if(!cache){applyFxCache();return false}
  applyFxCache();
  if(cache.prices){
    holdingItems().forEach(x=>{
      const sym=String(x.symbol||"").trim().toUpperCase();
      const q=cache.prices[sym];
      if(q&&Number(q.price)>0){
        x.price=Number(q.price);
        x.changePercent=Number(q.changePercent)||0;
      }
    });
  }
  if(cache.lastPriceRefresh){
    state.settings.lastPriceRefresh=Number(cache.lastPriceRefresh);
    state.settings.lastPriceRefreshText=cache.lastPriceRefreshText||new Date(cache.lastPriceRefresh).toLocaleString("zh-CN");
  }
  return true;
}
function priceCacheValid(){
  const cache=getPriceCache();
  const last=Number(cache?.lastPriceRefresh||state.settings.lastPriceRefresh)||0;
  const mins=Number(state.settings.priceCacheMinutes)||30;
  return last&&(Date.now()-last)<mins*60*1000;
}

async function refreshFx(force=false){
  try{
    applyFxCache();
    if(!force&&fxCacheValid())return;
    const apiKey=state.settings.apiKey;
    if(!apiKey)return;
    const currencies=[...new Set(holdingItems().map(x=>String(x.currency||"USD").toUpperCase()).filter(c=>c!=="USD"))];
    for(const c of currencies){
      const res=await fetchJson(`https://api.twelvedata.com/exchange_rate?symbol=${c}/USD&apikey=${encodeURIComponent(apiKey)}`);
      if(res.rate)state.fxRates[c]=Number(res.rate);
    }
    state.fxRates.USD=1;
    saveFxCache();
  }catch(e){
    console.warn("汇率刷新失败，使用已有汇率",e);
    applyFxCache();
  }
}

async function refreshPrices(useCache=true){
  const st=document.getElementById("status");
  applyFxCache();
  if(useCache&&priceCacheValid()){
    st.textContent="已使用缓存行情，上次刷新："+(state.settings.lastPriceRefreshText||new Date(state.settings.lastPriceRefresh).toLocaleString("zh-CN"));
    renderAll();
    return;
  }
  st.textContent="正在刷新实时价格...";
  try{
    const apiKey=state.settings.apiKey;
    if(!apiKey)throw new Error("请先填写 Twelve Data Key，并保存到 GitHub");
    await refreshFx(false);
    const items=holdingItems().filter(x=>x.source==="twelve"&&x.symbol);
    if(items.length){
      const symbols=[...new Set(items.map(x=>x.symbol.trim().toUpperCase()))];
      const res=await fetchJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${encodeURIComponent(apiKey)}`);
      if(res.code||res.status==="error")throw new Error(res.message||"Twelve Data 错误");
      items.forEach(item=>{
        const sym=item.symbol.trim().toUpperCase();
        const q=symbols.length===1?res:res[sym];
        if(q){
          const p=Number(q.close||q.price||0);
          if(p>0)item.price=p;
          item.changePercent=Number(q.percent_change||0);
        }
      });
    }
    const now=new Date();
    state.settings.lastPriceRefresh=Date.now();
    state.settings.lastPriceRefreshText=now.toLocaleString("zh-CN");
    renderAll();
    localStorage.setItem("v8_last_state",JSON.stringify(state));
    savePriceCache();
    st.textContent="已刷新："+state.settings.lastPriceRefreshText+"。如需共享，请点保存到 GitHub";
  }catch(e){
    console.warn("刷新失败，尝试使用缓存",e);
    if(applyPriceCache()){
      renderAll();
      st.textContent="刷新失败，已使用缓存行情："+(state.settings.lastPriceRefreshText||"");
    }else{
      st.textContent="刷新失败："+e.message;
    }
    if(!useCache)alert("刷新失败："+e.message);
  }
}

function groupSectors(){
  const map={};
  holdingItems().forEach(x=>{
    const sec=x.sector||"未分类";
    if(!map[sec])map[sec]={sector:sec,total:0,pnl:0,color:x.color||"#888"};
    map[sec].total+=marketUSD(x);
    map[sec].pnl+=floatingPnlUSD(x);
    if(x.color)map[sec].color=x.color;
  });
  const cash=autoCash();
  if(cash>0)map["现金"]={sector:"现金",total:cash,pnl:0,color:"#ffd84d"};
  return Object.values(map).sort((a,b)=>b.total-a.total);
}
function treemapItems(){
  const arr=holdingItems().map(x=>({label:x.symbol,value:marketUSD(x),color:x.color||"#888"})).filter(x=>x.value>0);
  const cash=autoCash();
  if(cash>0)arr.push({label:"CASH",value:cash,color:"#ffd84d"});
  return arr.sort((a,b)=>b.value-a.value);
}
function layout(items,x,y,w,h){
  if(!items.length)return[];
  if(items.length===1)return[{...items[0],x,y,w,h}];
  const total=items.reduce((s,i)=>s+i.value,0);
  let acc=0,split=0,half=total/2;
  for(let i=0;i<items.length;i++){if(acc<half){acc+=items[i].value;split=i+1}}
  split=Math.max(1,Math.min(items.length-1,split));
  const a=items.slice(0,split),b=items.slice(split),at=a.reduce((s,i)=>s+i.value,0);
  if(w>=h){
    const aw=w*(at/total);
    return[...layout(a,x,y,aw,h),...layout(b,x+aw,y,w-aw,h)];
  }
  const ah=h*(at/total);
  return[...layout(a,x,y,w,ah),...layout(b,x,y+ah,w,h-ah)];
}

function renderKpis(){
  kpiTotal.textContent=money(state.settings.totalAsset);
  kpiInvested.textContent=money(invested());
  const cash=autoCash();
  kpiCash.textContent=money(cash);
  kpiCash.className=cls(cash);
  const fp=floatingPnl(), fr=floatingReturn();
  kpiFloating.textContent=`${money(fp)} / ${round(fr)}%`;
  kpiFloating.className=cls(fp);
  const rp=realizedPnl();
  kpiRealized.textContent=money(rp);
  kpiRealized.className=cls(rp);
  const tp=totalPnl(), tr=totalReturn();
  kpiPnl.textContent=`${money(tp)} / ${round(tr)}%`;
  kpiPnl.className=cls(tp);
}

function renderTreemap(){
  treemap.innerHTML="";
  const rect=treemap.getBoundingClientRect(),items=treemapItems(),total=Math.max(invested()+Math.max(autoCash(),0),1);
  layout(items,0,0,rect.width,rect.height).forEach(t=>{
    const d=document.createElement("div"),area=t.w*t.h;
    d.className="tile"+(area<13000?" tiny":"");
    d.style.left=t.x+"px";
    d.style.top=t.y+"px";
    d.style.width=t.w+"px";
    d.style.height=t.h+"px";
    d.style.background=t.color;
    d.style.color=(t.color==="#ffd84d"||t.color==="#eeee00"||t.color==="#f1a2ef")?"#07101a":"white";
    d.innerHTML=`<div>${escapeHtml(t.label)}<small>${money(t.value)}｜${round(t.value/total*100)}%</small></div>`;
    treemap.appendChild(d);
  });
}

function renderSectors(){
  sectorBar.innerHTML="";
  sectorLegend.innerHTML="";
  const total=Math.max(invested()+Math.max(autoCash(),0),1);
  groupSectors().forEach(s=>{
    const seg=document.createElement("div");
    seg.className="segment";
    seg.style.width=Math.max(3,s.total/total*100)+"%";
    seg.style.background=s.color;
    seg.textContent=`${s.sector} ${round(s.total/total*100)}%`;
    sectorBar.appendChild(seg);
    const lg=document.createElement("span");
    lg.innerHTML=`<i class="dot" style="background:${s.color}"></i>${escapeHtml(s.sector)} ${money(s.total)} <b class="${cls(s.pnl)}">${money(s.pnl)}</b>`;
    sectorLegend.appendChild(lg);
  });
}

function renderTable(){
  pageTitle.textContent=state.settings.title||"孟一晗的梦想金库";
  document.title=state.settings.title||"孟一晗的梦想金库";
  titleInput.value=state.settings.title||"";
  totalAssetInput.value=state.settings.totalAsset||0;
  apiKeyInput.value=state.settings.apiKey||"";
  cacheInput.value=state.settings.priceCacheMinutes||30;
  dataBody.innerHTML="";
  state.data.forEach((x,i)=>{
    const tr=document.createElement("tr"),pnl=rowPnlUSD(x),ret=retPct(x),sold=isSold(x);
    const priceCell=sold
      ? `<input type="number" step="0.0001" value="${x.sellPrice||0}" onchange="state.data[${i}].sellPrice=parseFloat(this.value)||0;renderAll()"><div class="muted">卖出价 ${x.currency||"USD"}</div>`
      : (x.source==="manual"
        ? `<input type="number" step="0.0001" value="${x.price||0}" onchange="state.data[${i}].price=parseFloat(this.value)||0;renderAll()">`
        : `<span class="num">${money(priceUSD(x))}</span><div class="muted">${round(x.price||0)} ${x.currency||"USD"}</div>`);
    tr.className=sold?"sold-row":"";
    tr.innerHTML=`
      <td><select onchange="state.data[${i}].status=this.value;renderAll()"><option value="holding"${!sold?" selected":""}>持有中</option><option value="sold"${sold?" selected":""}>已卖出</option></select></td>
      <td><input value="${attr(x.symbol)}" onchange="state.data[${i}].symbol=this.value.trim().toUpperCase();renderAll()"></td>
      <td><input value="${attr(x.name||"")}" onchange="state.data[${i}].name=this.value"></td>
      <td><select onchange="state.data[${i}].source=this.value;renderAll()"><option value="twelve"${x.source==="twelve"?" selected":""}>Twelve</option><option value="manual"${x.source==="manual"?" selected":""}>Manual</option></select></td>
      <td><select onchange="state.data[${i}].currency=this.value;renderAll()">${["USD","EUR","HKD","JPY","GBP"].map(c=>`<option value="${c}"${(x.currency||"USD")===c?" selected":""}>${c}</option>`).join("")}</select></td>
      <td><input type="number" step="0.0001" value="${x.shares||0}" onchange="state.data[${i}].shares=parseFloat(this.value)||0;renderAll()"></td>
      <td><input type="number" step="0.0001" value="${x.avgCost||0}" onchange="state.data[${i}].avgCost=parseFloat(this.value)||0;renderAll()"></td>
      <td>${priceCell}</td>
      <td><input type="date" value="${attr(x.sellDate||"")}" onchange="state.data[${i}].sellDate=this.value;renderAll()" ${sold?"":"disabled"}></td>
      <td class="num">${round(fx(x.currency))}</td>
      <td class="num">${sold?"—":money(marketUSD(x))}</td>
      <td class="num">${money(costUSD(x))}</td>
      <td class="num ${cls(pnl)}">${money(pnl)}</td>
      <td class="${cls(ret)}">${round(ret)}%</td>
      <td><input value="${attr(x.sector||"")}" onchange="state.data[${i}].sector=this.value;renderAll()"></td>
      <td><input class="color-input" type="color" value="${x.color||"#888888"}" onchange="state.data[${i}].color=this.value;renderAll()"></td>
      <td><input value="${attr(x.note||"")}" onchange="state.data[${i}].note=this.value"></td>
      <td class="row-actions">
        <button onclick="settleRow(${i})">结算</button>
        <button onclick="partialSell(${i})">部分卖出</button>
        <button onclick="restoreRow(${i})">恢复</button>
        <button onclick="deleteRow(${i})">删除</button>
      </td>`;
    dataBody.appendChild(tr);
  });
}

function renderHoldingCards(){
  const wrap=document.getElementById("holdingCards");
  if(!wrap)return;
  wrap.innerHTML="";
  const items=holdingItems();
  if(!items.length){wrap.innerHTML='<div class="empty">暂无当前持仓</div>';return}
  items.forEach(x=>{
    const pnl=floatingPnlUSD(x), ret=retPct(x);
    const card=document.createElement("div");
    card.className="holding-card";
    card.innerHTML=`<div class="top"><div><div class="symbol">${escapeHtml(x.symbol)}</div><div class="name">${escapeHtml(x.name||"")}</div></div><div class="sector-pill">${escapeHtml(x.sector||"未分类")}</div></div><div class="grid"><div><div class="label">数量</div><div class="value">${round(x.shares||0)}</div></div><div><div class="label">最新价</div><div class="value">${round(x.price||0)} ${escapeHtml(x.currency||"USD")}</div></div><div><div class="label">市值</div><div class="value">${money(marketUSD(x))}</div></div><div><div class="label">浮动盈亏</div><div class="value ${cls(pnl)}">${money(pnl)} / ${round(ret)}%</div></div></div>`;
    wrap.appendChild(card);
  });
}

function renderSoldCards(){
  const wrap=document.getElementById("soldCards");
  if(!wrap)return;
  wrap.innerHTML="";
  const items=soldItems();
  if(!items.length){wrap.innerHTML='<div class="empty">暂无历史结算记录</div>';return}
  items.slice().sort((a,b)=>String(b.sellDate||"").localeCompare(String(a.sellDate||""))).forEach(x=>{
    const pnl=realizedUSD(x), ret=retPct(x);
    const card=document.createElement("div");
    card.className="sold-card";
    card.innerHTML=`<div class="top"><div><div class="symbol">${escapeHtml(x.symbol)}</div><div class="name">${escapeHtml(x.name||"")}</div></div><div class="sold-pill">已卖出</div></div>
      <div class="grid">
        <div><div class="label">数量</div><div class="value">${round(x.shares||0)}</div></div>
        <div><div class="label">成本价</div><div class="value">${round(x.avgCost||0)} ${escapeHtml(x.currency||"USD")}</div></div>
        <div><div class="label">卖出价</div><div class="value">${round(x.sellPrice||0)} ${escapeHtml(x.currency||"USD")}</div></div>
        <div><div class="label">已实现盈亏</div><div class="value ${cls(pnl)}">${money(pnl)} / ${round(ret)}%</div></div>
      </div>
      <div class="sold-date">${escapeHtml(x.sellDate||"未填写卖出日期")}</div>`;
    wrap.appendChild(card);
  });
}

function renderAll(){
  renderKpis();
  renderTreemap();
  renderSectors();
  renderHoldingCards();
  renderSoldCards();
  renderTable();
}

function addRow(){
  state.data.push({symbol:"NEW",name:"",source:"twelve",currency:"USD",shares:1,avgCost:0,price:0,status:"holding",sellPrice:"",sellDate:"",sector:"新板块",color:"#888888",note:""});
  renderAll();
}

function settleRow(i){
  const x=state.data[i];
  const defaultPrice=x.status==="sold"?(x.sellPrice||""):(x.price||"");
  const p=prompt(`请输入 ${x.symbol} 的卖出价格（${x.currency||"USD"}）`,defaultPrice);
  if(p===null)return;
  const price=parseFloat(p);
  if(!Number.isFinite(price)||price<0){alert("卖出价格不正确");return}
  x.sellPrice=price;
  x.sellDate=x.sellDate||new Date().toISOString().slice(0,10);
  x.status="sold";
  renderAll();
}

function partialSell(i){
  const x=state.data[i];
  if(isSold(x)){alert("已卖出记录不能再部分卖出");return}
  const q=prompt(`请输入 ${x.symbol} 本次卖出数量，当前持有 ${x.shares}`, "");
  if(q===null)return;
  const qty=parseFloat(q);
  if(!Number.isFinite(qty)||qty<=0||qty>Number(x.shares)){alert("卖出数量不正确");return}
  const p=prompt(`请输入 ${x.symbol} 本次卖出价格（${x.currency||"USD"}）`, x.price||"");
  if(p===null)return;
  const price=parseFloat(p);
  if(!Number.isFinite(price)||price<0){alert("卖出价格不正确");return}
  const soldCopy={...x,shares:qty,status:"sold",sellPrice:price,sellDate:new Date().toISOString().slice(0,10),note:(x.note||"")+" 部分卖出"};
  x.shares=round(Number(x.shares)-qty);
  state.data.push(soldCopy);
  renderAll();
}

function restoreRow(i){
  const x=state.data[i];
  x.status="holding";
  x.sellPrice="";
  x.sellDate="";
  renderAll();
}

function deleteRow(i){
  if(confirm("确认删除这一行吗？")){
    state.data.splice(i,1);
    renderAll();
  }
}

function downloadJson(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="data.json";
  a.click();
}

function importJson(e){
  const f=e.target.files[0];
  if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      state=JSON.parse(r.result);
      normalizeState();
      renderAll();
      alert("导入成功，点保存到 GitHub 后共享生效");
    }catch(err){alert("JSON格式错误")}
  };
  r.readAsText(f);
}

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function attr(s){return escapeHtml(s).replace(/"/g,"&quot;")}

function initAdminMode(){
  const isAdmin=new URLSearchParams(location.search).get("admin")==="1";
  document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdmin));
}

window.addEventListener("resize",renderTreemap);
initAdminMode();
fillAdmin();
normalizeState();
renderAll();
loadSharedData(true);
