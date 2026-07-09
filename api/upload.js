import fs from 'fs';
import formidable from 'formidable';
import { airtable, patientByToken, sendError, TABLES, DOKUMENT_DATEI_FELD } from './_lib.js';

// Datei kommt als multipart -> kein JSON-Body-Parser.
export const config = { api: { bodyParser: false } };

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_KEY = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
const first = (v) => (Array.isArray(v) ? v[0] : v);

// Ersetzt den früheren Endpunkt upload_document (Klienten-Upload eigener Dokumente).
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  try {
    const form = formidable({ multiples: false });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    const token = first(fields.token);
    const typ = first(fields.typ) || 'Dokument';
    const fileEntry = first(files.data) || first(files.file);
    if (!token || !fileEntry) { res.status(200).json({ status: 'skipped', grund: 'Ungültiger Aufruf' }); return; }

    const patient = await patientByToken(token);
    if (!patient) { res.status(401).json({ status: 'error', message: 'Nicht autorisiert' }); return; }

    const dateiname = fileEntry.originalFilename || 'Dokument';
    const contentType = fileEntry.mimetype || 'application/octet-stream';
    const base64 = fs.readFileSync(fileEntry.filepath).toString('base64');

    // 1) Dokument-Datensatz anlegen
    const created = await airtable(TABLES.DOKUMENTE, {
      method: 'POST',
      body: JSON.stringify({
        fields: { Patient: [patient.id], Typ: typ, Richtung: 'Vom Patienten', Status: 'Neu', Dateiname: dateiname },
      }),
    });

    // 2) Datei als Anhang hochladen
    const upResp = await fetch(
      `https://content.airtable.com/v0/${BASE}/${created.id}/${DOKUMENT_DATEI_FELD}/uploadAttachment`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType, filename: dateiname, file: base64 }),
      }
    );
    if (!upResp.ok) {
      const t = await upResp.text().catch(() => '');
      throw new Error('Anhang-Upload fehlgeschlagen (' + upResp.status + '): ' + t);
    }

    res.status(200).json({ status: 'ok', id: created.id });
  } catch (e) {
    console.error('upload Fehler:', String((e && e.message) || e));
    sendError(res, e);
  }
}
