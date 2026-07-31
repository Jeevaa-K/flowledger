// Kill-switch service worker — wipes any previously cached files,
// unregisters itself, and forces every open tab to reload once so
// no one is ever stuck on a stale cached version of the app again.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Delete every cache this SW (or an older version of it) created
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));

    // Unregister so the browser stops using a service worker at all
    await self.registration.unregister();

    // Force any currently open tabs to reload with a clean network fetch
    const clientsList = await self.clients.matchAll({ type: 'window' });
    clientsList.forEach(client => client.navigate(client.url));
  })());
});

// Never intercept anything — let all requests go to network
self.addEventListener('fetch', () => {});
