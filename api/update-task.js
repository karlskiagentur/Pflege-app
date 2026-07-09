import { airtable, requireAuth, ownOr403, sendError, handledPreflight, TABLES } from './_lib.js';

// Ersetzt den n8n-Webhook "update_task". JSON: { token, taskId, done }
// Neu: Token-Pflicht + Eigentumsprüfung (vorher konnte jeder jede Aufgabe ändern).
export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }
  try {
    const patient = await requireAuth(req, res);
    if (!patient) return;

    const { taskId, done } = req.body || {};
    const rec = await ownOr403(res, TABLES.AUFGABEN, taskId, patient.id);
    if (!rec) return;

    await airtable(`${TABLES.AUFGABEN}/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { Status: done ? 'Erledigt' : 'Offen' }, typecast: true }),
    });
    res.status(200).json({ status: 'success', message: 'Aufgabe aktualisiert' });
  } catch (e) {
    sendError(res, e, 'api/update-task');
  }
}
