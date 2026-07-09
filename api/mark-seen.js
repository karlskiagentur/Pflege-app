import { airtable, requireAuth, ownOr403, sendError, handledPreflight, TABLES } from './_lib.js';

// Ersetzt den n8n-Webhook "mark_document_seen". JSON: { token, documentId }
// Neu: Token-Pflicht + Eigentumsprüfung (vorher ohne jede Auth).
export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }
  try {
    const patient = await requireAuth(req, res);
    if (!patient) return;

    const { documentId } = req.body || {};
    const rec = await ownOr403(res, TABLES.DOKUMENTE, documentId, patient.id);
    if (!rec) return;

    await airtable(`${TABLES.DOKUMENTE}/${documentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { Vom_Patienten_Gesehen: true }, typecast: true }),
    });
    res.status(200).json({ status: 'success' });
  } catch (e) {
    sendError(res, e, 'api/mark-seen');
  }
}
