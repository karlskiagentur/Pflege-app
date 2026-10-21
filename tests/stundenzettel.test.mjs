// Tests für /api/stundenzettel (PDF-Erzeugung) mit Airtable-Attrappe, ohne Netz.
// Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { airtableAttrappe, antwort, antwortObjekt } from './_hilfen.mjs';
import handler, { pdfText, erstellePdf } from '../api/stundenzettel.js';
import { berechneZeitnachweis, berlin } from '../api/_zeitkonto.js';

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
const monatName = (ym) => `${MONATE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const besuch = (datum, von, bis, extra = {}) => ({
  id: `rec${Math.random().toString(36).slice(2, 16).padEnd(14, 'x')}`,
  fields: { Datum: datum, Monat: datum.slice(0, 7), Von: von, Bis: bis, Status: 'Bestätigt', Pfleger_ID: [MA], Patient_Name: ['Erika Musterfrau'], ...extra },
});

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

test('abgeschlossener Monat: Anfahrt + Pause, Summe 2:30, finaler Zettel', async () => {
  // Ein Tag im Vormonat (sicher vollständig vergangen)
  const h = berlin(Date.now()).datum;
  const vormonat = new Date(`${h.slice(0, 7)}-01T12:00:00Z`); vormonat.setUTCDate(0);
  const d = vormonat.toISOString().slice(0, 10).slice(0, 8) + '15';
  const { log } = szenario({
    monat: d.slice(0, 7),
    besuche: [besuch(d, '06:45', '07:00'), besuch(d, '07:30', '08:15'), besuch(d, '09:00', '10:00'),
      besuch(d, '11:00', '12:00', { Status: 'Abgesagt' })],
  });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.summe, '2:30');
  assert.equal(res.body.vorlaeufig, false);
  assert.equal(res.body.einsaetze, 3);
  assert.equal(log.upload.filename, `Stundenzettel_${d.slice(0, 7)}_final.pdf`);
  const pdf = await PDFDocument.load(Buffer.from(log.upload.file, 'base64'));
  assert.equal(pdf.getPageCount(), 1);
  const f = log.patches.at(-1);
  assert.equal(f.Summe_Stunden, '2:30');
  assert.equal(f.Status, 'Erstellt');
  assert.ok(!/vorläufig/.test(f.Titel));
});

test('laufender Monat: nur Vergangenes zählt, Zettel ist vorläufig', async () => {
  const gestern = tag(-1), morgen = tag(1);
  const monat = berlin(Date.now()).datum.slice(0, 7);
  const imMonat = [gestern, morgen].filter((x) => x.slice(0, 7) === monat);
  const besuche = imMonat.map((x) => besuch(x, '08:00', '09:00'));
  const { log } = szenario({ monat, besuche });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vorlaeufig, true);
  const erwartet = imMonat.includes(gestern) ? 1 : 0;
  assert.equal(res.body.einsaetze, erwartet);
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

test('Sonderzeichen in Namen brechen das PDF nie ab', async () => {
  assert.equal(pdfText('Łukasz Wójcik'), 'Lukasz Wójcik');
  assert.equal(pdfText('Ayşe Yılmaz-Doğan'), 'Ayse Yilmaz-Dogan');
  assert.equal(pdfText('Олена'), '?????');
  assert.equal(pdfText('Müller – Groß'), 'Müller – Groß');
  const d = tag(-40);
  const nachweis = berechneZeitnachweis([
    besuch(d, '08:00', '08:30', { Patient_Name: ['Łukasz Wójcik'] }),
    besuch(d, '08:45', '09:00', { Patient_Name: ['Ayşe Yılmaz-Doğan mit einem sehr sehr langen Doppelnamen, der nicht in die Spalte passt'] }),
    besuch(d, '10:00', '10:30', { Patient_Name: ['Олена Коваленко'] }),
  ], { jetzt: Date.now() });
  const bytes = await erstellePdf({ maName: 'Tuğçe Ğ', maNr: 90099, monat: d.slice(0, 7), nachweis, final: true });
  assert.ok(bytes.length > 1000);
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
