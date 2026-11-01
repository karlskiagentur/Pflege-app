const VAPID_PUBLIC_KEY = "BGsTbCfunMpxOpMNTuMy9S5ERDA1yUi3mYhWa5zkBOXrcCnDxLSaYt4ixweedP7zhP4sOUG3--ZrjssD0W2daFo";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Fertiger applicationServerKey (Uint8Array) für pushManager.subscribe()
export const VAPID_APP_SERVER_KEY = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (!('serviceWorker' in navigator)) {
      console.error('Service Worker wird von diesem Browser nicht unterstützt.');
      return null;
    }
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return registration;
  } catch (e) {
    console.error('Service Worker Registrierung fehlgeschlagen:', e);
    return null;
  }
}

// token = Session_Token des Klienten (der Server findet den Datensatz selbst).
export async function subscribeToPush(token: string): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.error('Push wird von diesem Browser nicht unterstützt.');
      return false;
    }

    const registration = await registerServiceWorker();
    if (!registration) return false;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.error('Benachrichtigungen wurden nicht erlaubt:', permission);
      return false;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_APP_SERVER_KEY
    });

    const response = await fetch('/api/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, subscription: subscription.toJSON() })
    });

    if (!response.ok) {
      console.error('Subscription konnte nicht gespeichert werden:', response.status);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Push-Abonnement fehlgeschlagen:', e);
    return false;
  }
}

export async function subscribeMitarbeiter(mitarbeiterId: string, token?: string): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.error('Push wird von diesem Browser nicht unterstützt.');
      return false;
    }

    // 1. Permission prüfen
    console.log('Permission:', Notification.permission);
    if (Notification.permission === 'denied') {
      console.error('Benachrichtigungen sind blockiert.');
      return false;
    }
    // 2. Bei 'default' Erlaubnis einholen
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      console.log('Permission nach Abfrage:', permission);
      if (permission !== 'granted') {
        console.error('Benachrichtigungen wurden nicht erlaubt:', permission);
        return false;
      }
    }

    // 3. Service Worker holen (ggf. registrieren)
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      console.log('Kein SW gefunden, registriere neu …');
      const newReg = await registerServiceWorker();
      if (!newReg) return false;
      registration = newReg;
    }
    await navigator.serviceWorker.ready;
    console.log('ServiceWorker bereit:', registration.scope);

    // 4. Bestehende Subscription wiederverwenden oder neu erstellen
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      console.log('Bestehendes Abo gefunden, wiederverwenden.');
    } else {
      console.log('Kein Abo, rufe pushManager.subscribe() auf …');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    console.log('Subscription:', subscription.toJSON());

    // 5. Abo IMMER an Airtable schicken (auch wenn schon eines existierte)
    //    Auth über den Mitarbeiter-Session-Token (Server ermittelt den Datensatz selbst).
    const authToken = token || localStorage.getItem('active_mitarbeiter_token') || '';
    const response = await fetch('/api/abo-pfleger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ mitarbeiterId: mitarbeiterId, subscription: subscription.toJSON() })
    });
    if (!response.ok) {
      console.error('Subscription konnte nicht gespeichert werden:', response.status);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Push-Abonnement (Mitarbeiter) fehlgeschlagen:', e);
    return false;
  }
}

export async function isPushSubscribed(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch (e) {
    console.error('Prüfung des Push-Status fehlgeschlagen:', e);
    return false;
  }
}

// --- Gerät und Konto -------------------------------------------------------------------
// Ein Gerät bekommt nur die Pushs des Kontos, das gerade darauf angemeldet ist (Vorfall
// 01.11.2026: nach einem Kontowechsel kamen Einsatz-Pushs des vorherigen Kontos weiter an).
// Der Server entfernt beim Speichern dasselbe Gerät bei allen anderen Konten (api/_abo.js).

const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Beim Abmelden: das Push-Abo dieses Geräts vom bisherigen Konto lösen. Wartet höchstens
 * 1,5 s und wirft nie – das Abmelden selbst darf daran nicht hängen. Das Abo auf dem Gerät
 * bleibt bestehen; die nächste Anmeldung übernimmt es ohne erneute Nachfrage.
 */
export async function pushVomKontoLoesen(token: string | null | undefined): Promise<void> {
  if (!token) return;
  const loesen = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) return;
    await fetch('/api/save-subscription', {
      method: 'POST',
      keepalive: true, // läuft weiter, auch wenn die Seite gleich danach neu lädt
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, abmelden: true, endpoint: subscription.endpoint }),
    });
  };
  try {
    await Promise.race([loesen(), warte(1500)]);
  } catch (e) {
    console.log('Push-Abo beim Abmelden nicht gelöst:', e);
  }
}

/**
 * Nach der Anmeldung eines Klienten: Gibt es auf diesem Gerät schon ein Push-Abo und sind
 * Benachrichtigungen erlaubt, wird es still diesem Konto zugeordnet. Legt kein neues Abo an
 * und fragt nie nach einer Erlaubnis.
 */
export async function pushAboUebernehmen(token: string | null | undefined): Promise<boolean> {
  try {
    if (!token || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) return false;
    const response = await fetch('/api/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, subscription: subscription.toJSON() }),
    });
    return response.ok;
  } catch (e) {
    console.log('Push-Abo nicht übernommen:', e);
    return false;
  }
}
