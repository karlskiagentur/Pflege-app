import { airtable, fetchAll, sendError, TABLES } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') {
    res.status(405).json({ status: 'error', message: 'Nur GET' }); return;
  }
  const token = String((req.query && req.query.token) || '');
  try {
    // Token ist base64url; alles andere gilt als ungültig (verhindert Formel-Injection).
    // WICHTIG: 200 + status:"unauthorized" - nur so loggt die App sauber aus.
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
      res.status(200).json({ status: 'unauthorized' }); return;
    }
    const byToken = encodeURIComponent(`{Session_Token} = '${token}'`);
    const pdata = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${byToken}&maxRecords=1`);
    const patient = (pdata.records || [])[0];
    if (!patient) { res.status(200).json({ status: 'unauthorized' }); return; }

    const byPatient = `filterByFormula=${encodeURIComponent(`FIND('${patient.id}', ARRAYJOIN({PatientID_live}))`)}`;
    const [besuche, tasks, dokumente, kontakte] = await Promise.all([
      fetchAll(TABLES.BESUCHE, byPatient),
      fetchAll(TABLES.AUFGABEN, byPatient),
      fetchAll(TABLES.DOKUMENTE, byPatient),
      fetchAll(TABLES.KONTAKTE),
    ]);

    // Format exakt wie der bisherige n8n-Aggregator get_full_app_data
    res.status(200).json({
      data: { patienten_daten: patient, kontakte, besuche, tasks, dokumente },
    });
  } catch (e) {
    sendError(res, e);
  }
}
