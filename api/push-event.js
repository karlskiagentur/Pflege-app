import webpush from 'web-push';
import { airtable, fetchAll, sendInfoCopy, TABLES } from './_lib.js';

// Gleiche VAPID/web-push-Konfiguration wie api/send-push (gleiche Env-Variablen)
const VAPID_PUBLIC_KEY =
  'BGsTbCfunMpxOpMNTuMy9S5ERDA1yUi3mYhWa5zkBOXrcCnDxLSaYt4ixweedP7zhP4sOUG3--ZrjssD0W2daFo';
webpush.setVapidDetails(
  'mailto:soulstories.love@gmail.com',
  VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const MITTEILUNGEN = 'tblQYvzkhvBnDyXdv';
const TITLE = 'Wunschlos Pflege';

// Lookup-/Link-Felder tolerant auslesen
const firstLink = (v) => (Array.isArray(v) ? v[0] : v);
const val = (v) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
const txt = (v) => String(val(v));

// de-DE Datum + Uhrzeit (deutsche Zeitzone, damit die Uhrzeit stimmt)
function fmt(v) {
  const raw = val(v);
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
}

// Datensatz laden. Nicht gefunden (404) -> null (fachlich leer);
// echte Fehler (Airtable nicht erreichbar, 429, 5xx) werfen weiter -> 500.
async function loadRec(table, id) {
  if (!id) return null;
  try {
    return await airtable(`${table}/${id}`);
  } catch (e) {
    if (e && e.status === 404) return null;
    throw e;
  }
}

// Push_Subscription eines Records (falls vorhanden) in das Set aufnehmen (dedupliziert)
function addSub(set, rec) {
  const abo = rec && rec.fields && rec.fields.Push_Subscription;
  if (abo) set.add(typeof abo === 'string' ? abo : JSON.stringify(abo));
}

async function addPatientSub(set, patientId) {
  addSub(set, await loadRec(TABLES.PATIENTEN, patientId));
}
async function addPersonalSub(set, personalId) {
  addSub(set, await loadRec(TABLES.PERSONAL, personalId));
}

// Endpoint gekürzt fürs Log (letzte ~12 Zeichen genügen zur Unterscheidung)
const kurzEndpoint = (sub) => {
  try { const e = JSON.parse(sub).endpoint || ''; return '...' + e.slice(-12); } catch { return '?'; }
};

// Versendet an alle Abos, sammelt je Abo ein Detail-Ergebnis (fürs Airtable-Log)
async function sendToAll(subs, message) {
  const payload = JSON.stringify({ title: TITLE, body: message });
  let gesendet = 0, fehlgeschlagen = 0;
  const details = [];
  for (const s of subs) {
    const endpointKurz = kurzEndpoint(s);
    try {
      const r = await webpush.sendNotification(JSON.parse(s), payload);
      gesendet++;
      details.push({ endpointKurz, code: (r && r.statusCode) || 201 });
    } catch (err) {
      fehlgeschlagen++;
      const code = err && err.statusCode;
      const eintrag = { endpointKurz, code: code || 'ERR' };
      if (code === 404 || code === 410) {
        eintrag.hinweis = 'Abo abgelaufen - Klient muss Benachrichtigungen in der App neu aktivieren';
      } else {
        eintrag.fehler = String((err && err.message) || err);
      }
      console.error('Push fehlgeschlagen:', endpointKurz, code, err && err.body);
      details.push(eintrag);
    }
  }
  return { gesendet, fehlgeschlagen, details };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  const { type, recordId, ereignis } = req.body || {};

  // Leere/kaputte Payloads (z.B. Airtable-Testläufe) sind kein Fehler
  if (!type || !recordId) {
    res.status(200).json({ status: 'skipped', grund: 'Ungültiger Aufruf' }); return;
  }

  try {
    const subs = new Set();
    let message = '';
    let istMitteilung = false;
    let infoKopie = null; // { typ, empfaenger } -> Info-Kopie ans Büro (nur besuch/dokument/mitteilung)
    let gateTable = null; // Besuche/Dokumente: Push nur nach bewusster Freigabe (Push_senden='Senden')

    if (type === 'besuch') {
      const rec = await loadRec(TABLES.BESUCHE, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Besuch nicht gefunden' }); return; }
      const f = rec.fields || {};
      // Bestaetigungs-Gate: Push nur, wenn der Mitarbeiter im Interface aktiv freigegeben hat.
      if (txt(f.Push_senden) !== 'Senden') { res.status(200).json({ status: 'skipped', grund: 'Push nicht freigegeben' }); return; }
      gateTable = TABLES.BESUCHE;
      const patientIds = f.Patient || [];
      if (patientIds.length === 0) { res.status(200).json({ status: 'skipped', grund: 'Kein Klient verknüpft' }); return; }
      const taetigkeit = txt(f['Tätigkeit']) || 'Unterstützung';
      const wann = fmt(f['Uhrzeit']);
      // Anlass serverseitig aus dem Datensatz ableiten - der Freigabe-Trigger
      // (Push_senden='Senden') kennt den Anlass nicht. Status/Hervorhebung sind
      // die verlässliche Quelle; ein explizit übergebenes ereignis bleibt Fallback.
      const status = txt(f.Status);
      const marker = txt(f.Hervorhebung);
      let anlass = ereignis || 'Neu';
      if (status === 'Abgesagt' || marker === 'Storniert') anlass = 'Abgesagt';
      else if (marker === 'Änderung') anlass = 'Geändert';
      if (anlass === 'Abgesagt') {
        message = `Ihr Termin "${taetigkeit}" wurde abgesagt.`;
      } else if (anlass === 'Geändert') {
        message = `Ihr Termin "${taetigkeit}" wurde geändert` + (wann ? ` - neuer Termin: ${wann}.` : '.');
      } else {
        message = `Neuer Termin: "${taetigkeit}"` + (wann ? ` am ${wann}` : '');
      }
      await addPatientSub(subs, patientIds[0]);
      // Zusätzlich den dem Besuch zugeteilten Mitarbeiter benachrichtigen.
      // Zustellungen sind unabhängig (sendToAll behandelt jedes Abo einzeln).
      const pflegerId = firstLink(f.Pfleger) || firstLink(f.Pfleger_ID);
      const vorSize = subs.size;
      if (pflegerId) await addPersonalSub(subs, pflegerId);
      infoKopie = { typ: 'Termin', empfaenger: subs.size > vorSize ? 'Klient + zugeteilter Mitarbeiter' : 'Klient' };

    } else if (type === 'dokument') {
      const rec = await loadRec(TABLES.DOKUMENTE, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Dokument nicht gefunden' }); return; }
      const f = rec.fields || {};
      // Bestaetigungs-Gate: Push nur, wenn der Mitarbeiter im Interface aktiv freigegeben hat.
      if (txt(f.Push_senden) !== 'Senden') { res.status(200).json({ status: 'skipped', grund: 'Push nicht freigegeben' }); return; }
      gateTable = TABLES.DOKUMENTE;
      const patientIds = f.Patient || [];
      if (patientIds.length === 0) { res.status(200).json({ status: 'skipped', grund: 'Kein Klient verknüpft' }); return; }
      message = `Neue(r) ${txt(f.Typ)} für Sie verfügbar - jetzt in der App ansehen.`;
      await addPatientSub(subs, patientIds[0]);
      infoKopie = { typ: 'Dokument', empfaenger: 'Klient' };

    } else if (type === 'terminanfrage') {
      // Klient -> Pflegedienst: neue Terminanfrage/-änderung aus der App.
      // Empfänger: alle aktiven Mitarbeiter mit Push-Abo. Doppel-Schutz über
      // das Feld Buero_benachrichtigt (wird nach dem Versand gesetzt).
      const rec = await loadRec(TABLES.TERMINANFRAGEN, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Anfrage nicht gefunden' }); return; }
      const f = rec.fields || {};
      if (f.Buero_benachrichtigt) { res.status(200).json({ status: 'skipped', grund: 'Bereits benachrichtigt' }); return; }
      gateTable = null; // eigener Marker statt Push_senden (s.u.)
      const personal = await fetchAll(TABLES.PERSONAL, 'fields%5B%5D=Push_Subscription&fields%5B%5D=Aktiv');
      personal.filter((p) => p.fields && p.fields.Aktiv).forEach((p) => addSub(subs, p));
      message = txt(f.Art) === 'Terminänderung'
        ? 'Terminänderungs-Wunsch eines Klienten eingegangen - bitte im Büro prüfen.'
        : 'Neue Termin-Anfrage eines Klienten eingegangen - bitte im Büro prüfen.';
      // Marker sofort setzen (unabhängig davon, ob gerade jemand ein Abo hat),
      // damit die Anfrage nicht bei jedem Automationslauf erneut geprüft wird.
      await airtable(`${TABLES.TERMINANFRAGEN}/${recordId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Buero_benachrichtigt: true } }),
      });

    } else if (type === 'mitteilung') {
      istMitteilung = true;
      const rec = await loadRec(MITTEILUNGEN, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Mitteilung nicht gefunden' }); return; }
      const f = rec.fields || {};
      // Alt-Optionen der Zielgruppe tolerant auf die gültigen abbilden
      // ("Error darf nie entstehen": eine falsch gewählte Alt-Option darf den
      // Versand nicht ins Leere laufen lassen).
      const zielRoh = txt(f.Zielgruppe);
      const ziel = zielRoh === 'Patienten' ? 'Alle Patienten'
        : zielRoh === 'Mitarbeiter' ? 'Alle Mitarbeiter'
        : zielRoh === 'Alle (Broadcast)' ? 'Alle gesamt'
        : zielRoh;

      if (ziel === 'Alle Patienten' || ziel === 'Alle gesamt') {
        const patienten = await fetchAll(TABLES.PATIENTEN, "fields%5B%5D=Push_Subscription");
        patienten.forEach((p) => addSub(subs, p));
      }
      if (ziel === 'Alle Mitarbeiter' || ziel === 'Alle gesamt') {
        const personal = await fetchAll(TABLES.PERSONAL, "fields%5B%5D=Push_Subscription");
        personal.forEach((p) => addSub(subs, p));
      }

      // Immer zusätzlich die direkt Betroffenen benachrichtigen (unabhängig von Zielgruppe)
      const betroffen = firstLink(f.Betroffener_Patient);
      if (betroffen) await addPatientSub(subs, betroffen);
      for (const id of [].concat(f.Ausfall_Mitarbeiter || [], f.Ersatz_Mitarbeiter || [])) {
        await addPersonalSub(subs, id);
      }

      if (txt(f.Typ) === 'Ausfall') {
        message = `Mitarbeiter/in ${txt(f.Mitarbeiter_Ausfall)} fällt aus, deshalb kommt Mitarbeiter/in ${txt(f.Mitarbeiter_Ersatz)}`;
      } else {
        message = txt(f.Nachricht);
      }
      infoKopie = { typ: 'Mitteilung', empfaenger: ziel || 'Empfänger laut Zielgruppe' };

    } else {
      res.status(200).json({ status: 'skipped', grund: 'Unbekannter type' }); return;
    }

    // Keine Empfänger -> skipped. Bei Mitteilung Status NICHT auf "Gesendet" setzen,
    // damit sie nicht als versendet hängen bleibt.
    if (subs.size === 0) {
      // Kein Empfaenger-Abo: Freigabe trotzdem als erledigt markieren, damit sie nicht
      // dauerhaft auf "Senden" haengen bleibt und nicht erneut ausloest.
      if (gateTable) {
        await airtable(`${gateTable}/${recordId}`, { method: 'PATCH', body: JSON.stringify({ fields: { Push_senden: 'Gesendet' } }) });
      }
      res.status(200).json({ status: 'skipped', grund: istMitteilung ? 'Keine Empfänger' : 'Kein Push-Abo (als Gesendet markiert)' }); return;
    }

    const { gesendet, fehlgeschlagen, details } = await sendToAll([...subs], message);

    if (istMitteilung) {
      await airtable(`${MITTEILUNGEN}/${recordId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Status: 'Gesendet' } }),
      });
    }
    // Besuche/Dokumente: Freigabe nach dem Versand automatisch auf "Gesendet" (verhindert
    // erneutes Ausloesen; der Mitarbeiter sieht, dass der Push raus ist).
    if (gateTable) {
      await airtable(`${gateTable}/${recordId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Push_senden: 'Gesendet' } }),
      });
    }

    // Info-Kopie ans Büro: eine Sammelkopie je erfolgreich ausgelöstem Push
    // (besuch/dokument/mitteilung). Enthält den exakten Push-Text, keine PINs/Token.
    if (infoKopie && gesendet > 0) {
      await sendInfoCopy(`📩 Info-Kopie: ${infoKopie.typ}`, `Empfänger: ${infoKopie.empfaenger}\n\n${message}`);
    }

    res.status(200).json({ status: 'ok', gesendet, fehlgeschlagen, details });
  } catch (e) {
    // Nur echte technische Fehler landen hier (Airtable nicht erreichbar, Env fehlt, ...)
    console.error('push-event Fehler:', { type, recordId, message: String((e && e.message) || e) });
    res.status(500).json({ status: 'error', message: String((e && e.message) || e) });
  }
}
