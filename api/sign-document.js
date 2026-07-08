import { PDFDocument } from 'pdf-lib';

// pdfjs (v4) nutzt Promise.withResolvers - erst ab Node 22. Guard für ältere Runtimes.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

// Anker-Beschriftungen in Prioritätsreihenfolge (erster Treffer gewinnt)
const ANKER = [
  'Unterschrift des Klienten',
  'Unterschrift des Kunden',
  'Unterschrift',
];

// Wörter der letzten Seite mit Koordinaten (x/y in PDF-Punkten, Y von unten)
async function extractWords(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  const page = await doc.getPage(doc.numPages);
  const content = await page.getTextContent();
  const items = content.items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height }));
  await doc.cleanup();
  await doc.destroy();
  return items;
}

// Anker finden - direkt in einem Item oder über aufeinanderfolgende Items derselben Zeile.
// Gibt x/y des Wortes zurück, an dem die Phrase beginnt.
function findAnchor(items, phrase) {
  const target = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const it of items) {
    if (it.str.toLowerCase().includes(target)) return { x: it.x, y: it.y };
  }
  const firstWord = target.split(' ')[0];
  const byLine = new Map();
  for (const it of items) {
    const key = Math.round(it.y);
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(it);
  }
  for (const line of byLine.values()) {
    line.sort((a, b) => a.x - b.x);
    for (let i = 0; i < line.length; i++) {
      if (!line[i].str.toLowerCase().includes(firstWord)) continue;
      const rest = line.slice(i).map((w) => w.str).join(' ').toLowerCase().replace(/\s+/g, ' ');
      if (rest.includes(target)) return { x: line[i].x, y: line[i].y };
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).send('Nur POST'); return; }
  try {
    const { pdfUrl, signaturePng, debug } = req.body || {};
    if (!pdfUrl || !signaturePng) { res.status(400).send('pdfUrl und signaturePng nötig'); return; }

    // Original serverseitig laden (kein CORS)
    const fileRes = await fetch(pdfUrl);
    if (!fileRes.ok) { res.status(502).send('Original konnte nicht geladen werden (Status ' + fileRes.status + ')'); return; }
    const originalBytes = await fileRes.arrayBuffer();

    const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width: pw, height: ph } = lastPage.getSize();
    const istQuer = pw > ph;

    const pngBytes = Buffer.from(String(signaturePng).replace(/^data:image\/png;base64,/, ''), 'base64');
    const png = await pdfDoc.embedPng(pngBytes);

    // Anker per Textextraktion (bei Bild-PDFs schlägt das fehl -> Fallback)
    let anchor = null;
    let words = [];
    try {
      words = await extractWords(originalBytes);
      for (const phrase of ANKER) {
        anchor = findAnchor(words, phrase);
        if (anchor) break;
      }
    } catch {
      anchor = null;
    }

    let sigW, sigX, sigY;
    if (anchor) {
      sigW = istQuer ? 320 : 200;
      sigX = anchor.x - 20;
      sigY = anchor.y + 20;
    } else if (istQuer) {
      sigW = 300; sigX = 75; sigY = 210;
    } else {
      sigW = 170; sigX = pw - sigW - 50; sigY = ph * 0.22;
    }
    const sigH = sigW * (png.height / png.width);

    lastPage.drawImage(png, { x: sigX, y: sigY, width: sigW, height: sigH });
    const out = await pdfDoc.save();

    // Debug: Wortkoordinaten + gewählte Position als JSON (datenbasiertes Nachjustieren)
    if (debug) {
      res.status(200).json({ istQuer, pageSize: { pw, ph }, anchor, chosen: { sigX, sigY, sigW, sigH }, words });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.status(200).send(Buffer.from(out));
  } catch (e) {
    res.status(500).send('Signatur fehlgeschlagen: ' + String((e && e.message) || e));
  }
}
