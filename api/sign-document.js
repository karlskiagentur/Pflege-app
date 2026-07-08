import { PDFDocument } from 'pdf-lib';
import { airtable, TABLES } from './_lib.js';

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_KEY = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
const DATEI_FIELD = 'fld7vyNPt2Be9xAaT'; // Anhang-Feld "Datei" in der Dokumente-Tabelle

// GEMESSENE Boxen für den Leistungsnachweis im Querformat (validiert - NICHT verändern)
const BOX_KLIENT = { x0: 25.1, x1: 210.9, y0: 109.4, y1: 144.6 };
const BOX_BESTAETIGUNG = { x0: 526.1, x1: 670.8, y0: 58.5, y1: 93.8 };

// PNG proportional in eine Box einpassen (zentriert)
function fitInBox(pngDims, box, pad = 2) {
  const bw = (box.x1 - box.x0) - 2 * pad, bh = (box.y1 - box.y0) - 2 * pad;
  const ratio = pngDims.width / pngDims.height;
  let w = bw, h = w / ratio;
  if (h > bh) { h = bh; w = h * ratio; }
  return { x: box.x0 + pad + (bw - w) / 2, y: box.y0 + pad + (bh - h) / 2, w, h };
}

const toPng = (dataUrl) => Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');

async function patientByToken(token) {
  if (!token || !/^[A-Za-z0-9_-]{20,}$/.test(String(token))) return null;
  const f = encodeURIComponent(`{Session_Token} = '${token}'`);
  const data = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${f}&maxRecords=1`);
  return (data.records || [])[0] || null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).send('Nur POST'); return; }
  try {
    const { token, originalDocumentId, signaturKlient, signaturBestaetigung, debug } = req.body || {};
    if (!originalDocumentId || !signaturKlient) {
      res.status(400).send('originalDocumentId und signaturKlient nötig'); return;
    }

    // 1) Token -> Patient
    const patient = await patientByToken(token);
    if (!patient) { res.status(401).send('Nicht autorisiert'); return; }

    // 2) Original-Dokument + Datei-URL
    const orig = await airtable(`${TABLES.DOKUMENTE}/${originalDocumentId}`);
    const of = orig.fields || {};
    const att = (of.Datei || [])[0];
    const fileUrl = att && att.url;
    if (!fileUrl) { res.status(400).send('Original hat keine Datei'); return; }
    const origName = of.Dateiname || 'Dokument';
    const origTyp = of.Typ || '';

    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) { res.status(502).send('Original konnte nicht geladen werden (Status ' + fileRes.status + ')'); return; }
    const originalBytes = await fileRes.arrayBuffer();

    // 3) PDF laden (Bild-Attachments defensiv in A4 einbetten)
    let pdfDoc;
    const nameLower = String(origName).toLowerCase();
    if (/\.(jpg|jpeg|png)$/.test(nameLower)) {
      pdfDoc = await PDFDocument.create();
      const img = nameLower.endsWith('.png') ? await pdfDoc.embedPng(originalBytes) : await pdfDoc.embedJpg(originalBytes);
      const page = pdfDoc.addPage([595, 842]);
      const scale = Math.min(495 / img.width, 700 / img.height);
      page.drawImage(img, { x: 50, y: 842 - 70 - img.height * scale, width: img.width * scale, height: img.height * scale });
    } else {
      pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    }

    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();
    const istQuer = width > height;

    // 4) Stempeln (nur PNGs, kein Text/Rahmen)
    const pngK = await pdfDoc.embedPng(toPng(signaturKlient));
    const placed = {};

    if (origTyp === 'Leistungsnachweis' && istQuer) {
      const k = fitInBox(pngK, BOX_KLIENT);
      lastPage.drawImage(pngK, k);
      placed.klient = k;
      if (signaturBestaetigung) {
        const pngB = await pdfDoc.embedPng(toPng(signaturBestaetigung));
        const b = fitInBox(pngB, BOX_BESTAETIGUNG);
        lastPage.drawImage(pngB, b);
        placed.bestaetigung = b;
      }
    } else {
      // Hochformat (Rechnungen): nur Klient, unteres Drittel rechts
      const w = 170;
      const h = w * (pngK.height / pngK.width);
      const k = { x: width - w - 50, y: height * 0.22, width: w, height: h };
      lastPage.drawImage(pngK, k);
      placed.klient = k;
    }

    if (debug) {
      res.status(200).json({ istQuer, typ: origTyp, pageSize: { width, height }, placed });
      return;
    }

    const out = await pdfDoc.save();
    const base64 = Buffer.from(out).toString('base64');
    const filename = `Unterschrieben_${String(origName).replace(/\.(pdf|jpg|jpeg|png)$/i, '')}.pdf`;

    // 5) Neuen Dokument-Datensatz anlegen + Anhang hochladen (direkt Airtable, kein n8n)
    const created = await airtable(TABLES.DOKUMENTE, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          Patient: [patient.id],
          Typ: origTyp,
          Richtung: 'Vom Patienten',
          Status: 'Neu',
          Dateiname: filename,
          'Bestätigung_Für': [originalDocumentId],
        },
      }),
    });

    const upResp = await fetch(
      `https://content.airtable.com/v0/${BASE}/${created.id}/${DATEI_FIELD}/uploadAttachment`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: 'application/pdf', filename, file: base64 }),
      }
    );
    if (!upResp.ok) {
      const t = await upResp.text().catch(() => '');
      throw new Error('Anhang-Upload fehlgeschlagen (' + upResp.status + '): ' + t);
    }

    // Original als bestätigt markieren
    await airtable(`${TABLES.DOKUMENTE}/${originalDocumentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { 'Vom_Patienten_Bestätigt_Am': new Date().toISOString().slice(0, 10) } }),
    });

    res.status(200).json({ status: 'ok' });
  } catch (e) {
    console.error('sign-document Fehler:', e);
    res.status(500).send('Signatur fehlgeschlagen: ' + String((e && e.message) || e));
  }
}
