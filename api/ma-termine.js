import { fetchAll, sendError, TABLES } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { mitarbeiterId } = req.body || {};
  if (!/^rec[A-Za-z0-9]+$/.test(String(mitarbeiterId || ''))) {
    res.status(400).json({ status: 'error', message: 'mitarbeiterId nötig' }); return;
  }
  try {
    const formula = `filterByFormula=${encodeURIComponent(`FIND('${mitarbeiterId}', ARRAYJOIN({Pfleger_ID}))`)}`;
    const records = await fetchAll(TABLES.BESUCHE, formula);
    // Rohes Record-Array wie n8n mitarbeiter_termine (App sortiert selbst)
    res.status(200).json(records);
  } catch (e) {
    sendError(res, e);
  }
}
