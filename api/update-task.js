import { airtable, ownOr403, patientByToken, sendError, TABLES } from './_lib.js';

// Ersetzt den früheren Endpunkt update_task.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  const { token, taskId, status } = req.body || {};
  if (!token || !taskId) { res.status(200).json({ status: 'skipped', grund: 'Ungültiger Aufruf' }); return; }

  try {
    const patient = await patientByToken(token);
    if (!patient) { res.status(401).json({ status: 'error', message: 'Nicht autorisiert' }); return; }

    const owned = await ownOr403(res, TABLES.AUFGABEN, taskId, patient.id);
    if (!owned) return;

    const neuerStatus = status === 'Erledigt' ? 'Erledigt' : 'Offen';
    await airtable(`${TABLES.AUFGABEN}/${taskId}`, {
      method: 'PATCH', body: JSON.stringify({ fields: { Status: neuerStatus } }),
    });
    res.status(200).json({ status: 'ok' });
  } catch (e) {
    console.error('update-task Fehler:', { taskId, message: String((e && e.message) || e) });
    sendError(res, e);
  }
}
