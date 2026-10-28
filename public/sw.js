// Service Worker: Push-Benachrichtigungen + Offline-Grundfähigkeit.
// Ziel: Die App darf bei fehlendem Netz NICHT als weißer Bildschirm enden.

const CACHE = 'wunschlos-v3';
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
  // API/Backend und den Versions-Check (?vc=) niemals aus dem Cache bedienen.
  // Videos (.mp4) ebenfalls nicht: iOS streamt per Range-Anfragen (206) - eine
  // Cache-Antwort wuerde das Abspielen brechen; ausserdem Client-Speicher schonen.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('n8n') || url.searchParams.has('vc') || url.pathname.endsWith('.mp4')) {
    return; // Standard-Netzwerkverhalten, nicht cachen
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

// Ziele, die ein Tipp auf einen Push öffnet (gleiche Liste wie api/_push.js / App).
const PUSH_ZIELE = ['plan', 'lohn', 'nachrichten', 'termine', 'dokumente'];
const zielOk = (z) => (typeof z === 'string' && PUSH_ZIELE.includes(z) ? z : '');

// Offene App-Fenster benachrichtigen (z. B. damit die App sofort neu lädt und „NEU“ zeigt).
async function fensterBenachrichtigen(nachricht) {
  try {
    const liste = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of liste) {
      try { c.postMessage(nachricht); } catch (e) {}
    }
  } catch (e) {}
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const ziel = zielOk(data.ziel);

  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || 'Wunschlos Pflege', {
      body: data.body || 'Neue Information',
      icon: '/icon.png',
      badge: '/icon.png',
      data: { ziel }
    });
    // App-Icon-Badge (iOS 16.4+ PWA / Android) - randfall-sicher
    if (self.navigator.setAppBadge) {
      try { await self.navigator.setAppBadge(data.badge || 1); } catch (e) {}
    }
    // Ist die App gerade offen, lädt sie die Neuigkeiten sofort nach.
    await fensterBenachrichtigen({ typ: 'push-eingang', ziel });
  })());
});

// Tipp auf die Benachrichtigung: App öffnen bzw. nach vorne holen - und zwar genau die
// Ansicht, in der der Inhalt steht (Tagesplan, Lohn, Mitteilungen, Termine, Dokumente).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ziel = zielOk(event.notification.data && event.notification.data.ziel);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          try { client.postMessage({ typ: 'push-klick', ziel }); } catch (e) {}
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(ziel ? '/?ziel=' + ziel : '/');
      }
    })
  );
});
