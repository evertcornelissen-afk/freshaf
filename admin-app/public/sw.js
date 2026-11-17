// Service worker for the FreshAF admin dashboard.
//
// It deliberately caches NOTHING. Chrome and Edge will not offer "Install" without a
// service worker that handles fetch, so one has to exist — but an admin tool that serves
// a stale copy of itself is exactly the failure we already hit once: the dashboard ran an
// old admin.js and shipped features looked like they had never been built. Worse here,
// since a cached page could show an application's status as it was yesterday and someone
// would approve against it.
//
// So: pass everything straight to the network, every time. The only thing this buys is
// installability, and that is the only thing it is for.
self.addEventListener('install', (event) => {
  // Replace any previous worker immediately rather than waiting for every tab to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clear anything an earlier version of this file might have cached.
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  // No respondWith at all would skip the handler entirely and lose installability on some
  // versions, so answer explicitly — straight from the network, never from a cache.
  event.respondWith(fetch(event.request));
});
