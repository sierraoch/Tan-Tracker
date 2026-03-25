const CACHE_NAME = 'tan-tracker-v7';

self.addEventListener('install', event => {
  // Don't precache — always fetch fresh app shell from network
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Wipe ALL old caches immediately on every update
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // JS/CSS app shell — network-first, short cache
  if (url.pathname.match(/\.(js|css|html)$/) || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else (API, Mapbox, fonts) — network only
  event.respondWith(fetch(event.request));
});
