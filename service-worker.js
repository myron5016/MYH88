const CACHE_VERSION="dream-fund-v10-32";
const DATA_CACHE="dream-fund-data-v10-32";
const APP_SHELL=["./","./index.html","./style.css?v=10.32","./script.js?v=10.32","./manifest.webmanifest","./avatar.png","./app-icon.svg","./icon-192.png","./icon-512.png","./kv-quotes-all-current.json"];

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

  if(url.pathname.endsWith("/script.js")||url.pathname.endsWith("/style.css")){
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok)event.waitUntil(caches.open(CACHE_VERSION).then(cache=>cache.put(request,response.clone())));
    return response;
  })));
});
