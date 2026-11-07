// Tests für /api/stundenzettel (PDF-Erzeugung) mit Airtable-Attrappe, ohne Netz.
// Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { airtableAttrappe, antwort, antwortObjekt, pdfTexte } from './_hilfen.mjs';
import handler, {
  pdfText, erstellePdf, tagesZeilen, tagesSummeText, SPALTEN, ERLAEUTERUNG, HINWEIS,
  NICHT_BESTAETIGT_TITEL, nichtBestaetigtZeilen, nichtBestaetigtText, UNTERSCHRIFT_ROLLE, neuesteZuerst, besucheFormel,
  ABWESENHEIT_TITEL, abwesenheitZeilen, abwesenheitSummen, summeNotiz,
} from '../api/stundenzettel.js';
import { abrechnungszeitraum } from '../api/_abrechnung.js';
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
// Handler-Tests laufen zu einer festen Uhrzeit (unabhängig vom Testtag): t.mock.timers ersetzt Date.
// 05.12.2026: abgeschlossen ist „November 2026“ (01.11.–26.11.), es läuft „Dezember 2026“ (27.11.–26.12.).
const zeit = (t, iso) => { t.mock.timers.reset(); t.mock.timers.enable({ apis: ['Date'], now: new Date(iso) }); };
const AM_05_12 = '2026-12-05T10:00:00Z';
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

