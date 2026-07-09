import { fetchAll, sendError, requireMitarbeiter, esc, handledPreflight, TABLES } from './_lib.js';

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    // Auth: Mitarbeiter über Session-Token ermitteln, NICHT über Body-ID (IDOR-Schutz).
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;
    const mitarbeiterId = ma.id;

    const formula = `filterByFormula=${encodeURIComponent(`FIND('${esc(mitarbeiterId)}', ARRAYJOIN({Pfleger_ID}))`)}`;
    const records = await fetchAll(TABLES.BESUCHE, formula);
    // Rohes Record-Array wie zuvor mitarbeiter_termine (App sortiert selbst)
    res.status(200).json(records);
  } catch (e) {
    sendError(res, e, 'api/ma-termine');
  }
}
