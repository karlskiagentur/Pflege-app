import crypto from 'crypto';
import { airtable, sendError, TABLES } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { name, code } = req.body || {};
  if (!/^\d+$/.test(String(name || '')) || !/^\d+$/.test(String(code || ''))) {
    res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return;
  }
  try {
    const formula = encodeURIComponent(
      `AND({Anmelde_ID} = ${Number(name)}, {Login_Code} = ${Number(code)}, {Aktiv} = TRUE())`
    );
    const data = await airtable(`${TABLES.PERSONAL}?filterByFormula=${formula}&maxRecords=1`);
    const rec = (data.records || [])[0];
    if (!rec) { res.status(401).json({ status: 'error', message: 'Login fehlgeschlagen' }); return; }

    const token = crypto.randomBytes(30).toString('base64url');
    await airtable(`${TABLES.PERSONAL}/${rec.id}`, {
      method: 'PATCH', body: JSON.stringify({ fields: { Session_Token: token } }),
    });
    // Format wie zuvor mitarbeiter_login: status + mitarbeiterId + name
    res.status(200).json({
      status: 'success',
      mitarbeiterId: rec.id,
      name: (rec.fields && rec.fields.Name) || '',
      token,
    });
  } catch (e) {
    sendError(res, e);
  }
}
