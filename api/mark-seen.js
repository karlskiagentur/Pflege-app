import { airtable, ownOr403, patientByToken, sendError, TABLES } from './_lib.js';

// Ersetzt den früheren Endpunkt mark_document_seen.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  const { token, documentId } = req.body || {};
  if (!token || !documentId) { res.status(200).json({ status: 'skipped', grund: 'Ungültiger Aufruf' }); return; }

  try {
    const patient = await patientByToken(token);
    if (!patient) { res.status(401).json({ status: 'error', message: 'Nicht autorisiert' }); return; }

    const owned = await ownOr403(res, TABLES.DOKUMENTE, documentId, patient.id);
    if (!owned) return;

    await airtable(`${TABLES.DOKUMENTE}/${documentId}`, {
      method: 'PATCH', body: JSON.stringify({ fields: { Vom_Patienten_Gesehen: true } }),
    });
    res.status(200).json({ status: 'ok' });
  } catch (e) {
    console.error('mark-seen Fehler:', { documentId, message: String((e && e.message) || e) });
    sendError(res, e);
  }
}
