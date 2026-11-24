// Service worker: the app opens instantly (from cache) and refreshes itself in the background.
const VERSION = 'brewcrew-v1.0.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/api.js', 'js/parse.js', 'js/flavor.js', 'js/analysis.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // always live
  const isShell = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  const isShopImage = /crossroast\.be$/.test(url.hostname) && /\.(jpe?g|png|webp)$/i.test(url.pathname);
  if (!isShell && !isFont && !isShopImage) return;
  // stale-while-revalidate
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: isShell });
      const network = fetch(e.request)
        .then((res) => { if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
