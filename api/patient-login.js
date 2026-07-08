import crypto from 'crypto';
import { airtable, sendError, TABLES } from './_lib.js';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { name, code } = req.body || {};
  // Beides Zahlen - vor dem Einsetzen in die Formel auf reine Ziffern prüfen (Injection-Schutz)
  if (!/^\d+$/.test(String(name || '')) || !/^\d+$/.test(String(code || ''))) {
    res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return;
  }
  try {
    // Ein Query per Anmelde_ID; Code-Vergleich in JS, damit die Sperr-Logik
    // (Failed_Attempts/Locked_Until) denselben Record nutzen kann.
    const formula = encodeURIComponent(`{Anmelde_ID} = ${Number(name)}`);
    const data = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${formula}&maxRecords=1`);
    const rec = (data.records || [])[0];
    // Generische Meldung, damit gültige Anmelde-IDs nicht enumerierbar sind.
    if (!rec) { res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return; }

    const f = rec.fields || {};
    if (f.Locked_Until && new Date(f.Locked_Until).getTime() > Date.now()) {
      res.status(401).json({ status: 'error', message: 'Konto vorübergehend gesperrt' }); return;
    }

    if (String(f.Login_Code) !== String(Number(code))) {
      const failed = (Number(f.Failed_Attempts) || 0) + 1;
      const patch = { Failed_Attempts: failed };
      if (failed >= LOCK_AFTER) {
        patch.Locked_Until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
      }
      await airtable(`${TABLES.PATIENTEN}/${rec.id}`, {
        method: 'PATCH', body: JSON.stringify({ fields: patch }),
      });
      res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return;
    }

    // Erfolg: Token rotieren, Sperrzähler zurücksetzen
    const token = crypto.randomBytes(30).toString('base64url');
    await airtable(`${TABLES.PATIENTEN}/${rec.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { Session_Token: token, Failed_Attempts: 0, Locked_Until: null } }),
    });
    res.status(200).json({ status: 'success', token, patientId: rec.id });
  } catch (e) {
    sendError(res, e);
  }
}
