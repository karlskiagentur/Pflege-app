import crypto from 'crypto';
import { airtable, esc, sendError, handledPreflight, TABLES } from './_lib.js';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { name, code } = req.body || {};
  // Login läuft über die Kunden-Nr (z. B. "L00001") + PIN. Kunden-Nr ist alphanumerisch,
  // die PIN nur Ziffern. Vor dem Einsetzen in die Formel streng validieren (Injection-Schutz).
  const kundenNr = String(name || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(kundenNr) || !/^\d+$/.test(String(code || ''))) {
    res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return;
  }
  try {
    // Query per Kunden-Nr. Das seniorentaugliche Zahlenfeld in der App kann kein "L"
    // tippen -> reine Ziffern zusätzlich auf die Kunden-Nr-Form "L#####" abbilden.
    // Eine exakt getippte Kunden-Nr (z. B. am Desktop) bleibt ebenfalls gÜltig.
    const kandidaten = new Set([kundenNr]);
    if (/^\d+$/.test(kundenNr)) kandidaten.add('L' + String(parseInt(kundenNr, 10)).padStart(5, '0'));
    const formula = encodeURIComponent('OR(' + [...kandidaten].map((k) => `{Kunden_Nr}='${esc(k)}'`).join(',') + ')');
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
    sendError(res, e, 'api/patient-login');
  }
}
