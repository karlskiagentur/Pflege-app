import { airtable, ownOr403, patientByToken, sendError, TABLES } from './_lib.js';

// Berliner Wandzeit -> UTC-ISO (DST-sicher). Reicht für die Terminplanung.
function berlinToISO(dateStr, timeStr) {
  const t = timeStr && timeStr.length >= 4 ? timeStr : '00:00';
  const base = new Date(`${dateStr}T${t}:00Z`);
  const berlin = new Date(base.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const utc = new Date(base.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(base.getTime() - (berlin.getTime() - utc.getTime())).toISOString();
}

// Ersetzt den früheren Endpunkt service_submit - App-Eingaben direkt nach Airtable.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  const { token, typ } = req.body || {};
  if (!token || !typ) { res.status(200).json({ status: 'skipped', grund: 'Ungültiger Aufruf' }); return; }

  try {
    const patient = await patientByToken(token);
    if (!patient) { res.status(401).json({ status: 'error', message: 'Nicht autorisiert' }); return; }

    if (typ === 'Terminanfrage') {
      const { betreff, wunschDatum, wunschZeit, nachricht } = req.body;
      if (!wunschDatum) { res.status(200).json({ status: 'skipped', grund: 'wunschDatum fehlt' }); return; }
      const fields = {
        Patient: [patient.id],
        'Tätigkeit': betreff || 'Terminanfrage',
        Status: 'Anfrage',
        Uhrzeit: berlinToISO(wunschDatum, wunschZeit),
      };
      if (nachricht) fields.Notiz_Patient = nachricht;
      const rec = await airtable(TABLES.BESUCHE, { method: 'POST', body: JSON.stringify({ fields }) });
      res.status(200).json({ status: 'ok', id: rec.id }); return;
    }

    if (typ === 'Termin_bestatigen') {
      const { recordId } = req.body;
      if (!recordId) { res.status(200).json({ status: 'skipped', grund: 'recordId fehlt' }); return; }
      const owned = await ownOr403(res, TABLES.BESUCHE, recordId, patient.id);
      if (!owned) return;
      await airtable(`${TABLES.BESUCHE}/${recordId}`, { method: 'PATCH', body: JSON.stringify({ fields: { Status: 'Bestätigt' } }) });
      res.status(200).json({ status: 'ok' }); return;
    }

    if (typ === 'Terminverschiebung') {
      const { recordId, nachricht } = req.body;
      if (!recordId) { res.status(200).json({ status: 'skipped', grund: 'recordId fehlt' }); return; }
      const owned = await ownOr403(res, TABLES.BESUCHE, recordId, patient.id);
      if (!owned) return;
      await airtable(`${TABLES.BESUCHE}/${recordId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Status: 'Änderungswunsch', Notiz_Patient: nachricht || '' } }),
      });
      res.status(200).json({ status: 'ok' }); return;
    }

    if (typ === 'Urlaubsmeldung') {
      const { nachricht } = req.body;
      const rec = await airtable(TABLES.URLAUB, {
        method: 'POST', body: JSON.stringify({ fields: { Patient: [patient.id], Zeitraum: nachricht || '', Status: 'Neu' } }),
      });
      res.status(200).json({ status: 'ok', id: rec.id }); return;
    }

    if (typ === 'Widerruf_Digitale_Rechnung') {
      await airtable(`${TABLES.PATIENTEN}/${patient.id}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Digitale_Rechnung_Widerrufen_Am: new Date().toISOString().slice(0, 10) } }),
      });
      res.status(200).json({ status: 'ok' }); return;
    }

    res.status(200).json({ status: 'skipped', grund: 'Unbekannter typ' });
  } catch (e) {
    console.error('service-submit Fehler:', { typ, message: String((e && e.message) || e) });
    sendError(res, e);
  }
}