// datei: Anhänge der Zeile VOR dem Hochladen (Neuerstellung); dateiNachher: Stand nach dem Hochladen
// (Standard: neue Datei hinten angehängt, wie uploadAttachment es tut). sortierStatus/nachherStatus:
// Antwort auf das Umsortieren (PATCH mit Datei) bzw. auf das erneute Lesen nach dem Hochladen.
const NEUE_DATEI = { id: 'attNeueFassung01', filename: 'neu.pdf' };
function szenario({ monat, besuche, uploadStatus = 200, datei, dateiNachher, sortierStatus = 200, nachherStatus = 200 }) {
  const log = { upload: null, patches: [], zettelGets: 0, besucheFormel: null };
  const p = airtableAttrappe(async (a) => {
    if (a.host === 'content.airtable.com') { log.upload = a.body; return antwort(uploadStatus, { id: REC }); }
    if (a.tabelle === ZETTEL && a.methode === 'GET') {
      log.zettelGets += 1;
      const fields = { Mitarbeiter: [MA], Monat_Auswahl: monatName(monat) };
      if (log.upload) {
        if (nachherStatus !== 200) return antwort(nachherStatus, { error: { type: 'SERVER_ERROR' } });
        const nachher = dateiNachher || [...(datei || []), NEUE_DATEI];
        if (nachher.length) fields.Datei = nachher;
      } else if (datei) {
        fields.Datei = datei;
      }
      return antwort(200, { id: REC, fields });
    }
    if (a.tabelle === ZETTEL && a.methode === 'PATCH') {
      log.patches.push(a.body.fields);
      if (a.body.fields.Datei && sortierStatus !== 200) return antwort(sortierStatus, { error: { type: 'INVALID_VALUE_FOR_COLUMN' } });
      return antwort(200, { id: REC });
    }
    if (a.tabelle === PERSONAL) return antwort(200, { id: MA, fields: { Name: 'Anna Beispiel', Anmelde_ID: 90099 } });
    if (a.tabelle === BESUCHE) { log.besucheFormel = a.formel; return antwort(200, { records: besuche }); }
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

test('abgeschlossener Monat: Anfahrt + Pause (mind. 30 Min Anfahrt je Lücke), Summe 3:00, finaler Zettel', async (t) => {
  zeit(t, AM_05_12);
  const d = '2026-11-15', d2 = '2026-11-16';
  const { log } = szenario({
    monat: '2026-11',
    besuche: [besuch(d, '06:45', '07:00'), besuch(d, '07:30', '08:15'), besuch(d, '09:00', '10:00'),
      besuch(d, '11:00', '12:00', { Status: 'Abgesagt' }),
      offen(d2, '08:00', '09:00', { Patient_Name: ['Max Mustermann'] }), // nicht bestätigt -> zählt nicht
      // außerhalb des Zeitraums 01.11.–26.11. (kommt über {Monat} als Kandidat mit) -> zählt nicht
      besuch('2026-11-27', '08:00', '09:00'), offen('2026-11-30', '08:00', '09:00')],
  });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  // Einsätze 2:00 + Anfahrt 0:30 (Lücke 30 Min) + 0:30 (Lücke 45 Min: 0:15 Pause + 0:30 Anfahrt)
  assert.equal(res.body.summe, '3:00');
  assert.equal(res.body.vorlaeufig, false);
  assert.equal(res.body.einsaetze, 3);
  assert.equal(res.body.ohneIst, 1);
  assert.equal(log.upload.filename, 'Stundenzettel_2026-11_final.pdf');
  const bytes = Buffer.from(log.upload.file, 'base64');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  // Der nicht bestätigte Einsatz steht getrennt auf dem Zettel, ohne Ist-Zeit
  const texte = pdfTexte(bytes);
  // Kopf mit Abrechnungszeitraum (Übergangsmonat November 2026)
  assert.ok(texte.includes('Anna Beispiel · Nr. 90099 · November 2026 · 01.11.–26.11.2026'), 'Zeitraum fehlt im Kopf');
  assert.ok(!texte.some((x) => /^(27|30)\.11\.2026$/.test(x)), 'Einsatz außerhalb des Zeitraums steht auf dem Zettel');
  const titel = texte.indexOf(NICHT_BESTAETIGT_TITEL);
  assert.ok(titel > 0, 'Liste "nicht bestätigt" fehlt im PDF');
  assert.deepEqual(texte.slice(titel + 1, titel + 6),
    [`${d2.slice(8, 10)}.${d2.slice(5, 7)}.${d2.slice(0, 4)}`, '08:00 – 09:00', '1:00', '–', 'Max Mustermann']);
  assert.ok(texte.includes('Nicht bestätigt: 1 Einsatz (geplant 1:00 Std.) – nicht berechnet, Liste oben.'));
  assert.ok(!texte.some((t) => /\*/.test(t)), 'kein "*" (Soll-Ersatz) mehr auf dem Zettel');
  // Unterschriftszeile: „Geschäftsleitung“ (Wunsch des Pflegedienstes 01.11.2026)
  assert.equal(UNTERSCHRIFT_ROLLE, 'Geschäftsleitung');
  assert.ok(texte.includes('Geschäftsleitung'), 'Unterschriftszeile fehlt');
  assert.ok(!texte.some((t) => /Pflegedienstleitung/.test(t)), 'alte Bezeichnung steht noch auf dem Zettel');
  const f = log.patches.at(-1);
  assert.equal(f.Summe_Stunden, '3:00');
  assert.equal(f.Status, 'Erstellt');
  assert.ok(!/vorläufig/.test(f.Titel));
});

test('abgeschlossener Monat ganz ohne Bestätigung: Summe 0:00, Liste auf dem Zettel, Status "Erstellt"', async (t) => {
  zeit(t, AM_05_12);
  const d = '2026-11-10';
  const { log } = szenario({ monat: '2026-11', besuche: [offen(d, '08:00', '09:00'), offen(d, '10:00', '10:30')] });
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
  assert.ok(!texte.includes(UNTERSCHRIFT_ROLLE), 'ohne berechnete Einsätze keine Unterschrift');
});

test('laufender Monat: nur Vergangenes und Bestätigtes im Zeitraum zählt, Zettel ist vorläufig', async (t) => {
  zeit(t, '2026-12-10T12:00:00Z'); // 13:00 Uhr deutscher Zeit; Zeitraum Dezember 2026 = 27.11.–26.12.
  const besuche = [
    besuch('2026-12-09', '08:00', '09:00'), offen('2026-12-09', '10:00', '11:00'), // gestern
    besuch('2026-12-11', '08:00', '09:00'), offen('2026-12-11', '10:00', '11:00'), // morgen: zählt noch nicht
    besuch('2026-11-28', '08:00', '09:00'),                                         // im Zeitraum (November-Datum)
    besuch('2026-11-26', '08:00', '09:00'),                                         // gehört zu November
  ];
  const { log } = szenario({ monat: '2026-12', besuche });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vorlaeufig, true);
  assert.equal(res.body.einsaetze, 2);
  assert.equal(res.body.ohneIst, 1); // morgen ist weder gezählt noch "nicht bestätigt"
  assert.equal(res.body.summe, '2:00');
  assert.equal(log.upload.filename, 'Stundenzettel_2026-12_vorlaeufig_2026-12-10.pdf');
  assert.match(log.patches.at(-1).Titel, /\(vorläufig\)$/);
  // Kandidaten aus beiden Kalendermonaten des Zeitraums
  assert.ok(log.besucheFormel.includes("{Monat} = '2026-11'") && log.besucheFormel.includes("{Monat} = '2026-12'"));
});

test('Stichtag: Zettel Dezember 2026 (27.11.–26.12.) ist ab dem 27.12. fertig, am 26.12. abends noch vorläufig', async (t) => {
  const besuche = [
    besuch('2026-11-26', '08:00', '09:00'), besuch('2026-11-27', '08:00', '09:00'),
    besuch('2026-12-26', '08:00', '09:00'), besuch('2026-12-27', '08:00', '09:00'),
  ];
  zeit(t, '2026-12-26T22:00:00Z'); // 23:00 Uhr am 26.12.
  let s = szenario({ monat: '2026-12', besuche });
  let res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.body.vorlaeufig, true);
  assert.equal(res.body.einsaetze, 2);
  zeit(t, '2026-12-27T03:00:00Z'); // 04:00 Uhr am 27.12. (Monatslauf)
  s = szenario({ monat: '2026-12', besuche });
  res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vorlaeufig, false);
  assert.equal(res.body.einsaetze, 2); // 27.11. und 26.12. – nicht 26.11. (November), nicht 27.12. (Januar)
  assert.equal(res.body.summe, '2:00');
  assert.equal(s.log.upload.filename, 'Stundenzettel_2026-12_final.pdf');
  const texte = pdfTexte(Buffer.from(s.log.upload.file, 'base64'));
  assert.ok(texte.includes('Anna Beispiel · Nr. 90099 · Dezember 2026 · 27.11.–26.12.2026'));
  assert.ok(texte.includes(UNTERSCHRIFT_ROLLE));
});

