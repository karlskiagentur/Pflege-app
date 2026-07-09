import { airtable, requireAuth, ownOr403, sendError, handledPreflight, TABLES } from './_lib.js';

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_TOKEN = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
const DATEI_FIELD = 'fld7vyNPt2Be9xAaT'; // Attachment-Feld "Datei" in Dokumente

// Ersetzt den n8n-Webhook "upload_document" (inkl. des Test-Sub-Workflows).
// JSON statt FormData: { token, typ, filename, mimeType, fileBase64, originalDocumentId? }
// fileBase64 = reines Base64 ohne data:-Präfix.
export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }
  try {
    const patient = await requireAuth(req, res);
    if (!patient) return;

    const { typ, filename, mimeType, fileBase64, originalDocumentId } = req.body || {};
    if (!fileBase64) { res.status(400).json({ status: 'error', message: 'Datei fehlt' }); return; }

    const safeName = String(filename || 'Dokument.pdf').slice(0, 200);
    const ct = String(mimeType || 'application/pdf');

    // Falls Bestätigung eines vorhandenen Dokuments: Eigentum prüfen.
    if (originalDocumentId) {
      const orig = await ownOr403(res, TABLES.DOKUMENTE, originalDocumentId, patient.id);
      if (!orig) return;
    }

    // 1) Datensatz anlegen (ohne Datei)
    const fields = {
      Richtung: 'Vom Patienten',
      Status: 'Neu',
      Typ: typ || 'Dokument',
      Dateiname: safeName,
      Patient: [patient.id],
    };
    if (originalDocumentId) fields['Bestätigung_Für'] = [originalDocumentId];

    const created = await airtable(TABLES.DOKUMENTE, {
      method: 'POST', body: JSON.stringify({ fields, typecast: true }),
    });

    // 2) Datei ins Attachment-Feld laden (zweistufig, wie im alten Sub-Workflow)
    const upResp = await fetch(
      `https://content.airtable.com/v0/${BASE}/${created.id}/${DATEI_FIELD}/uploadAttachment`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: ct, filename: safeName, file: fileBase64 }),
      }
    );
    if (!upResp.ok) {
      const detail = await upResp.text().catch(() => '');
      throw new Error(`Anhang-Upload fehlgeschlagen (${upResp.status}): ${detail.slice(0, 300)}`);
    }

    // 3) Bei Bestätigung: Original als bestätigt markieren
    if (originalDocumentId) {
      await airtable(`${TABLES.DOKUMENTE}/${originalDocumentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { 'Vom_Patienten_Bestätigt_Am': new Date().toISOString().slice(0, 10) } }),
      });
    }

    res.status(200).json({ status: 'success', message: 'Upload erfolgreich', id: created.id });
  } catch (e) {
    sendError(res, e, 'api/upload-document');
  }
}
