// Tests für /api/stundenzettel (PDF-Erzeugung) mit Airtable-Attrappe, ohne Netz.
// Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { airtableAttrappe, antwort, antwortObjekt } from './_hilfen.mjs';
import handler, {
  pdfText, erstellePdf, tagesZeilen, tagesSummeText, SPALTEN, ERLAEUTERUNG, HINWEIS,
  NICHT_BESTAETIGT_TITEL, nichtBestaetigtZeilen, nichtBestaetigtText,
} from '../api/stundenzettel.js';
import { berechneZeitnachweis, berlin, minutenAus } from '../api/_zeitkonto.js';

process.env.STUNDENZETTEL_SECRET = 'test-secret-1234567890';
const ZETTEL = 'tblmlg9ZNrtwRxmXx', PERSONAL = 'tbl3pMfhOLYPsQ5jF', BESUCHE = 'tblXJOSz4LaJCG10M';
const REC = 'recZettelTest0001', MA = 'recMaTestXXXXXXX1';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Datum relativ zu heute (Berlin) als YYYY-MM-DD
const tag = (offset) => {
  const h = berlin(Date.now()).datum;
  const d = new Date(`${h}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
// Ein Tag im Vormonat (sicher vollständig vergangen), Tag des Monats frei wählbar (1-28)
const imVormonat = (tagImMonat) => {
  const h = berlin(Date.now()).datum;
  const vormonat = new Date(`${h.slice(0, 7)}-01T12:00:00Z`); vormonat.setUTCDate(0);
  return `${vormonat.toISOString().slice(0, 8)}${String(tagImMonat).padStart(2, '0')}`;
};
const monatName = (ym) => `${MONATE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
// Standard: bestätigt mit Ist = Zeitfenster (Dauer_Ist in Sekunden, wie /api/besuch-dauer schreibt)
const besuch = (datum, von, bis, extra = {}) => ({
  id: `rec${Math.random().toString(36).slice(2, 16).padEnd(14, 'x')}`,
  fields: {
    Datum: datum, Monat: datum.slice(0, 7), Von: von, Bis: bis, Status: 'Bestätigt', Pfleger_ID: [MA],
    Patient_Name: ['Erika Musterfrau'], Dauer_Ist: (minutenAus(bis) - minutenAus(von)) * 60, ...extra,
  },
});
// Nicht bestätigt: Dauer_Ist fehlt (die REST-API lässt leere Felder weg)
const offen = (datum, von, bis, extra = {}) => {
  const r = besuch(datum, von, bis, extra);
  delete r.fields.Dauer_Ist;
  return r;
};

// Alle Textstücke eines von pdf-lib erzeugten PDFs (Text steht als <HEX> Tj in Flate-Streams,
// kodiert in Windows-1252; Nodes TextDecoder bildet 0x80-0x9F nicht ab -> eigene Tabelle).
const CP1252_80_9F = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const cp1252 = { decode: (buf) => [...buf].map((x) => (x >= 0x80 && x <= 0x9f ? CP1252_80_9F[x - 0x80] : String.fromCharCode(x))).join('') };
function pdfTexte(bytes) {
  const roh = Buffer.from(bytes).toString('latin1');
  const texte = [];
  for (const m of roh.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let inhalt = Buffer.from(m[1], 'latin1');
    try { inhalt = zlib.inflateSync(inhalt); } catch { /* unkomprimiert */ }
    for (const t of inhalt.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) texte.push(cp1252.decode(Buffer.from(t[1], 'hex')));
  }
  return texte;
}

function szenario({ monat, besuche, uploadStatus = 200 }) {
  const log = { upload: null, patches: [] };
  const p = airtableAttrappe(async (a) => {
    if (a.host === 'content.airtable.com') { log.upload = a.body; return antwort(uploadStatus, { id: REC }); }
    if (a.tabelle === ZETTEL && a.methode === 'GET') {
      return antwort(200, { id: REC, fields: { Mitarbeiter: [MA], Monat_Auswahl: monatName(monat) } });
    }
    if (a.tabelle === ZETTEL && a.methode === 'PATCH') { log.patches.push(a.body.fields); return antwort(200, { id: REC }); }
    if (a.tabelle === PERSONAL) return antwort(200, { id: MA, fields: { Name: 'Anna Beispiel', Anmelde_ID: 90099 } });
    if (a.tabelle === BESUCHE) return antwort(200, { records: besuche });
    return antwort(404, {});
  });
  return { p, log };
}
const req = (secret = process.env.STUNDENZETTEL_SECRET) => ({ method: 'POST', headers: { 'x-hook-secret': secret }, body: { recordId: REC } });
const ruhig = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('ohne/mit falschem Secret -> 401, keine Airtable-Zugriffe', async () => {
  const { p } = szenario({ monat: tag(-40).slice(0, 7), besuche: [] });
  const res = antwortObjekt();
  await handler(req('falsch'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(p.aufrufe.length, 0);
});

test('abgeschlossener Monat: Anfahrt + Pause (mind. 30 Min Anfahrt je Lücke), Summe 3:00, finaler Zettel', async () => {
  const d = imVormonat(15), d2 = imVormonat(16);
  const { log } = szenario({
    monat: d.slice(0, 7),
    besuche: [besuch(d, '06:45', '07:00'), besuch(d, '07:30', '08:15'), besuch(d, '09:00', '10:00'),
      besuch(d, '11:00', '12:00', { Status: 'Abgesagt' }),
      offen(d2, '08:00', '09:00', { Patient_Name: ['Max Mustermann'] })], // nicht bestätigt -> zählt nicht
  });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  // Einsätze 2:00 + Anfahrt 0:30 (Lücke 30 Min) + 0:30 (Lücke 45 Min: 0:15 Pause + 0:30 Anfahrt)
  assert.equal(res.body.summe, '3:00');
  assert.equal(res.body.vorlaeufig, false);
  assert.equal(res.body.einsaetze, 3);
  assert.equal(res.body.ohneIst, 1);
  assert.equal(log.upload.filename, `Stundenzettel_${d.slice(0, 7)}_final.pdf`);
  const bytes = Buffer.from(log.upload.file, 'base64');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  // Der nicht bestätigte Einsatz steht getrennt auf dem Zettel, ohne Ist-Zeit
  const texte = pdfTexte(bytes);
  const titel = texte.indexOf(NICHT_BESTAETIGT_TITEL);
  assert.ok(titel > 0, 'Liste "nicht bestätigt" fehlt im PDF');
  assert.deepEqual(texte.slice(titel + 1, titel + 6),
    [`${d2.slice(8, 10)}.${d2.slice(5, 7)}.${d2.slice(0, 4)}`, '08:00 – 09:00', '1:00', '–', 'Max Mustermann']);
  assert.ok(texte.includes('Nicht bestätigt: 1 Einsatz (geplant 1:00 Std.) – nicht berechnet, Liste oben.'));
  assert.ok(!texte.some((t) => /\*/.test(t)), 'kein "*" (Soll-Ersatz) mehr auf dem Zettel');
  const f = log.patches.at(-1);
  assert.equal(f.Summe_Stunden, '3:00');
  assert.equal(f.Status, 'Erstellt');
  assert.ok(!/vorläufig/.test(f.Titel));
});

test('abgeschlossener Monat ganz ohne Bestätigung: Summe 0:00, Liste auf dem Zettel, Status "Erstellt"', async () => {
  const d = imVormonat(10);
  const { log } = szenario({ monat: d.slice(0, 7), besuche: [offen(d, '08:00', '09:00'), offen(d, '10:00', '10:30')] });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.summe, '0:00');
  assert.equal(res.body.einsaetze, 0);
  assert.equal(res.body.ohneIst, 2);
  assert.equal(log.patches.at(-1).Summe_Stunden, '0:00');
  assert.equal(log.patches.at(-1).Status, 'Erstellt');
  const texte = pdfTexte(Buffer.from(log.upload.file, 'base64'));
  assert.ok(texte.includes('Keine bestätigten Einsätze in diesem Monat.'));
  assert.ok(texte.includes(NICHT_BESTAETIGT_TITEL));
  assert.ok(texte.includes('Nicht bestätigt: 2 Einsätze (geplant 1:30 Std.) – nicht berechnet, Liste oben.'));
  assert.ok(!texte.includes('Pflegedienstleitung'), 'ohne berechnete Einsätze keine Unterschrift');
});

test('laufender Monat: nur Vergangenes und Bestätigtes zählt, Zettel ist vorläufig', async () => {
  const gestern = tag(-1), morgen = tag(1);
  const monat = berlin(Date.now()).datum.slice(0, 7);
  const imMonat = [gestern, morgen].filter((x) => x.slice(0, 7) === monat);
  const besuche = imMonat.flatMap((x) => [besuch(x, '08:00', '09:00'), offen(x, '10:00', '11:00')]);
  const { log } = szenario({ monat, besuche });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vorlaeufig, true);
  const erwartet = imMonat.includes(gestern) ? 1 : 0;
  assert.equal(res.body.einsaetze, erwartet);
  assert.equal(res.body.ohneIst, erwartet); // morgen ist weder gezählt noch "nicht bestätigt"
  assert.equal(res.body.summe, erwartet ? '1:00' : '0:00');
  assert.match(log.upload.filename, new RegExp(`^Stundenzettel_${monat}_vorlaeufig_\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
  assert.match(log.patches.at(-1).Titel, /\(vorläufig\)$/);
});

test('Upload schlägt fehl -> Status "Fehler", 500 ohne Details', async () => {
  const d = tag(-40);
  const { log } = szenario({ monat: d.slice(0, 7), besuche: [besuch(d, '08:00', '09:00')], uploadStatus: 500 });
  const res = antwortObjekt();
  await ruhig(() => handler(req(), res));
  assert.equal(res.statusCode, 500);
  assert.equal(log.patches.at(-1).Status, 'Fehler');
});

test('Sonderzeichen in Namen brechen das PDF nie ab (auch in der Liste "nicht bestätigt")', async () => {
  assert.equal(pdfText('Łukasz Wójcik'), 'Lukasz Wójcik');
  assert.equal(pdfText('Ayşe Yılmaz-Doğan'), 'Ayse Yilmaz-Dogan');
  assert.equal(pdfText('Олена'), '?????');
  assert.equal(pdfText('Müller – Groß'), 'Müller – Groß');
  const d = tag(-40);
  const nachweis = berechneZeitnachweis([
    besuch(d, '08:00', '08:30', { Patient_Name: ['Łukasz Wójcik'] }),
    besuch(d, '08:45', '09:00', { Patient_Name: ['Ayşe Yılmaz-Doğan mit einem sehr sehr langen Doppelnamen, der nicht in die Spalte passt'] }),
    besuch(d, '10:00', '10:30', { Patient_Name: ['Олена Коваленко'] }),
    offen(d, '11:00', '11:30', { Patient_Name: ['Ğülşen Öztürk-Çelik mit einem sehr sehr langen Doppelnamen, der nicht passt'] }),
  ], { jetzt: Date.now() });
  const bytes = await erstellePdf({ maName: 'Tuğçe Ğ', maNr: 90099, monat: d.slice(0, 7), nachweis, final: true });
  assert.ok(bytes.length > 1000);
  assert.ok(pdfTexte(bytes).some((t) => /^Gülsen Öztürk-Çelik mit .*…$/.test(t)), 'langer Name gekürzt');
});

test('viele Einsätze -> mehrere Seiten, Kopf je Seite', async () => {
  const d0 = tag(-40);
  const besuche = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(`${d0.slice(0, 8)}01T12:00:00Z`); d.setUTCDate(1 + i);
    const ds = d.toISOString().slice(0, 10);
    besuche.push(besuch(ds, '08:00', '08:30'), besuch(ds, '08:45', '09:30'), besuch(ds, '10:30', '11:00'));
  }
  const nachweis = berechneZeitnachweis(besuche, { jetzt: Date.now() });
  const bytes = await erstellePdf({ maName: 'Anna Beispiel', maNr: 90099, monat: d0.slice(0, 7), nachweis, final: true });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2, `Seiten: ${pdf.getPageCount()}`);
});

test('lange Liste "nicht bestätigt" läuft sauber über mehrere Seiten, jede Zeile genau einmal', async () => {
  const d0 = tag(-40);
  const besuche = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(`${d0.slice(0, 8)}01T12:00:00Z`); d.setUTCDate(1 + i);
    const ds = d.toISOString().slice(0, 10);
    besuche.push(offen(ds, '08:00', '08:30', { Patient_Name: [`Klient ${i}-1`] }), offen(ds, '09:00', '09:45', { Patient_Name: [`Klient ${i}-2`] }));
  }
  const nachweis = berechneZeitnachweis(besuche, { jetzt: Date.now() });
  const bytes = await erstellePdf({ maName: 'Anna Beispiel', maNr: 90099, monat: d0.slice(0, 7), nachweis, final: true });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2, `Seiten: ${pdf.getPageCount()}`);
  const texte = pdfTexte(bytes);
  for (let i = 0; i < 28; i++) {
    assert.equal(texte.filter((t) => t === `Klient ${i}-1`).length, 1);
    assert.equal(texte.filter((t) => t === `Klient ${i}-2`).length, 1);
  }
  assert.ok(texte.includes('Nicht bestätigt: 56 Einsätze (geplant 35:00 Std.) – nicht berechnet, Liste oben.'));
});

test('Spalten: Soll und Ist getrennt, Zeitraum laut Ist bei Abweichung, Klient ganz rechts; Unbestätigtes getrennt', () => {
  const d = tag(-40);
  const k = (name) => ({ Patient_Name: [name] });
  const nachweis = berechneZeitnachweis([
    besuch(d, '08:00', '08:30', { ...k('Klient A'), Dauer_Ist: 3600 }), // länger als geplant
    besuch(d, '08:45', '09:15', { ...k('Klient B'), Dauer_Ist: 1800 }), // wie geplant, aber verschoben
    offen(d, '09:45', '10:00', k('Klient C')),                          // nicht bestätigt
    besuch(d, '11:00', '11:30', { ...k('Klient D'), Dauer_Ist: 0 }),     // nicht angetroffen (bestätigt 0)
  ], { jetzt: Date.now() });
  const t = nachweis.tage[0];
  assert.deepEqual(tagesZeilen(t).map((z) => [z.art, z.fenster, z.soll, z.ist, z.fett, z.istFenster, z.klient]), [
    ['einsatz', '08:00 – 08:30', '0:30', '1:00', true, '08:00 – 09:00', 'Klient A'],
    ['einsatz', '08:45 – 09:15', '0:30', '0:30', false, '09:00 – 09:30', 'Klient B'],
    ['pause', '09:30 – 10:30', '', '(1:00)', false, '', 'Pause (unbezahlt)'],
    ['anfahrt', '10:30 – 11:00', '', '0:30', false, '', 'Kunden-Anfahrt'],
    ['einsatz', '11:00 – 11:30', '0:30', '0:00', true, '', 'Klient D'],
  ]);
  assert.equal(tagesSummeText(t), 'Tagessumme · davon Anfahrt 0:30 · Pause 1:00 unbezahlt');
  assert.equal(t.bezahltMin, 120); // 1:00 + 0:30 + 0:00 + Anfahrt 0:30 (keine Anfahrt zu Klient C)
  const datumDe = `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
  assert.deepEqual(nichtBestaetigtZeilen(nachweis), [
    { datum: datumDe, fenster: '09:45 – 10:00', soll: '0:15', ist: '–', klient: 'Klient C' },
  ]);
  // Reihenfolge der Spalten: Datum | Zeitfenster | Soll | Ist | Klient (ganz rechts)
  assert.ok(SPALTEN.datum < SPALTEN.fenster && SPALTEN.fenster < SPALTEN.sollR
    && SPALTEN.sollR < SPALTEN.istR && SPALTEN.istR < SPALTEN.klient);
});

test('Hinweis "nicht bestätigt" im Summenblock: Einzahl, Mehrzahl, leer', () => {
  assert.equal(nichtBestaetigtText({ ohneIst: 0, ohneIstSollMin: 0 }), '');
  assert.equal(nichtBestaetigtText(undefined), '');
  assert.equal(nichtBestaetigtText({ ohneIst: 1, ohneIstSollMin: 45 }), 'Nicht bestätigt: 1 Einsatz (geplant 0:45 Std.) – nicht berechnet, Liste oben.');
  assert.equal(nichtBestaetigtText({ ohneIst: 12, ohneIstSollMin: 615 }), 'Nicht bestätigt: 12 Einsätze (geplant 10:15 Std.) – nicht berechnet, Liste oben.');
  assert.deepEqual(nichtBestaetigtZeilen(undefined), []);
  assert.deepEqual(nichtBestaetigtZeilen({ nichtBestaetigt: [{ datum: null, von: '', bis: '', sollMin: null, klient: '' }] }), [
    { datum: '–', fenster: '–', soll: '–', ist: '–', klient: '–' },
  ]);
});

test('Erläuterung und Hinweis: vollständig darstellbar, Regel "nur Bestätigtes zählt" erklärt, passt in die Breite', async () => {
  for (const satz of [HINWEIS, NICHT_BESTAETIGT_TITEL, ...ERLAEUTERUNG]) assert.equal(pdfText(satz), satz);
  assert.ok(ERLAEUTERUNG.length >= 4);
  // Regel seit 28.10.2026: auch bei längerer Lücke 30 Min Anfahrt, nur der Rest ist Pause
  assert.ok(ERLAEUTERUNG.some((s) => /Lücke länger, werden trotzdem 30 Minuten Anfahrt bezahlt; nur der Rest ist Pause/.test(s)));
  assert.ok(!ERLAEUTERUNG.some((s) => /Mehr als 30 Minuten sind eine Pause/.test(s)));
  // Regel seit 30.10.2026: ohne Bestätigung nichts berechnet, kein Soll-Ersatz
  assert.ok(ERLAEUTERUNG.some((s) => /ohne bestätigte Ist-Zeit werden nicht berechnet – auch keine Kunden-Anfahrt/.test(s)));
  assert.ok(ERLAEUTERUNG.some((s) => s.includes(`„${NICHT_BESTAETIGT_TITEL}“`)));
  assert.match(HINWEIS, /bezahlt wird nur die bestätigte Ist-Zeit/);
  assert.ok(![HINWEIS, ...ERLAEUTERUNG].some((s) => /Soll-Zeit wurde angerechnet|\*/.test(s)));
  // Layout: Hinweis (8 pt) und längster Summen-Hinweis (9 pt fett) passen zwischen die Ränder (A4, Rand 50)
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const breite = 595.28 - 2 * 50;
  assert.ok(normal.widthOfTextAtSize(pdfText(HINWEIS), 8) <= breite, 'HINWEIS zu breit');
  assert.ok(fett.widthOfTextAtSize(pdfText(nichtBestaetigtText({ ohneIst: 999, ohneIstSollMin: 99 * 60 + 45 })), 9) <= breite);
});
