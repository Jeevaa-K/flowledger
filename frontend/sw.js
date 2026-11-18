// FlowLedger Progressive Web App Service Worker
const VERSION = '2.1.0';
const CACHE_NAME = `flowledger-v${VERSION}`;

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/chart.min.js',
  '/js/charts.js',
  '/js/qrcode.min.js',
  '/js/import.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/ui.js',
  '/js/groups.js',
  '/js/recurring.js',
  '/js/app.js',
  '/js/pwa.js',
  '/manifest.json',
  '/favicon.svg',
  '/favicon.png',
  '/favicon-192.png',
  '/favicon-512.png'
];

// Install: pre-cache application shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('PWA Precache warning:', err))
  );
});

// Activate: clean up outdated caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Non-GET requests (POST, PUT, DELETE) pass directly to network
  if (req.method !== 'GET') {
    return;
  }

  // API Requests: Stale-While-Revalidate with offline fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cachedRes = await cache.match(req);

        const fetchPromise = fetch(req)
          .then(networkRes => {
            if (networkRes && networkRes.status === 200) {
              cache.put(req, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => {
            if (!cachedRes) {
              return new Response(
                JSON.stringify({ offline: true, error: "You are currently offline. Check your internet connection." }),
                {
                  status: 503,
                  headers: { 'Content-Type': 'application/json' }
                }
              );
            }
          });

        return cachedRes || fetchPromise;
      })
    );
    return;
  }

  // HTML page navigations: Network-first with cached index.html fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // Static Assets (scripts, styles, fonts, images): Cache-first with background network revalidation
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req)
        .then(networkRes => {
          if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