test('Zeitraum über den Jahreswechsel und alte Kalendermonate: Kopf und Auswahl stimmen', async (t) => {
  zeit(t, '2027-02-03T10:00:00Z');
  const s = szenario({ monat: '2027-01', besuche: [besuch('2026-12-27', '08:00', '09:00'), besuch('2027-01-27', '08:00', '09:00')] });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.body.einsaetze, 1);
  assert.equal(res.body.vorlaeufig, false);
  const texte = pdfTexte(Buffer.from(s.log.upload.file, 'base64'));
  assert.ok(texte.includes('Anna Beispiel · Nr. 90099 · Januar 2027 · 27.12.2026–26.01.2027'));
  // Ein Oktober-Zettel (vor der Umstellung) bleibt ein Kalendermonat
  const alt = szenario({ monat: '2026-10', besuche: [besuch('2026-10-01', '08:00', '09:00'), besuch('2026-10-31', '08:00', '09:00')] });
  const res2 = antwortObjekt();
  await handler(req(), res2);
  assert.equal(res2.body.einsaetze, 2);
  assert.ok(pdfTexte(Buffer.from(alt.log.upload.file, 'base64')).includes('Anna Beispiel · Nr. 90099 · Oktober 2026 · 01.10.–31.10.2026'));
  assert.ok(alt.log.besucheFormel.startsWith("AND(OR({Monat} = '2026-10'), FIND("));
});

test('besucheFormel: Kandidaten über die berührten Kalendermonate, Mitarbeiter-ID escaped', () => {
  assert.equal(besucheFormel('recMaTestXXXXXXX1', abrechnungszeitraum('2026-12')),
    "AND(OR({Monat} = '2026-11', {Monat} = '2026-12'), FIND('recMaTestXXXXXXX1', ARRAYJOIN({Pfleger_ID})))");
  assert.equal(besucheFormel('recMaTestXXXXXXX1', abrechnungszeitraum('2026-11')),
    "AND(OR({Monat} = '2026-11'), FIND('recMaTestXXXXXXX1', ARRAYJOIN({Pfleger_ID})))");
  assert.ok(besucheFormel("rec'X", abrechnungszeitraum('2026-12')).includes("FIND('rec\\'X'"));
});

