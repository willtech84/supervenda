// SuperVenda Service Worker — Offline First v2
const CACHE_NAME = 'supervenda-v2';
const OFFLINE_QUEUE_KEY = 'sv_offline_queue';

// Arquivos para cachear (shell do app)
const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/db.js',
  '/manifest.json',
];

// ── Install: cachear shell do app ────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(CACHE_ASSETS.map(url => new Request(url, {cache: 'reload'}))).catch(() => {}))
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

// ── Helpers ─────────────────────────────────────────────────────────────────
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isLocalAsset(url) {
  // Considera como asset local: mesmo origin, ou sem hostname (relativo)
  return url.hostname === self.location.hostname ||
         url.hostname === 'localhost' ||
         url.hostname === '127.0.0.1';
}

function isCdnRequest(url) {
  return url.hostname.includes('cdnjs.cloudflare.com') ||
         url.hostname.includes('unpkg.com') ||
         url.hostname.includes('nominatim.openstreetmap.org') ||
         url.hostname.includes('tile.openstreetmap.org');
}

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' && !isApiRequest(new URL(e.request.url))) return;

  const url = new URL(e.request.url);

  // API calls: network-first, fallback offline response
  if (isApiRequest(url)) {
    e.respondWith(
      fetch(e.request.clone()).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // CDN externos: network com cache
  if (isCdnRequest(url)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(resp => {
          if (resp && resp.status === 200) {
            const toCache = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, toCache));
          }
          return resp;
        }).catch(() => cached || new Response('', {status: 503}));
      })
    );
    return;
  }

  // Assets locais: cache-first com network fallback
  if (isLocalAsset(url)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(resp => {
          if (resp && resp.status === 200 && e.request.method === 'GET') {
            const toCache = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, toCache));
          }
          return resp;
        }).catch(() => null);

        // Retornar cache imediato + atualizar em background
        if (cached) {
          networkFetch.catch(() => {}); // atualiza em bg
          return cached;
        }
        return networkFetch.then(r => r || caches.match('/index.html'));
      })
    );
    return;
  }

  // Outros (nominatim, etc): network normal
  e.respondWith(fetch(e.request).catch(() => new Response('', {status: 503})));
});

// ── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sv-sync-queue') {
    e.waitUntil(processarFila());
  }
});

async function processarFila() {
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'PROCESS_QUEUE' }));
}

// ── Mensagens do app ─────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'CACHE_UPDATE') {
    caches.open(CACHE_NAME).then(c => {
      CACHE_ASSETS.forEach(url => {
        fetch(url).then(r => { if (r.ok) c.put(url, r); }).catch(() => {});
      });
    });
  }
});
