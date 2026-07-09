import crypto from 'crypto';
import { airtable, sendError, handledPreflight, TABLES } from './_lib.js';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { name, code } = req.body || {};
  // Beides Zahlen - vor dem Einsetzen in die Formel auf reine Ziffern prüfen (Injection-Schutz)
  if (!/^\d+$/.test(String(name || '')) || !/^\d+$/.test(String(code || ''))) {
    res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return;
  }
  try {
    // Ein Query per Anmelde_ID; Code-Vergleich + Sperr-Logik in JS (wie patient-login).
    const formula = encodeURIComponent(`{Anmelde_ID} = ${Number(name)}`);
    const data = await airtable(`${TABLES.PERSONAL}?filterByFormula=${formula}&maxRecords=1`);
    const rec = (data.records || [])[0];
    if (!rec) { res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return; }

    const f = rec.fields || {};

    // Nur aktive Mitarbeiter
    if (f.Aktiv === false) { res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return; }

    // Konto gesperrt?
    if (f.Locked_Until && new Date(f.Locked_Until).getTime() > Date.now()) {
      res.status(401).json({ status: 'error', message: 'Konto vorübergehend gesperrt' }); return;
    }

    // Falsche PIN -> Zähler hoch, ggf. sperren
    if (String(f.Login_Code) !== String(Number(code))) {
      const failed = (Number(f.Failed_Attempts) || 0) + 1;
      const patch = { Failed_Attempts: failed };
      if (failed >= LOCK_AFTER) {
        patch.Locked_Until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
      }
      await airtable(`${TABLES.PERSONAL}/${rec.id}`, {
        method: 'PATCH', body: JSON.stringify({ fields: patch }),
      });
      res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return;
    }

    // Erfolg: kryptografischer Token, Sperrzähler zurücksetzen
    const token = crypto.randomBytes(30).toString('base64url');
    await airtable(`${TABLES.PERSONAL}/${rec.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { Session_Token: token, Failed_Attempts: 0, Locked_Until: null } }),
    });
    // Format wie zuvor mitarbeiter_login: status + mitarbeiterId + name
    res.status(200).json({
      status: 'success',
      mitarbeiterId: rec.id,
      name: (rec.fields && rec.fields.Name) || '',
      token,
    });
  } catch (e) {
    sendError(res, e, 'api/ma-login');
  }
}