test('Kopfzeile mit Zeitraum passt auch bei langem Namen auf die Seite', async () => {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const kopf = pdfText('Huong Thi Xuan N. Mustermann · Nr. 90123 · September 2027 · 27.12.2026–26.01.2027');
  assert.ok(normal.widthOfTextAtSize(kopf, 11) <= 595.28 - 2 * 50, `zu breit: ${normal.widthOfTextAtSize(kopf, 11)}`);
});

test('Upload schlägt fehl -> Status "Fehler", 500 ohne Details', async (t) => {
  zeit(t, AM_05_12);
  const d = '2026-11-10';
  const { log } = szenario({ monat: '2026-11', besuche: [besuch(d, '08:00', '09:00')], uploadStatus: 500 });
  const res = antwortObjekt();
  await ruhig(() => handler(req(), res));
  assert.equal(res.statusCode, 500);
  assert.equal(log.patches.at(-1).Status, 'Fehler');
});

// --- Neue Fassung vorne (Wunsch Büro 01.11.2026: wer die Zeile öffnet, sieht zuerst die aktuelle) ---
const ALT1 = { id: 'attAlteFassung01', filename: 'alt1.pdf' };
const ALT2 = { id: 'attAlteFassung02', filename: 'alt2.pdf' };

test('Neuerstellung: neue Fassung steht vorne, alle früheren bleiben dahinter', async (t) => {
  zeit(t, AM_05_12);
  const d = '2026-11-10';
  const { log } = szenario({ monat: '2026-11', besuche: [besuch(d, '08:00', '09:00')], datei: [ALT1, ALT2] });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(log.patches.length, 2);
  assert.equal(log.patches[0].Status, 'Erstellt');      // erst der fertige Zettel …
  assert.equal(log.patches[0].Summe_Stunden, '1:00');
  assert.equal(log.patches[0].Datei, undefined);
  assert.deepEqual(log.patches[1], { Datei: [{ id: NEUE_DATEI.id }, { id: ALT1.id }, { id: ALT2.id }] }); // … dann sortiert
});

test('Erste Fassung (noch keine Datei): kein zusätzliches Lesen, kein Umsortieren', async (t) => {
  zeit(t, AM_05_12);
  const d = '2026-11-10';
  const { log } = szenario({ monat: '2026-11', besuche: [besuch(d, '08:00', '09:00')] });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(log.zettelGets, 1);
  assert.equal(log.patches.length, 1);
  assert.equal(log.patches[0].Status, 'Erstellt');
});

