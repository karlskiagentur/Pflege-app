import webpush from 'web-push';
import { airtable, TABLES } from './_lib.js';

// Web-Push an EINEN Mitarbeiter (Personal.Push_Subscription) - gleiche VAPID-Daten wie
// api/send-push*.js. Konfiguriert wird erst beim ersten Versand: ein fehlender Schlüssel
// wird so zu einem gemeldeten Fehler im Aufrufer statt zu einem Absturz beim Laden.
const VAPID_PUBLIC_KEY =
  'BGsTbCfunMpxOpMNTuMy9S5ERDA1yUi3mYhWa5zkBOXrcCnDxLSaYt4ixweedP7zhP4sOUG3--ZrjssD0W2daFo';
let konfiguriert = false;
function konfigurieren() {
  if (konfiguriert) return;
  webpush.setVapidDetails('mailto:soulstories.love@gmail.com', VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  konfiguriert = true;
}

/**
 * Sendet einen Push an einen Mitarbeiter (Personal-Record mit Aktiv + Push_Subscription).
 * Ergebnis: { gesendet: true } oder { gesendet: false, grund, code? }.
 * Lehnt der Push-Dienst ab (404/410 = Abo abgelaufen), ist das kein technischer Fehler:
 * das Abo wird entfernt. Echte Fehler (fehlender Schlüssel, Netz) werfen.
 */
export async function pushAnMitarbeiter(personal, titel, text) {
  const f = (personal && personal.fields) || {};
  if (!f.Aktiv) return { gesendet: false, grund: 'Mitarbeiter nicht aktiv' };
  const abo = f.Push_Subscription;
  if (!abo) return { gesendet: false, grund: 'Kein Push-Abo' };
  let subscription;
  try {
    subscription = typeof abo === 'string' ? JSON.parse(abo) : abo;
  } catch {
    return { gesendet: false, grund: 'Abo ungültig' };
  }
  konfigurieren();
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title: titel, body: text }));
    return { gesendet: true };
  } catch (err) {
    const code = err && err.statusCode;
    if (!code) throw err;
    if (code === 404 || code === 410) {
      try {
        await airtable(`${TABLES.PERSONAL}/${personal.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: { Push_Subscription: '' } }),
        });
      } catch (_) { /* Aufräumen ist best effort */ }
      return { gesendet: false, grund: 'Abo abgelaufen', code };
    }
    return { gesendet: false, grund: 'Zustellung abgelehnt', code };
  }
}
