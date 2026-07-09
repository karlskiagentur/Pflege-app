// Service Worker: Push-Benachrichtigungen + Offline-Grundfähigkeit.
// Ziel: Die App darf bei fehlendem Netz NICHT als weißer Bildschirm enden.

const CACHE = 'wunschlos-v2';
// App-Shell, die offline verfügbar sein soll.
const SHELL = ['/', '/index.html', '/manifest.json', '/icon.png'];

// Bei Installation die App-Shell vorab cachen und sofort aktiv werden.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Alte Caches aufräumen und Kontrolle sofort übernehmen.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch-Strategie:
// - API-/n8n-Aufrufe: immer Netzwerk (nie cachen – Daten müssen frisch sein).
// - Navigationen (HTML): network-first mit Fallback auf die gecachte App-Shell.
// - statische Assets: cache-first mit Netz-Nachladen.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // API/Backend niemals aus dem Cache bedienen.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('n8n')) {
    return; // Standard-Netzwerkverhalten
  }

  // Seiten-Navigationen: erst Netz, bei Offline die App-Shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Übrige GET-Assets: cache-first, im Hintergrund aktualisieren.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || 'Wunschlos Pflege', {
      body: data.body || 'Neue Information',
      icon: '/icon.png',
      badge: '/icon.png'
    });
    // App-Icon-Badge (iOS 16.4+ PWA / Android) - randfall-sicher
    if (self.navigator.setAppBadge) {
      try { await self.navigator.setAppBadge(data.badge || 1); } catch (e) {}
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
