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
    // App-Icon-Badge "1" (iOS 16.4+ PWA / Android) - randfall-sicher
    if (self.navigator.setAppBadge) {
      try { await self.navigator.setAppBadge(1); } catch (e) {}
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
