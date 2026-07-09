import { airtable, sendError, requireMitarbeiter, esc, handledPreflight } from './_lib.js';

const URLAUB = 'tbltiTbieKAxp4pSQ'; // Tabelle "Mitarbeiter_Urlaub" (ID statt Name)

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;
    const mitarbeiterId = ma.id;

    const formula = encodeURIComponent(`{Mitarbeiter_ID} = '${esc(mitarbeiterId)}'`);
    const data = await airtable(`${URLAUB}?filterByFormula=${formula}`);
    const liste = (data.records || []).map(r => ({
      id: r.id,
      von: (r.fields && r.fields.Von) || '',
      bis: (r.fields && r.fields.Bis) || '',
      status: (r.fields && r.fields.Status) || 'Beantragt',
      notiz: (r.fields && r.fields.Notiz) || '',
    }));
    liste.sort((a, b) => new Date(b.von).getTime() - new Date(a.von).getTime());
    res.status(200).json(liste);
  } catch (e) {
    sendError(res, e, 'api/urlaub-liste');
  }
}