test('Umsortieren scheitert: Zettel bleibt "Erstellt", Antwort 200, kein Fehlerstatus', async (t) => {
  zeit(t, AM_05_12);
  const d = '2026-11-10';
  const { log } = szenario({ monat: '2026-11', besuche: [besuch(d, '08:00', '09:00')], datei: [ALT1], sortierStatus: 422 });
  const res = antwortObjekt();
  await ruhig(() => handler(req(), res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'success');
  assert.equal(log.patches[0].Status, 'Erstellt');
  assert.ok(log.patches[1].Datei, 'Umsortieren wurde versucht');
  assert.ok(!log.patches.some((f) => f.Status === 'Fehler'));
});

test('Erneutes Lesen nach dem Hochladen scheitert: Zettel bleibt "Erstellt", nichts wird umsortiert', async (t) => {
  zeit(t, AM_05_12);
  const d = '2026-11-10';
  const { log } = szenario({ monat: '2026-11', besuche: [besuch(d, '08:00', '09:00')], datei: [ALT1], nachherStatus: 500 });
  const res = antwortObjekt();
  await ruhig(() => handler(req(), res));
  assert.equal(res.statusCode, 200);
  assert.equal(log.patches.length, 1);
  assert.equal(log.patches[0].Status, 'Erstellt');
});

test('neuesteZuerst: sortiert nur bei eindeutigem Stand, verliert nie einen Anhang', () => {
  const A = { id: 'attA' }, B = { id: 'attB' }, N = { id: 'attN' }, M = { id: 'attM' };
  // Normalfall: neue hinten angehängt -> nach vorne, Rest in bisheriger Reihenfolge
  assert.deepEqual(neuesteZuerst([A, B], [A, B, N]), [{ id: 'attN' }, { id: 'attA' }, { id: 'attB' }]);
  assert.deepEqual(neuesteZuerst([B, A], [B, A, N]), [{ id: 'attN' }, { id: 'attB' }, { id: 'attA' }]);
  // Nichts zu tun: erste Fassung, neue schon vorne, keine neue Datei
  assert.equal(neuesteZuerst([], [N]), null);
  assert.equal(neuesteZuerst(undefined, [N]), null);
  assert.equal(neuesteZuerst([A], [N, A]), null);
  assert.equal(neuesteZuerst([A, B], [A, B]), null);
  // Unklarer Stand -> lieber nichts ändern: zwei neue Dateien, ein bisheriger Anhang fehlt, kaputte Daten
  assert.equal(neuesteZuerst([A], [A, N, M]), null);
  assert.equal(neuesteZuerst([A, B], [A, N]), null);
  assert.equal(neuesteZuerst([A], undefined), null);
  assert.equal(neuesteZuerst([A], 'kein Array'), null);
  assert.deepEqual(neuesteZuerst([A, null, { id: 7 }], [A, N, null]), [{ id: 'attN' }, { id: 'attA' }]);
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
  assert.match(HINWEIS, /bezahlt: bestätigte Ist-Zeit \+ Kunden-Anfahrt \+ eingetragener Urlaub ·/);
  assert.ok(![HINWEIS, ...ERLAEUTERUNG].some((s) => /Soll-Zeit wurde angerechnet|\*/.test(s)));
  // Layout: Hinweis (8 pt) und längster Summen-Hinweis (9 pt fett) passen zwischen die Ränder (A4, Rand 50)
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const breite = 595.28 - 2 * 50;
  assert.ok(normal.widthOfTextAtSize(pdfText(HINWEIS), 8) <= breite, 'HINWEIS zu breit');
  assert.ok(fett.widthOfTextAtSize(pdfText(nichtBestaetigtText({ ohneIst: 999, ohneIstSollMin: 99 * 60 + 45 })), 9) <= breite);
});

// ---------------------------------------------------------------- Urlaub / Gleitzeit / Krank / Abwesenheit (06./07.11.2026)
// Wie in üblichen Betrieben (Vorgabe Karl 07.11.2026): Urlaub mit den eingetragenen Stunden zählt zur
// Monatssumme; Gleitzeit steht in Klammern da (Zeitkonto, zählt nicht); Krank und Abwesend sind nur
// der Tag mit „–“ – nie eine Zahl (Lohnfortzahlung rechnet das Lohnbüro).
test('Urlaub/Gleitzeit/Krank/Abwesenheit: eigene Zeilen und Summenzeilen je Art', () => {
  const nachweis = { abwesenheiten: [
    { datum: '2026-11-09', art: 'Urlaub', grund: '', von: '', bis: '', min: 480 },
    { datum: '2026-11-10', art: 'Urlaub', grund: '', von: '06:00', bis: '12:00', min: null },
    { datum: '2026-11-11', art: 'Krank', grund: '', von: '', bis: '', min: null },
    { datum: '2026-11-12', art: 'Abwesend', grund: 'Arzttermin', von: '10:00', bis: '', min: null },
    { datum: '2026-11-13', art: 'Gleitzeit', grund: '', von: '', bis: '', min: 360 },
  ] };
  assert.deepEqual(abwesenheitZeilen(nachweis), [
    { datum: '09.11.2026', fenster: 'ganztägig', soll: '–', ist: '8:00', klient: 'Urlaub' },
    { datum: '10.11.2026', fenster: '06:00 – 12:00', soll: '–', ist: '–', klient: 'Urlaub' }, // Zeitfenster zählt nicht
    { datum: '11.11.2026', fenster: 'ganztägig', soll: '–', ist: '–', klient: 'Krank' },
    { datum: '12.11.2026', fenster: 'ab 10:00', soll: '–', ist: '–', klient: 'Abwesend · Arzttermin' },
    { datum: '13.11.2026', fenster: 'ganztägig', soll: '–', ist: '(6:00)', klient: 'Gleitzeit' },
  ]);
  assert.deepEqual(abwesenheitSummen(nachweis), [
    { label: 'Urlaub (2 Tage)', anzeige: '8:00 Std.', notiz: 'davon 1 Tag ohne Stunden (0:00)', bezahlt: true },
    { label: 'Gleitzeit (1 Tag)', anzeige: '(6:00 Std.)', notiz: 'Freizeitausgleich (Zeitkonto) – nicht in der Summe', bezahlt: false },
    { label: 'Krank (1 Tag)', anzeige: '–', notiz: 'Lohnfortzahlung rechnet das Lohnbüro', bezahlt: false },
    { label: 'Abwesend (1 Tag)', anzeige: '–', notiz: 'nicht in der Summe', bezahlt: false },
  ]);
  assert.equal(summeNotiz(nachweis), '= Ist + Kunden-Anfahrt + Urlaub');
  // ohne Lücken: Urlaub „bezahlt, vom Büro eingetragen“; Gleitzeit ohne Stunden nennt die Lücke
  assert.deepEqual(abwesenheitSummen({ abwesenheiten: [
    { datum: '2026-11-14', art: 'Urlaub', min: 480 }, { datum: '2026-11-15', art: 'Gleitzeit', min: null },
    { datum: '2026-11-16', art: 'Gleitzeit', min: null },
  ] }).map((z) => [z.label, z.anzeige, z.notiz]), [
    ['Urlaub (1 Tag)', '8:00 Std.', 'bezahlt, vom Büro eingetragen'],
    ['Gleitzeit (2 Tage)', '(0:00 Std.)', 'Zeitkonto, nicht in der Summe; 2 Tage ohne Stunden (0:00)'],
  ]);
  assert.equal(summeNotiz({ abwesenheiten: [{ art: 'Krank', min: null }, { art: 'Gleitzeit', min: 60 }] }), '= Ist + Kunden-Anfahrt');
  assert.equal(summeNotiz(undefined), '= Ist + Kunden-Anfahrt');
  assert.deepEqual(abwesenheitSummen(undefined), []);
  assert.deepEqual(abwesenheitZeilen({}), []);
  assert.deepEqual(abwesenheitZeilen({ abwesenheiten: [{ datum: null, art: 'Urlaub', grund: '', von: '', bis: '', min: null }] }),
    [{ datum: '–', fenster: 'ganztägig', soll: '–', ist: '–', klient: 'Urlaub' }]);
});

const urlaub = (id, datum, extra = {}) => ({
  id, fields: { Datum: datum, Monat: datum.slice(0, 7), Status: 'Geplant', Pfleger_ID: [MA], 'Abwesend/Urlaub': 'Urlaub', ...extra },
});

test('Urlaub, Gleitzeit und Krank im Abrechnungszeitraum: nur Urlaubsstunden zählen zur Monatssumme, Krank ohne Zahl', async (t) => {
  zeit(t, AM_05_12);
  const { log } = szenario({
    monat: '2026-11',
    besuche: [
      besuch('2026-11-10', '08:00', '09:00'),
      urlaub('recUrlaubTest00001', '2026-11-09', { 'Tätigkeit': 'Urlaub', 'Stunden Urlaub/Gleitzeit': 8 * 3600 }),
      urlaub('recUrlaubTest00002', '2026-11-11', { Von: '06:00', Bis: '12:00' }),                  // Zeitfenster, keine Stunden
      urlaub('recUrlaubTest00004', '2026-11-12', { 'Abwesend/Urlaub': 'Krank', 'Stunden Urlaub/Gleitzeit': 6 * 3600 }), // Krank: nie eine Zahl
      urlaub('recUrlaubTest00006', '2026-11-16', { 'Abwesend/Urlaub': 'Gleitzeit', 'Stunden Urlaub/Gleitzeit': 6 * 3600 + 30 * 60 }),
      urlaub('recUrlaubTest00005', '2026-11-13', { Status: 'Abgesagt', 'Stunden Urlaub/Gleitzeit': 8 * 3600 }), // abgesagt: zählt nie
    ],
  });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.summe, '9:00'); // 1:00 Einsatz + 8:00 Urlaub – ohne Gleitzeit, ohne Krank
  assert.equal(res.body.einsaetze, 1);
  assert.equal(res.body.ohneIst, 0);
  assert.equal(res.body.abwesenheiten, 4);
  assert.equal(res.body.urlaubStunden, '8:00');
  assert.equal(res.body.gleitzeitStunden, '6:30');
  assert.equal(log.patches.at(-1).Summe_Stunden, '9:00');
  const texte = pdfTexte(Buffer.from(log.upload.file, 'base64'));
  const titel = texte.indexOf(ABWESENHEIT_TITEL);
  assert.ok(titel > 0, 'Liste „Urlaub / Gleitzeit / Krank / Abwesenheit“ fehlt im PDF');
  assert.deepEqual(texte.slice(titel + 1, titel + 21), [
    '09.11.2026', 'ganztägig', '–', '8:00', 'Urlaub',
    '11.11.2026', '06:00 – 12:00', '–', '–', 'Urlaub',
    '12.11.2026', 'ganztägig', '–', '–', 'Krank',
    '16.11.2026', 'ganztägig', '–', '(6:30)', 'Gleitzeit',
  ]);
  assert.ok(!texte.includes('6:00') && !texte.includes('6:00 Std.'), 'Krank darf nie eine Zahl haben');
  const pos = (label) => { const i = texte.indexOf(label); assert.ok(i > 0, `${label} fehlt`); return i; };
  const zeile = (label) => texte.slice(pos(label), pos(label) + 3);
  assert.deepEqual(zeile('Einsätze bestätigt (Ist)').slice(0, 2), ['Einsätze bestätigt (Ist)', '1:00 Std.']);
  assert.deepEqual(zeile('Urlaub (2 Tage)'), ['Urlaub (2 Tage)', '8:00 Std.', 'davon 1 Tag ohne Stunden (0:00)']);
  assert.deepEqual(zeile('Monatssumme (bezahlt)'), ['Monatssumme (bezahlt)', '9:00 Std.', '= Ist + Kunden-Anfahrt + Urlaub']);
  assert.deepEqual(zeile('Gleitzeit (1 Tag)'), ['Gleitzeit (1 Tag)', '(6:30 Std.)', 'Freizeitausgleich (Zeitkonto) – nicht in der Summe']);
  assert.deepEqual(zeile('Krank (1 Tag)'), ['Krank (1 Tag)', '–', 'Lohnfortzahlung rechnet das Lohnbüro']);
  // Reihenfolge: Urlaub vor der Monatssumme, Gleitzeit und Krank danach (nur Information), dann Pausen
  assert.ok(pos('Urlaub (2 Tage)') < pos('Monatssumme (bezahlt)'));
  assert.ok(pos('Monatssumme (bezahlt)') < pos('Gleitzeit (1 Tag)') && pos('Gleitzeit (1 Tag)') < pos('Krank (1 Tag)'));
  assert.ok(pos('Krank (1 Tag)') < pos('Pausen (unbezahlt)'));
  assert.ok(!texte.includes(NICHT_BESTAETIGT_TITEL), 'Urlaub darf nicht unter „nicht bestätigt“ stehen');
  assert.ok(texte.includes(UNTERSCHRIFT_ROLLE));
});

