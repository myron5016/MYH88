(function(global){
  "use strict";

  const metadataCache=new Map();
  const pendingSymbols=new Map();
  const LOGO_BATCH_LIMIT=24;
  const MISSING_CACHE_MS=5*60*1000;

  function normalizeSymbols(values){
    const input=Array.isArray(values)?values:String(values||"").split(",");
    return [...new Set(input.map(value=>String(value||"").trim().toUpperCase()).filter(symbol=>symbol!=="CASH"&&/^[A-Z0-9.-]{1,12}$/.test(symbol)&&/[A-Z0-9]/.test(symbol)))];
  }

  function normalizeProxyUrls(values){
    const input=Array.isArray(values)?values:[values];
    return [...new Set(input.map(value=>String(value||"").trim().replace(/\/+$/,"")).filter(Boolean))];
  }

  function missingRecord(symbol){return {symbol,status:"missing"}}

  function getCachedRecord(symbol){
    const entry=metadataCache.get(symbol);
    if(!entry)return null;
    if(entry.expiresAt<=Date.now()){metadataCache.delete(symbol);return null}
    return entry.record;
  }

  function cacheRecord(record){
    metadataCache.set(record.symbol,{record,expiresAt:record.status==="missing"?Date.now()+MISSING_CACHE_MS:Number.POSITIVE_INFINITY});
  }

  function normalizeRecord(symbol,record,proxyUrl){
    if(!record||record.status!=="verified"||String(record.symbol||"").toUpperCase()!==symbol)return missingRecord(symbol);
    const path=String(record.path||"");
    if(!/^\/logo\/[A-Z0-9.-]{1,12}$/.test(path)||path.slice(6).toUpperCase()!==symbol)return missingRecord(symbol);
    return {symbol,status:"verified",source:String(record.source||""),path,imageUrl:`${proxyUrl}${path}`};
  }

  async function fetchBatch(symbols,proxyUrls,fetchImpl){
    let lastError=new Error("没有可用的徽标代理");
    for(const proxyUrl of normalizeProxyUrls(proxyUrls)){
      const url=`${proxyUrl}/logos?symbols=${encodeURIComponent(symbols.join(","))}`;
      try{
        const response=await fetchImpl(url,{headers:{Accept:"application/json"}});
        if(!response||!response.ok)throw new Error(`徽标元数据请求失败：${response?.status||"network"}`);
        const payload=await response.json();
        if(!payload||typeof payload.logos!=="object"||Array.isArray(payload.logos))throw new Error("徽标元数据格式无效");
        return {logos:payload.logos,proxyUrl};
      }catch(error){lastError=error instanceof Error?error:new Error(String(error))}
    }
    throw lastError;
  }

  async function load(values,proxyUrls,fetchImpl=global.fetch?.bind(global)){
    const symbols=normalizeSymbols(values);
    if(!symbols.length)return {};
    if(typeof fetchImpl!=="function")throw new Error("当前环境不支持徽标请求");
    const fresh=symbols.filter(symbol=>!getCachedRecord(symbol)&&!pendingSymbols.has(symbol));
    if(fresh.length){
      for(let offset=0;offset<fresh.length;offset+=LOGO_BATCH_LIMIT){
        const batch=fresh.slice(offset,offset+LOGO_BATCH_LIMIT);
        const batchPromise=(async()=>{
          try{
            const {logos,proxyUrl}=await fetchBatch(batch,proxyUrls,fetchImpl);
            batch.forEach(symbol=>cacheRecord(normalizeRecord(symbol,logos[symbol],proxyUrl)));
          }finally{
            batch.forEach(symbol=>pendingSymbols.delete(symbol));
          }
        })();
        batch.forEach(symbol=>pendingSymbols.set(symbol,batchPromise));
      }
    }
    await Promise.all([...new Set(symbols.map(symbol=>pendingSymbols.get(symbol)).filter(Boolean))]);
    return Object.fromEntries(symbols.map(symbol=>[symbol,getCachedRecord(symbol)||missingRecord(symbol)]));
  }

  async function hydrate(root=global.document,proxyUrls=[],fetchImpl=global.fetch?.bind(global)){
    if(!root?.querySelectorAll)return;
    const slots=[...root.querySelectorAll("[data-logo-symbol]")];
    const symbols=normalizeSymbols(slots.map(slot=>slot.dataset?.logoSymbol));
    if(!symbols.length)return;
    let records;
    try{records=await load(symbols,proxyUrls,fetchImpl)}catch(_error){return}
    slots.forEach(slot=>{
      const symbol=normalizeSymbols([slot.dataset?.logoSymbol])[0];
      const record=symbol&&records[symbol];
      if(!record||record.status!=="verified"||slot.dataset.logoFailed==="true"||slot.querySelector("img"))return;
      const image=slot.ownerDocument.createElement("img");
      image.alt="";image.loading="lazy";image.decoding="async";image.src=record.imageUrl;
      image.addEventListener("load",()=>slot.classList.remove("logo-fallback-active"),{once:true});
      image.addEventListener("error",()=>{image.remove();slot.classList.add("logo-fallback-active");slot.dataset.logoFailed="true"},{once:true});
      slot.appendChild(image);
    });
  }

  function invalidateMissing(values){
    const selected=values==null?null:new Set(normalizeSymbols(values));
    for(const [symbol,entry] of metadataCache){
      if(entry.record.status==="missing"&&(!selected||selected.has(symbol)))metadataCache.delete(symbol);
    }
  }

  function resetForTests(){metadataCache.clear();pendingSymbols.clear()}

  global.MYH88SecurityLogos=Object.freeze({normalizeSymbols,load,hydrate,invalidateMissing,resetForTests});
})(globalThis);
