// FantaCaserma Service Worker
// Cache solo per assets statici (shell), Firebase rimane live

const CACHE_NAME = 'fantacaserma-v1';
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
  // Solo GET; lascia passare Firebase e CDN
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Non interceptare Firebase, CDN esterne o il DB
  if (url.hostname !== location.hostname) return;

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
