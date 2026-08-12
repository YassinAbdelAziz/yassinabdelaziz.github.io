// yStream BETA service worker — scope is restricted to /beta.
// Registered from /beta/index.html, so it can NEVER affect the production site.
//
// Role in the same-origin experiment:
//  - assist routing: /beta/player and /beta/proxy stay network-first so proxied
//    player content is always fresh,
//  - cache stable proxied static assets (js/css/images/fonts) served through
//    /beta/proxy so the player environment survives reloads and flaky networks,
//  - never cache media or player HTML (they vary with every request).
const CACHE = 'ystream-beta-v1';
const PROXY = '/beta/proxy';
const PLAYER = '/beta/player';
const HEALTH = '/beta/healthz';

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ystream-beta-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Static /beta files we know are stable.
const SHELL = [
  '/beta/index.html',
  '/beta/styles.css',
  '/beta/app.js',
  '/beta/player/beta-player.js',
  '/beta/proxy/proxy-client.js',
  '/beta/diagnostics/diagnostics.js',
  '/beta/popup-blocker/popup-blocker.js',
  '/beta/ad-filter/ad-filter.js',
  '/beta/proxy/proxy-bootstrap.js'
];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Scope guard: only requests under /beta.
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/beta')) return;

  // Navigations under /beta: network first, cache fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/beta/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/beta/index.html')))
    );
    return;
  }

  // Never cache proxied player HTML or the health endpoint.
  if (url.pathname === HEALTH || url.pathname === PLAYER) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Proxied resources: network-first; cache only stable, small static types.
  if (url.pathname === PROXY) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          const cacheable = /(javascript|css|image|font|svg|xml|json)/.test(ct) &&
            Number(res.headers.get('content-length') || 0) < 2 * 1024 * 1024 &&
            res.status === 200;
          if (cacheable) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || new Response('proxy unavailable offline', { status: 502 })))
    );
    return;
  }

  // Other same-origin /beta static assets: cache first.
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('/beta/index.html'));
    })
  );
});
