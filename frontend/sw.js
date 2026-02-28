// sw.js - SuperVenda Service Worker
// Incrementar CACHE_VERSION a cada deploy para forçar atualização
const CACHE_VERSION = "supervenda-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./config.js",
  "./db.js",
  "./app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Requisições de API nunca são cacheadas
  if (e.request.url.includes("/api/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Para assets: cache-first, mas atualiza em background
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(e.request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
