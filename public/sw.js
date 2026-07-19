// FreshAF service worker — network-first for pages/assets, API always live.
// Also delivers provider job-alert push notifications.
const CACHE = 'freshaf-v2';

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(data.title || 'FreshAF', {
    body: data.body || 'You have a new notification',
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag: data.tag || 'freshaf',
    data: { url: data.url || '/supplier' },
    vibrate: [200, 100, 200],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/supplier';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.includes(url)) return c.focus();
    }
    return clients.openWindow(url);
  }));
});
const PRECACHE = ['/', '/css/style.css', '/js/common.js', '/js/app.js', '/img/logo.svg', '/img/logo-mark.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
