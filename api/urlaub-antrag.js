import { airtable, sendError, requireMitarbeiter, handledPreflight } from './_lib.js';

const URLAUB = 'tbltiTbieKAxp4pSQ'; // Tabelle "Mitarbeiter_Urlaub" (ID statt Name)

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;
    // Name + ID serverseitig aus dem geprüften Record ableiten (nicht aus dem Body).
    const mitarbeiterId = ma.id;
    const mitarbeiterName = (ma.fields && ma.fields.Name) || '';

    const { von, bis, notiz } = req.body || {};
    // Datumsformat streng prüfen (verhindert Müll-Records und kaputte Sortierung).
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    if (!isDate(von) || !isDate(bis)) {
      res.status(400).json({ status: 'error', message: 'von und bis müssen Datumsangaben sein (YYYY-MM-DD)' });
      return;
    }

    const fields = {
      Mitarbeiter: mitarbeiterName,
      Mitarbeiter_ID: mitarbeiterId,
      Von: von,
      Bis: bis,
      Status: 'Beantragt',
    };
    if (notiz) fields.Notiz = String(notiz).slice(0, 2000);

    const data = await airtable(URLAUB, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    res.status(200).json({ status: 'success', id: data.id });
  } catch (e) {
    sendError(res, e, 'api/urlaub-antrag');
  }
}
