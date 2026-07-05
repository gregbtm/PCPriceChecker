// PC Price Checker service worker.
//
// Strategy is deliberately split by content type:
//  - /api/*        -> never touched by the SW (network-only). This is a live
//                     price tracker; serving a cached price would be worse
//                     than no offline support at all.
//  - /assets/*     -> cache-first. Vite content-hashes these filenames, so a
//                     cached response is always correct for its URL.
//  - everything else (the app shell: /, index.html, manifest, icons)
//                  -> network-first, falling back to cache so the shell still
//                     loads offline or on a flaky connection.
//
// Bump CACHE_NAME when the shell caching strategy itself changes; activate()
// deletes any cache that doesn't match the current name.
const CACHE_NAME = 'pc-price-checker-v1';
const APP_SHELL = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Vite content-hashes every /assets/ filename per build, so the cache-first
// handler below keeps adding a new entry each deploy but never removes the
// previous build's now-unreferenced one. Note this can't run on activate():
// sw.js's own bytes are unchanged across most deploys, so activate() rarely
// re-fires just because app.js/CSS got new hashes. Instead, prune whenever a
// fresh copy of "/" is fetched from the network — that HTML always lists the
// current build's real asset paths, and it's fetched on every online
// load/reload, so this reliably fires once per new deploy a user visits.
// Best-effort: a failed prune just leaves stale entries until the next visit.
async function pruneStaleAssets(html) {
  try {
    const current = new Set([...html.matchAll(/\/assets\/[\w.-]+/g)].map((m) => m[0]));
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.keys();
    await Promise.all(
      cached
        .filter((req) => {
          const path = new URL(req.url).pathname;
          return path.startsWith('/assets/') && !current.has(path);
        })
        .map((req) => cache.delete(req))
    );
  } catch { /* best-effort */ }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        if (url.pathname === '/') {
          response.clone().text().then(pruneStaleAssets);
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/')))
  );
});
