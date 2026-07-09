import { airtable, sendError, TABLES } from './_lib.js';

// Speichert das Push-Abo am richtigen Datensatz - anhand des Session_Token.
// Funktioniert für Klienten (Patienten-Tabelle) UND Mitarbeiter (Personal-Tabelle).
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  const { token, subscription } = req.body || {};
  if (!token || !subscription) {
    res.status(400).json({ status: 'error', message: 'token und subscription nötig' }); return;
  }
  // Token ist base64url; alles andere gilt als ungültig (Injection-Schutz)
  if (!/^[A-Za-z0-9_-]{20,}$/.test(String(token))) {
    res.status(401).json({ status: 'error', message: 'Nicht autorisiert' }); return;
  }

  try {
    const formula = encodeURIComponent(`{Session_Token} = '${token}'`);
    const body = JSON.stringify({ fields: { Push_Subscription: JSON.stringify(subscription) } });

    // 1) Klient?
    const pat = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${formula}&maxRecords=1`);
    const patient = (pat.records || [])[0];
    if (patient) {
      await airtable(`${TABLES.PATIENTEN}/${patient.id}`, { method: 'PATCH', body });
      res.status(200).json({ status: 'ok' }); return;
    }

    // 2) Sonst Mitarbeiter?
    const per = await airtable(`${TABLES.PERSONAL}?filterByFormula=${formula}&maxRecords=1`);
    const personal = (per.records || [])[0];
    if (personal) {
      await airtable(`${TABLES.PERSONAL}/${personal.id}`, { method: 'PATCH', body });
      res.status(200).json({ status: 'ok' }); return;
    }

    // 3) Nichts gefunden
    res.status(401).json({ status: 'error', message: 'Nicht autorisiert' });
  } catch (e) {
    console.error('save-subscription Fehler:', String((e && e.message) || e));
    sendError(res, e);
  }
}
