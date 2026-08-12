// yStream service worker
// Caches the app shell for offline use and serves static assets cache-first.
// Data/API requests and third-party embeds/images are left to the network.
const CACHE='ystream-v1';
const SHELL=[
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/styles.css?v=4',
  '/app.js?v=4'
];

self.addEventListener('install',(e)=>{
  e.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',(e)=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',(e)=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  // Navigations: always try the network so fresh content is served, and
  // fall back to the cached shell when offline.
  if(req.mode==='navigate'){
    e.respondWith(
      fetch(req)
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put('/',copy));
          return res;
        })
        .catch(()=>caches.match(req).then(r=>r||caches.match('/')))
    );
    return;
  }

  // Same-origin static assets: cache first, then fetch and store.
  e.respondWith(
    caches.match(req).then(cached=>{
      if(cached)return cached;
      return fetch(req).then(res=>{
        if(res.ok&&(res.type==='basic'||res.type==='default')){
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put(req,copy));
        }
        return res;
      }).catch(()=>caches.match('/'));
    })
  );
});
