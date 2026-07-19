import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { airtable, ownOr403, reportError, sendAlert, TABLES } from './_lib.js';

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_KEY = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
const DATEI_FIELD = 'fld7vyNPt2Be9xAaT'; // Anhang-Feld "Datei" in der Dokumente-Tabelle

// GEMESSENE Boxen für den Leistungsnachweis im Querformat (841.89 x 595.28 pt).
// Exakt vermessen am 19.07.2026 gegen die Vorlage des Pflegediensts (pdfplumber):
// - Klient:       Unterschriftslinie y=79.4, x 22.7..215.4 ("Unterschrift des Klienten")
// - Bestätigung:  linker Kasten des Doppelkastens, Linie y=52.4, x 652.0..728.5
// Bei NEUER Vorlage: Positionen neu vermessen und VORLAGEN_HASH aktualisieren.
const BOX_KLIENT = { x0: 24, x1: 214, y0: 81, y1: 112 };
const BOX_BESTAETIGUNG = { x0: 650, x1: 730, y0: 55, y1: 81 };

// Fingerabdruck der vermessenen Leistungsnachweis-Vorlage (SHA-256).
// Ändert der Pflegedienst die Vorlage, passt der Abdruck nicht mehr -> es wird
// trotzdem gestempelt (bestmöglich), aber SOFORT alarmiert, damit die Positionen
// neu vermessen werden. Verhindert stilles Verrutschen wie im Juli 2026.
const VORLAGEN_HASH_LEISTUNGSNACHWEIS =
  'af7d7e3525719ab84af9a9703d98902a3b17fceca50f51d0b907769e91efa2fd';

// PNG proportional in eine Box einpassen (zentriert). Gibt x/y/width/height
// zurück - drawImage MUSS width+height bekommen, sonst zeichnet pdf-lib in
// Originalgröße des PNG (= viel zu groß).
function fitInBox(png, box, pad = 3) {
  const bw = (box.x1 - box.x0) - 2 * pad;
  const bh = (box.y1 - box.y0) - 2 * pad;
  const ratio = png.width / png.height;   // echtes Seitenverhältnis der Zeichnung
  let w = bw, h = w / ratio;              // erst an Breite anpassen
  if (h > bh) { h = bh; w = h * ratio; }  // falls zu hoch -> an Höhe
  const x = box.x0 + pad + (bw - w) / 2;  // zentriert
  const y = box.y0 + pad + (bh - h) / 2;
  return { x, y, width: w, height: h };
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

    // 2) Original-Dokument: Format prüfen UND Eigentum verifizieren (IDOR-Schutz).
    //    Ein Patient darf nur eigene Dokumente signieren.
    const orig = await ownOr403(res, TABLES.DOKUMENTE, originalDocumentId, patient.id);
    if (!orig) return; // ownOr403 hat bereits 400/403 gesendet
    const of = orig.fields || {};
    const att = (of.Datei || [])[0];
    const fileUrl = att && att.url;
    if (!fileUrl) { res.status(400).send('Original hat keine Datei'); return; }
    // Original-Dateiname vom hochladenden Pflegedienst: bevorzugt der echte
    // Anhang-Dateiname, sonst das Textfeld. So beginnt der Name immer mit dem Original.
    const origName = (att && att.filename) || of.Dateiname || 'Dokument';
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

    // Vorlagen-Drift-Wächter: Weicht der Leistungsnachweis von der vermessenen
    // Vorlage ab, sofort Alarm an den Betreiber (Positionen könnten daneben sein).
    if (origTyp === 'Leistungsnachweis' && istQuer) {
      const hash = crypto.createHash('sha256').update(Buffer.from(originalBytes)).digest('hex');
      if (hash !== VORLAGEN_HASH_LEISTUNGSNACHWEIS) {
        sendAlert(
          '⚠️ Wunschlos: Leistungsnachweis-Vorlage geändert',
          'Ein Klient hat einen Leistungsnachweis unterschrieben, dessen Datei NICHT der vermessenen ' +
          'Vorlage entspricht (SHA-256 weicht ab).\n\n' +
          'Die Unterschrifts-Positionen können verrutscht sein. Bitte das erzeugte PDF prüfen und bei ' +
          'neuer Vorlage die Boxen in api/sign-document.js neu vermessen (BOX_KLIENT/BOX_BESTAETIGUNG, ' +
          'VORLAGEN_HASH aktualisieren).\n\nDokument: ' + origName + '\nNeuer Hash: ' + hash
        );
      }
    }

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
    // Neuer Namensstil: Original-Name vorne, hinten "_unterschrieben".
    const origBase = String(origName).replace(/\.(pdf|jpe?g|png)$/i, '');
    const filename = `${origBase}_unterschrieben.pdf`;

    // 5) Neuen Dokument-Datensatz anlegen + Anhang hochladen (direkt Airtable)
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
    reportError('api/sign-document', (e && e.message) || e, {});
    res.status(500).send('Signatur fehlgeschlagen. Bitte später erneut versuchen.');
  }
}
