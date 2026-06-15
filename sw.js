// FantaCaserma Service Worker
// HTML: network-first (sempre aggiornato) | Assets statici: cache-first (veloce)

const CACHE_NAME = 'fantacaserma-v2';
const SHELL_ASSETS = [
  '/fantacaserma/',
  '/fantacaserma/index.html',
  '/fantacaserma/manifest.json',
  '/fantacaserma/icons/icon-192x192.png',
  '/fantacaserma/icons/icon-512x512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Non intercettare Firebase, CDN esterne o il DB
  if (url.hostname !== location.hostname) return;

  // ── Network-first per HTML: scarica sempre la versione più recente ──
  if (url.pathname.endsWith('.html') || url.pathname === '/fantacaserma/' || url.pathname === '/fantacaserma') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request)) // fallback offline
    );
    return;
  }

  // ── Cache-first per assets statici (icone, manifest) ──
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});
