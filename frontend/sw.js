// SuperVenda Service Worker — Offline First
const CACHE_NAME = 'supervenda-v1';
const OFFLINE_QUEUE_KEY = 'sv_offline_queue';

// Arquivos para cachear (shell do app)
const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/db.js',
  '/config.js',
];

// ── Install: cachear shell do app ────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(CACHE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: limpar caches antigos ─────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first para assets, network-first para API ──────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: network-first, sem cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request.clone())
        .catch(() => new Response(
          JSON.stringify({ error: 'offline', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // Fontes e CDN externos: network com fallback
  if (!url.hostname.includes('pages.dev') && !url.hostname.includes('localhost') && url.protocol === 'https:') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Assets locais: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && e.request.method === 'GET') {
          const toCache = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, toCache));
        }
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

// ── Background Sync: processar fila offline ──────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sv-sync-queue') {
    e.waitUntil(processarFila());
  }
});

async function processarFila() {
  // Notificar clientes para processar a fila
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'PROCESS_QUEUE' }));
}

// ── Mensagens do app ─────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'CACHE_UPDATE') {
    // Atualizar cache quando app receber novos assets
    caches.open(CACHE_NAME).then(c => {
      CACHE_ASSETS.forEach(url => {
        fetch(url).then(r => { if (r.ok) c.put(url, r); }).catch(() => {});
      });
    });
  }
});
