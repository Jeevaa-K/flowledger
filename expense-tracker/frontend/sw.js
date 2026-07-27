// Minimal service worker — only caches CSS/JS, never touches API
const CACHE = 'flowledger-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Never intercept anything — let all requests go to network
self.addEventListener('fetch', () => {});
