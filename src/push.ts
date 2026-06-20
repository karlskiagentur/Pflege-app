const VAPID_PUBLIC_KEY = "BGsTbCfunMpxOpMNTuMy9S5ERDA1yUi3mYhWa5zkBOXrcCnDxLSaYt4ixweedP7zhP4sOUG3--ZrjssD0W2daFo";
const SAVE_SUBSCRIPTION_URL = "https://karlskiagentur.app.n8n.cloud/webhook/save_push_subscription";

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

export async function subscribeToPush(patientId: string): Promise<boolean> {
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
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    const response = await fetch(SAVE_SUBSCRIPTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: patientId, subscription: subscription.toJSON() })
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

export async function subscribeMitarbeiter(mitarbeiterId: string): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.error('Push wird von diesem Browser nicht unterstützt.');
      return false;
    }

    // 1. Permission prüfen
    if (Notification.permission === 'denied') {
      console.error('Benachrichtigungen sind blockiert.');
      return false;
    }
    // 2. Bei 'default' Erlaubnis einholen
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.error('Benachrichtigungen wurden nicht erlaubt:', permission);
        return false;
      }
    }

    // 3. Service Worker holen (ggf. registrieren)
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      const newReg = await registerServiceWorker();
      if (!newReg) return false;
      registration = newReg;
    }
    await navigator.serviceWorker.ready;

    // 4. Bestehende Subscription wiederverwenden oder neu erstellen
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    // 5. Abo IMMER an Airtable schicken (auch wenn schon eines existierte)
    const response = await fetch('/api/abo-pfleger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
