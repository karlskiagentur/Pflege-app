import { airtable, requireAuth, ownOr403, sendError, handledPreflight, TABLES } from './_lib.js';

const URLAUB = 'tblPfBhWtAg9GEhWb'; // Patienten-Urlaub
const TERMINANFRAGEN = 'tblabkgCUxZmRzz6h'; // Inbox für Klienten-Terminwünsche (nicht der Dienstplan)

// Ersetzt den n8n-Webhook "service_submit" – vollständig auf Vercel, ohne n8n.
// Erwartet JSON (kein FormData mehr):
//   { token, typ, recordId?, nachricht?, betreff?, wunschDatum?, wunschZeit? }
export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }
  try {
    const patient = await requireAuth(req, res);
    if (!patient) return;

    const { typ, recordId, nachricht, betreff, wunschDatum, wunschZeit } = req.body || {};
    const t = String(typ || '');

    // Terminbestätigung: eigener Besuch -> Status "Bestätigt"
    if (t.includes('Termin_bestatigen')) {
      const rec = await ownOr403(res, TABLES.BESUCHE, recordId, patient.id);
      if (!rec) return;
      await airtable(`${TABLES.BESUCHE}/${recordId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Status: 'Bestätigt' } }),
      });
      res.status(200).json({ status: 'success' }); return;
    }

    // Terminverschiebung: eigener Besuch -> Status "Änderungswunsch" + Notiz
    if (t.includes('Terminverschiebung')) {
      const rec = await ownOr403(res, TABLES.BESUCHE, recordId, patient.id);
      if (!rec) return;
      await airtable(`${TABLES.BESUCHE}/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { Status: 'Änderungswunsch', Notiz_Patient: String(nachricht || '').slice(0, 2000) } }),
      });
      res.status(200).json({ status: 'success' }); return;
    }

    // Neue Terminanfrage: KOMMT NICHT in den Dienstplan (Besuche), sondern in die
    // separate Inbox-Tabelle "Terminanfragen". Der Pflegedienst prüft sie dort und
    // legt erst nach Zuweisung eines Mitarbeiters einen echten Einsatz an. So
    // entstehen keine Einsätze ohne Mitarbeiter im Dienstplan.
    if (t.includes('Terminanfrage')) {
      const fields = {
        Betreff: String(betreff || 'Terminanfrage').slice(0, 200),
        Klient: [patient.id],
        Nachricht: String(nachricht || '').slice(0, 2000),
        Status: 'Neu',
      };
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(wunschDatum || ''))) fields.Wunsch_Datum = wunschDatum;
      if (wunschZeit) fields.Wunsch_Zeit = String(wunschZeit).slice(0, 20);
      const data = await airtable(TERMINANFRAGEN, {
        method: 'POST', body: JSON.stringify({ fields, typecast: true }),
      });
      res.status(200).json({ status: 'success', id: data.id }); return;
    }

    // Widerruf digitale Rechnung: Datum am eigenen Patienten-Record setzen
    if (t.includes('Widerruf')) {
      await airtable(`${TABLES.PATIENTEN}/${patient.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { Digitale_Rechnung_Widerrufen_Am: new Date().toISOString().slice(0, 10) }, typecast: true }),
      });
      res.status(200).json({ status: 'success' }); return;
    }

    // Urlaubsmeldung des Patienten: neuer Urlaub-Record
    if (t.includes('Urlaub')) {
      const data = await airtable(URLAUB, {
        method: 'POST',
        body: JSON.stringify({ fields: { Status: 'Neu', Patient: [patient.id], Zeitraum: String(nachricht || '').slice(0, 500) }, typecast: true }),
      });
      res.status(200).json({ status: 'success', id: data.id }); return;
    }

    res.status(400).json({ status: 'error', message: 'Unbekannter Typ' });
  } catch (e) {
    sendError(res, e, 'api/service-submit');
  }
}
