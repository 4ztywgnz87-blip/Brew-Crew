// Service worker.
// App files: always fetched fresh when online (so closing and reopening the app is enough
// to get a new version); the cached copy is only used when there is no connection.
// Fonts and coffee photos: served from cache first (they never change).
const VERSION = 'brewcrew-v1.5.1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/api.js', 'js/parse.js', 'js/flavor.js', 'js/analysis.js', 'js/demo.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function networkFirst(request) {
  return caches.open(VERSION).then((cache) =>
    fetch(request, { cache: 'no-cache' })
      .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
      .catch(() => cache.match(request, { ignoreSearch: true }).then((r) => r || cache.match('index.html')))
  );
}

function cacheFirst(request) {
  return caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
    return res;
  });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) return; // always live
    e.respondWith(networkFirst(e.request));
    return;
  }
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  const isShopImage = /crossroast\.be$/.test(url.hostname) && /\.(jpe?g|png|webp)$/i.test(url.pathname);
  if (isFont || isShopImage) e.respondWith(cacheFirst(e.request));
});
