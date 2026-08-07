const RELEASE="11.4.2";
const CACHE_VERSION="dream-fund-v11-4-2";
const DATA_CACHE="dream-fund-data-v10-47";
const APP_SHELL=["./","./index.html","./style.css?v=11.4.2","./fresh-radar.css?v=11.4.2","./layout-v10.34.css?v=11.4.2","./lot-v10.48.css?v=11.4.2","./returns-v10.49.css?v=11.4.2","./dca-v10.53.css?v=11.4.2","./v11-cockpit.css?v=11.4.2","./myh88-core.js?v=11.4.2","./script.part1.js?v=11.4.2","./script.part2.js?v=11.4.2","./script.part3.js?v=11.4.2","./script.part4.js?v=11.4.2","./script.part5.js?v=11.4.2","./script.part6.js?v=11.4.2","./build-meta.json","./manifest.webmanifest","./avatar-baby.jpg","./avatar.png","./app-icon.svg","./icon-192.png","./icon-512.png","./kv-quotes-all-current.json","./logos/rklb.svg","./logos/nvda.svg","./logos/mrvl.svg","./logos/aaoi.svg","./logos/xfab.svg","./logos/vrt.svg","./logos/spcx.svg","./logos/googl.svg","./logos/mu.svg","./logos/dram.svg","./logos/cash.svg"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_VERSION).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_VERSION&&key!==DATA_CACHE).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("message",event=>{
  if(event.data?.type==="SKIP_WAITING")self.skipWaiting();
  if(event.data?.type==="GET_VERSION")event.ports?.[0]?.postMessage({release:RELEASE,cache:CACHE_VERSION});
});

async function networkFirst(request,fallback){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(request,{signal:controller.signal});
    if(response.ok){const cache=await caches.open(DATA_CACHE);await cache.put(fallback||request,response.clone())}
    return response;
  }catch(error){
    const cached=await caches.match(fallback||request);
    if(cached)return cached;
    throw error;
  }finally{clearTimeout(timer)}
}

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(url.pathname.endsWith("/data.json")){
    const stableDataUrl=new URL("./data.json",self.registration.scope).href;
    event.respondWith(networkFirst(request,new Request(stableDataUrl)));
    return;
  }

  if(request.mode==="navigate"){
    event.respondWith(networkFirst(request,new Request(new URL("./index.html",self.registration.scope).href)));
    return;
  }

  if(/\/script\.part\d+\.js$/.test(url.pathname)||url.pathname.endsWith("/myh88-core.js")||url.pathname.endsWith("/style.css")||url.pathname.endsWith("/v11-cockpit.css")||url.pathname.endsWith("/build-meta.json")){
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok)event.waitUntil(caches.open(CACHE_VERSION).then(cache=>cache.put(request,response.clone())));
    return response;
  })));
});
