/* Service worker: cache-first app shell, so the app opens instantly and offline after the
   first visit. Signalling (another origin) is never touched. VERSION and PRECACHE are
   filled in at build time by the sw plugin in vite.config.ts. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = 'lcc-shell-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('lcc-shell-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((c) =>
      // ignoreSearch: /speak/?room=K7PX is the same page as /speak/.
      c.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || fetch(req)),
    ),
  );
});