test('Monat nur mit Urlaub oder nur Krank: Urlaub mit Stunden wird bezahlt und unterschrieben, sonst 0:00 ohne Unterschrift', async (t) => {
  zeit(t, AM_05_12);
  const ein = (extra) => [urlaub('recUrlaubTest00003', '2026-11-16', extra)];
  const lauf = async (besuche) => {
    const s = szenario({ monat: '2026-11', besuche });
    const res = antwortObjekt();
    await handler(req(), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    return { res, s, texte: pdfTexte(Buffer.from(s.log.upload.file, 'base64')) };
  };
  // Urlaub ohne eingetragene Stunden: 0:00, Lücke sichtbar, keine Unterschrift
  let r = await lauf(ein({}));
  assert.equal(r.res.body.summe, '0:00');
  assert.equal(r.res.body.einsaetze, 0);
  assert.equal(r.res.body.abwesenheiten, 1);
  assert.ok(r.texte.includes('Keine bestätigten Einsätze in diesem Monat.'));
  assert.ok(r.texte.includes(ABWESENHEIT_TITEL));
  assert.ok(r.texte.includes('davon 1 Tag ohne Stunden (0:00)'));
  assert.ok(!r.texte.includes(UNTERSCHRIFT_ROLLE), 'nichts zu bezahlen -> keine Unterschrift');
  // Urlaub mit Stunden: bezahlt und unterschrieben
  r = await lauf(ein({ 'Stunden Urlaub/Gleitzeit': 8 * 3600 }));
  assert.equal(r.res.body.summe, '8:00');
  assert.equal(r.s.log.patches.at(-1).Summe_Stunden, '8:00');
  assert.ok(r.texte.includes('Urlaub (1 Tag)'));
  assert.ok(r.texte.includes(UNTERSCHRIFT_ROLLE), 'bezahlter Urlaub -> Zettel wird unterschrieben');
  // nur Krank (auch mit versehentlich eingetragenen Stunden): 0:00, „–“, keine Unterschrift
  r = await lauf(ein({ 'Abwesend/Urlaub': 'Krank', 'Stunden Urlaub/Gleitzeit': 8 * 3600 }));
  assert.equal(r.res.body.summe, '0:00');
  assert.ok(r.texte.includes('Krank (1 Tag)'));
  assert.ok(!r.texte.includes('8:00') && !r.texte.includes('8:00 Std.'));
  assert.ok(!r.texte.includes(UNTERSCHRIFT_ROLLE));
});

test('Erläuterung erklärt Urlaub, Gleitzeit, Krank; Texte darstellbar und passen in die Breite', async () => {
  const satz = ERLAEUTERUNG.find((z) => z.startsWith('Urlaub, Gleitzeit, Krank, Abwesenheit:'));
  assert.ok(satz, 'Erläuterung zu Urlaub/Gleitzeit/Krank fehlt');
  assert.match(satz, /Urlaub: bezahlt werden die Stunden, die das Büro einträgt – sie zählen zur Monatssumme/);
  assert.match(satz, /Gleitzeit: Freizeitausgleich aus dem Zeitkonto – die Stunden stehen in Klammern da und zählen nicht zur Monatssumme/);
  assert.match(satz, /Krank: nur der Tag \(„–“\), keine Stunden – die Lohnfortzahlung rechnet das Lohnbüro/);
  assert.ok(!ERLAEUTERUNG.some((z) => /nicht in der Monatssumme enthalten|Stunden Urlaub\/Krank/.test(z)), 'alte Regel steht noch in der Erläuterung');
  assert.equal(pdfText(ABWESENHEIT_TITEL), ABWESENHEIT_TITEL);
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  assert.ok(fett.widthOfTextAtSize(pdfText(ABWESENHEIT_TITEL), 10) <= 595.28 - 2 * 50, 'Titel zu breit');
  // Summenzeilen: Notizen rechts (ab x=312, 8 pt), Beschriftung links vor dem Betrag (rechtsbündig bei x=300)
  const viele = { abwesenheiten: ['Urlaub', 'Gleitzeit', 'Krank', 'Abwesend', 'Sonderurlaub'].flatMap((art) =>
    Array.from({ length: 31 }, (_, i) => ({ datum: `2026-12-${String(i + 1).padStart(2, '0')}`, art, min: i % 2 ? 480 : null }))) };
  const notizBreite = 595.28 - 50 - 312;
  assert.ok(normal.widthOfTextAtSize(pdfText(summeNotiz(viele)), 8) <= notizBreite, 'Summen-Notiz zu breit');
  for (const z of abwesenheitSummen(viele)) {
    assert.equal(pdfText(z.label), z.label);
    assert.equal(pdfText(z.notiz), z.notiz);
    assert.ok(normal.widthOfTextAtSize(pdfText(z.notiz), 8) <= notizBreite, `Notiz zu breit: ${z.notiz}`);
    assert.ok(normal.widthOfTextAtSize(z.label, 10) + normal.widthOfTextAtSize('(999:59 Std.)', 10) + 6 <= 300 - 50, `Beschriftung zu breit: ${z.label}`);
  }
});
