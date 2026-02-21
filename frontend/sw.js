const CACHE="vendas-pro-cloud-v1";
const ASSETS=["./","./index.html","./styles.css","./app.js","./db.js","./config.js","./manifest.json"];
self.addEventListener("install", e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate", e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e=>{
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(n=>{
    const c=n.clone(); caches.open(CACHE).then(cc=>cc.put(e.request,c)).catch(()=>{});
    return n;
  }).catch(()=>r)));
});
