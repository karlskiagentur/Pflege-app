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

// Ziel in der App, das ein Tipp auf den Push öffnet (public/sw.js -> /?ziel=…, App.tsx):
//   plan        Mitarbeiter: Tagesplan        lohn       Mitarbeiter: Lohn / Zeit
//   nachrichten Startseite mit Mitteilungen   termine    Klient: Planer
//   dokumente   Klient: Dokumente
// Unbekannte Ziele werden weggelassen (der Tipp öffnet dann wie bisher die Startseite).
export const PUSH_ZIELE = ['plan', 'lohn', 'nachrichten', 'termine', 'dokumente'];

/** Push-Inhalt als JSON: Titel, Text und optional das Ziel in der App. */
export function pushNutzlast(titel, text, ziel) {
  const daten = { title: String(titel || 'Wunschlos Pflege'), body: String(text || '') };
  if (ziel && PUSH_ZIELE.includes(ziel)) daten.ziel = ziel;
  return JSON.stringify(daten);
}

// --- Zeitangaben für Mitarbeiter-Pushs (immer deutsche Zeit) -------------------------
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const erster = (v) => (Array.isArray(v) ? v[0] : v);
const zwei = (n) => String(n).padStart(2, '0');

function berlinTeile(date) {
  const teile = {};
  for (const p of new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)) teile[p.type] = p.value;
  return teile;
}

/**
 * Zeitpunkt eines Einsatzes als Text, z. B. "am Mo, 03.11. um 08:00 Uhr".
 * Quelle: Uhrzeit (Zeitpunkt, in Berliner Zeit umgerechnet), sonst Datum + Von.
 * Ohne verwertbare Angabe: "" (der Satz kommt dann ohne Zeitpunkt aus).
 */
export function einsatzZeitText(fields) {
  const f = fields || {};
  const roh = erster(f.Uhrzeit);
  if (roh) {
    const d = new Date(roh);
    if (!Number.isNaN(d.getTime())) {
      const t = berlinTeile(d);
      const tag = new Date(Date.UTC(Number(t.year), Number(t.month) - 1, Number(t.day))).getUTCDay();
      return `am ${WOCHENTAGE[tag]}, ${t.day}.${t.month}. um ${t.hour}:${t.minute} Uhr`;
    }
  }
  const datum = String(erster(f.Datum) || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(datum);
  if (!m) return '';
  const tag = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  const vonRoh = erster(f.Von);
  const von = typeof vonRoh === 'string' ? vonRoh : (vonRoh && vonRoh.name) || '';
  const uhr = /^\d{1,2}:\d{2}$/.test(von) ? ` um ${zwei(von.split(':')[0])}:${von.split(':')[1]} Uhr` : '';
  return `am ${WOCHENTAGE[tag]}, ${m[3]}.${m[2]}.${uhr}`;
}

/**
 * Sendet einen Push an einen Mitarbeiter (Personal-Record mit Aktiv + Push_Subscription).
 * Ergebnis: { gesendet: true } oder { gesendet: false, grund, code? }.
 * Lehnt der Push-Dienst ab (404/410 = Abo abgelaufen), ist das kein technischer Fehler:
 * das Abo wird entfernt. Echte Fehler (fehlender Schlüssel, Netz) werfen.
 */
export async function pushAnMitarbeiter(personal, titel, text, ziel) {
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
    await webpush.sendNotification(subscription, pushNutzlast(titel, text, ziel));
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
