const RELEASE="11.7.1";
const CACHE_VERSION="dream-fund-v11-7-1";
const DATA_CACHE="dream-fund-data-v10-47";
const APP_SHELL=["./","./index.html","./style.css?v=11.6.0","./fresh-radar.css?v=11.6.0","./layout-v10.34.css?v=11.6.0","./lot-v10.48.css?v=11.6.0","./returns-v10.49.css?v=11.6.0","./dca-v10.53.css?v=11.6.0","./v11-cockpit.css?v=11.6.0","./brand-v11.6.css?v=11.6.0","./myh88-core.js?v=11.6.0","./script.part1.js?v=11.6.0","./script.part2.js?v=11.6.0","./script.part3.js?v=11.6.0","./script.part4.js?v=11.6.0","./script.part5.js?v=11.6.0","./script.part6.js?v=11.6.0","./brand-v11.6.js?v=11.6.0","./brand-v11.7.css?v=11.7.1","./brand-v11.7.js?v=11.7.1","./build-meta.json","./manifest.webmanifest","./avatar-baby.jpg","./avatar.png","./app-icon.svg","./icon-192.png","./icon-512.png","./assets/hero-orchard.jpg","./assets/closing-path.jpg","./kv-quotes-all-current.json","./logos/rklb.svg","./logos/nvda.svg","./logos/mrvl.svg","./logos/aaoi.svg","./logos/xfab.svg","./logos/vrt.svg","./logos/spcx.svg","./logos/googl.svg","./logos/mu.svg","./logos/dram.svg","./logos/cash.svg"];

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

  // The same-origin quote bridge must always reach Pages Functions. Caching
  // this response in the app shell can pin a mobile browser to an old quote
  // status for the rest of the day.
  if(url.pathname==="/api"||url.pathname.startsWith("/api/")){
    event.respondWith(fetch(request,{cache:"no-store"}));
    return;
  }

  if(url.pathname.endsWith("/data.json")){
    const stableDataUrl=new URL("./data.json",self.registration.scope).href;
    event.respondWith(networkFirst(request,new Request(stableDataUrl)));
    return;
  }

  if(request.mode==="navigate"){
    event.respondWith(networkFirst(request,new Request(new URL("./index.html",self.registration.scope).href)));
    return;
  }

  if(/\/script\.part\d+\.js$/.test(url.pathname)||url.pathname.endsWith("/myh88-core.js")||url.pathname.endsWith("/brand-v11.6.js")||url.pathname.endsWith("/brand-v11.7.js")||url.pathname.endsWith("/style.css")||url.pathname.endsWith("/v11-cockpit.css")||url.pathname.endsWith("/brand-v11.6.css")||url.pathname.endsWith("/brand-v11.7.css")||url.pathname.endsWith("/build-meta.json")){
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok)event.waitUntil(caches.open(CACHE_VERSION).then(cache=>cache.put(request,response.clone())));
    return response;
  })));
});
