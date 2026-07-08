import webpush from 'web-push';
import { airtable, fetchAll, TABLES } from './_lib.js';

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

async function loadRec(table, id) {
  if (!id) return null;
  try { return await airtable(`${table}/${id}`); } catch { return null; }
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

async function sendToAll(subs, message) {
  const payload = JSON.stringify({ title: TITLE, body: message });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s), payload);
      sent++;
    } catch (err) {
      console.error('Push fehlgeschlagen:', err && err.statusCode, err && err.body);
    }
  }
  return sent;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  const { type, recordId, ereignis } = req.body || {};
  try {
    const subs = new Set();
    let message = '';

    if (type === 'besuch') {
      const rec = await loadRec(TABLES.BESUCHE, recordId);
      if (!rec) { res.status(404).json({ status: 'error', message: 'Besuch nicht gefunden' }); return; }
      const f = rec.fields || {};
      const taetigkeit = txt(f['Tätigkeit']);
      const wann = fmt(f['Uhrzeit']);
      if (ereignis === 'Abgesagt') {
        message = `Ihr Termin "${taetigkeit}" wurde abgesagt.`;
      } else if (ereignis === 'Geändert') {
        message = `Ihr Termin "${taetigkeit}" wurde geändert` + (wann ? ` - neuer Termin: ${wann}.` : '.');
      } else {
        message = `Neuer Termin: "${taetigkeit}"` + (wann ? ` am ${wann}` : '');
      }
      await addPatientSub(subs, firstLink(f.Patient));

    } else if (type === 'dokument') {
      const rec = await loadRec(TABLES.DOKUMENTE, recordId);
      if (!rec) { res.status(404).json({ status: 'error', message: 'Dokument nicht gefunden' }); return; }
      const f = rec.fields || {};
      message = `Neue(r) ${txt(f.Typ)} für Sie verfügbar - jetzt in der App ansehen.`;
      await addPatientSub(subs, firstLink(f.Patient));

    } else if (type === 'mitteilung') {
      const rec = await loadRec(MITTEILUNGEN, recordId);
      if (!rec) { res.status(404).json({ status: 'error', message: 'Mitteilung nicht gefunden' }); return; }
      const f = rec.fields || {};
      const ziel = txt(f.Zielgruppe);

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

    } else {
      res.status(400).json({ status: 'error', message: 'Unbekannter type' }); return;
    }

    const sent = await sendToAll([...subs], message);

    // Mitteilung nach erfolgreichem Versand als "Gesendet" markieren
    if (type === 'mitteilung') {
      await airtable(`${MITTEILUNGEN}/${recordId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Status: 'Gesendet' } }),
      });
    }

    res.status(200).json({ status: 'ok', sent });
  } catch (e) {
    console.error('push-event Fehler:', e);
    res.status(500).json({ status: 'error', message: String((e && e.message) || e) });
  }
}
