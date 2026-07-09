import { airtable, sendError, requireMitarbeiter, handledPreflight, TABLES } from './_lib.js';

// Speichert das Push-Abo des eingeloggten Mitarbeiters – Datensatz wird über
// den Session-Token ermittelt (nicht über eine frei setzbare mitarbeiterId).
export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;

    const { subscription } = req.body || {};
    if (!subscription || typeof subscription !== 'object') {
      res.status(400).json({ status: 'error', message: 'subscription nötig' }); return;
    }

    await airtable(`${TABLES.PERSONAL}/${ma.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { Push_Subscription: JSON.stringify(subscription) } }),
    });
    res.status(200).json({ status: 'success' });
  } catch (e) {
    sendError(res, e, 'api/abo-pfleger');
  }
}
