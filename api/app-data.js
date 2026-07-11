import { airtable, fetchAll, sendError, esc, readToken, handledPreflight, TABLES } from './_lib.js';

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ status: 'error', message: 'Nur GET' }); return;
  }
  // Token bevorzugt aus Authorization-Header, sonst Query (Alt-Kompatibilität).
  const token = readToken(req);
  try {
    // Token ist base64url; alles andere gilt als ungültig (verhindert Formel-Injection).
    // WICHTIG: 200 + status:"unauthorized" - nur so loggt die App sauber aus.
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
      res.status(200).json({ status: 'unauthorized' }); return;
    }
    const byToken = encodeURIComponent(`{Session_Token} = '${esc(token)}'`);
    const pdata = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${byToken}&maxRecords=1`);
    const patient = (pdata.records || [])[0];
    if (!patient) { res.status(200).json({ status: 'unauthorized' }); return; }

    // "Zuletzt aktiv" pflegen (gedrosselt): so sieht der Pflegedienst, ob/wann der
    // Klient die App nutzt. Nur schreiben, wenn > 10 Min her (spart Schreibzugriffe).
    try {
      const last = patient.fields && patient.fields.Zuletzt_aktiv;
      const stale = !last || (Date.now() - new Date(last).getTime() > 10 * 60 * 1000);
      if (stale) {
        await airtable(`${TABLES.PATIENTEN}/${patient.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: { Zuletzt_aktiv: new Date().toISOString() } }),
        });
      }
    } catch (_) { /* Aktivitäts-Zeitstempel ist unkritisch, darf den Load nie stören */ }

    const byPatient = `filterByFormula=${encodeURIComponent(`FIND('${esc(patient.id)}', ARRAYJOIN({PatientID_live}))`)}`;
    const [besuche, tasks, dokumente, kontakte] = await Promise.all([
      fetchAll(TABLES.BESUCHE, byPatient),
      fetchAll(TABLES.AUFGABEN, byPatient),
      fetchAll(TABLES.DOKUMENTE, byPatient),
      // FIX: Kontakte NUR des eingeloggten Patienten (vorher: alle Kontakte aller Patienten).
      fetchAll(TABLES.KONTAKTE, byPatient),
    ]);

    // Format exakt wie der bisherige Aggregator get_full_app_data
    res.status(200).json({
      data: { patienten_daten: patient, kontakte, besuche, tasks, dokumente },
    });
  } catch (e) {
    sendError(res, e, 'api/app-data');
  }
}
