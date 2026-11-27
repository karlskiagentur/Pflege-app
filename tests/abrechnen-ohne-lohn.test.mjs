// „Abrechnen ohne Lohn“ (Spalte im Dienstplan, Wunsch Geschäftsleitung 23.11.2026):
// Ein vom Büro markierter Einsatz wird abgerechnet, ist aber keine Arbeitszeit.
// Geprüft wird die Regel in ALLEN Ausgaben (Rechenkern, Stundenzettel, Wochendienstplan aller
// Mitarbeiter, Wochenplan je Mitarbeiter, Zeiterfassung, Klienten- und Mitarbeiter-App) – und
// dass sich OHNE Haken nichts ändert. Alle Testdaten sind frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import ts from 'typescript';
import { airtableAttrappe, antwort, anfrage, antwortObjekt, pdfTexte } from './_hilfen.mjs';

process.env.STUNDENZETTEL_SECRET = 'test-secret-1234567890';
process.env.AIRTABLE_TOKEN = 'test-key';

const { ABRECHNEN_OHNE_LOHN_FELD, abrechnenOhneLohn, ohneLohnFelder } = await import('../api/_abrechnung.js');
const { berechneZeitnachweis, termin, minutenAus, hm } = await import('../api/_zeitkonto.js');
const stundenzettel = await import('../api/stundenzettel.js');
const wu = await import('../api/_wochenuebersicht.js');
const dp = await import('../api/_dienstplan.js');
const { fetchAllOptional } = await import('../api/_lib.js');
const { default: wochenuebersichtHandler } = await import('../api/wochenuebersicht.js');
const { default: dienstplanHandler } = await import('../api/dienstplan-pdf.js');
const { default: besuchDauerHandler } = await import('../api/besuch-dauer.js');
const { default: appDataHandler, NUR_MITARBEITER_FELDER, INTERNE_FELDER } = await import('../api/app-data.js');
const { default: maTermineHandler } = await import('../api/ma-termine.js');

const FELD = 'Abrechnen ohne Lohn';
const PERSONAL = 'tbl3pMfhOLYPsQ5jF';
const BESUCHE = 'tblXJOSz4LaJCG10M';
const PATIENTEN = 'tbl5uUUSgC9p10BHQ';

const ruhig = async (fn) => {
  const e = console.error; const w = console.warn;
  const meldungen = [];
  console.error = (...a) => meldungen.push(a.join(' '));
  console.warn = () => {};
  try { await fn(); } finally { console.error = e; console.warn = w; }
  return meldungen;
};

// ================================================================ Regel (api/_abrechnung.js)
test('Regel: nur das angekreuzte Feld zählt – leer, Text oder Zahl nie', () => {
  assert.equal(ABRECHNEN_OHNE_LOHN_FELD, FELD);
  assert.equal(abrechnenOhneLohn({ [FELD]: true }), true);
  // Airtable lässt ein nicht angekreuztes Feld ganz weg
  for (const f of [{}, { [FELD]: false }, { [FELD]: 'true' }, { [FELD]: 1 }, { [FELD]: 'Ja' }, { [FELD]: null }, null, undefined, 'x', 7]) {
    assert.equal(abrechnenOhneLohn(f), false, JSON.stringify(f));
  }
});

test('Regel: umbenannte Spalte mit „ohne Lohn“ im Namen gilt weiter; ähnliche Namen nicht', () => {
  for (const name of ['Berechnen ohne Lohn', 'Abrechnen ohne Lohn (Büro)', 'abrechnen_ohne_lohn', 'Ohne-Lohn', 'ohne  Lohn']) {
    assert.equal(abrechnenOhneLohn({ [name]: true }), true, name);
    assert.deepEqual(ohneLohnFelder({ [name]: false, Datum: '2026-11-20' }), [name], name);
  }
  for (const name of ['Lohnabrechnung', 'Lohn', 'ohne', 'Abrechnen', 'Stundenlohn']) {
    assert.equal(abrechnenOhneLohn({ [name]: true }), false, name);
    assert.deepEqual(ohneLohnFelder({ [name]: true }), [], name);
  }
  assert.deepEqual(ohneLohnFelder(null), []);
});

// ================================================================ Rechenkern (api/_zeitkonto.js)
let n = 0;
// bestätigter Einsatz (Ist = Zeitfenster), wie in tests/zeitkonto.test.mjs
const b = (datum, von, bis, extra = {}) => ({
  id: `recOhneLohn${String(++n).padStart(6, '0')}`,
  fields: {
    Datum: datum, Von: von, Bis: bis, Status: 'Bestätigt', Patient: ['recPatTest0000001'], Patient_Name: [`Klient ${n}`],
    Dauer_Ist: (minutenAus(bis) - minutenAus(von)) * 60,
    ...extra,
  },
});
const offen = (datum, von, bis, extra = {}) => { const r = b(datum, von, bis, extra); delete r.fields.Dauer_Ist; return r; };
const markiert = (datum, von, bis, extra = {}) => offen(datum, von, bis, { [FELD]: true, ...extra });
const ZEIT = '2026-11-23T12:00:00Z'; // "jetzt" = Mo 23.11.2026, 13:00 Uhr in Berlin
const SUMMEN_SCHLUESSEL = [
  'sollMin', 'einsatzMin', 'anfahrtMin', 'pauseMin', 'bezahltMin', 'einsaetze', 'ohneIst', 'ohneIstSollMin',
  'abwesenheitBezahltMin', 'abwesenheitZeitkontoMin', 'abwesenheitOhneStunden',
];

test('termin(): markiert nur mit Klient und Haken; ohne Klient hat der Haken keine Bedeutung', () => {
  assert.equal(termin({ Datum: '2026-11-20', Patient_Name: ['Erika Muster'], [FELD]: true }).ohneLohn, true);
  assert.equal(termin({ Datum: '2026-11-20', Patient: ['recPatTest0000001'], [FELD]: true }).ohneLohn, true);
  assert.equal(termin({ Datum: '2026-11-20', Patient_Name: ['Erika Muster'] }).ohneLohn, false);
  assert.equal(termin({ Datum: '2026-11-20', [FELD]: true }).ohneLohn, false, 'Zeile ohne Klient');
  const urlaub = termin({ Datum: '2026-11-20', 'Abwesend/Urlaub': 'Urlaub', [FELD]: true });
  assert.equal(urlaub.ohneLohn, false);
  assert.equal(urlaub.abwesenheit, 'Urlaub', 'Urlaub bleibt Urlaub');
});

test('Fall der Geschäftsleitung (20.11.): geplanter Einsatz ohne Bestätigung, markiert -> keine Arbeitszeit, nicht „nicht bestätigt“', () => {
  // Fr 20.11.: drei bestätigte Einsätze, ein nachträglich eingetragener Ersatz-Einsatz (13:30–15:00)
  // und der ursprünglich geplante (13:45–15:00), der abgerechnet wird, aber kein Lohn ist.
  const tag = [
    b('2026-11-20', '08:00', '09:00'),
    b('2026-11-20', '09:15', '11:15'),
    b('2026-11-20', '11:30', '13:30'),
    b('2026-11-20', '13:30', '15:00'),
  ];
  const geplant = markiert('2026-11-20', '13:45', '15:00', { Patient_Name: ['Otto Beispiel'], 'Tätigkeit': 'Alltagsbegleitung' });
  const ohne = berechneZeitnachweis(tag, { jetzt: ZEIT });
  const mit = berechneZeitnachweis([...tag, geplant], { jetzt: ZEIT });
  assert.deepEqual(mit.tage, ohne.tage, 'Tage unverändert');
  assert.deepEqual(mit.summen, ohne.summen, 'Summen unverändert');
  assert.equal(hm(mit.summen.bezahltMin), '7:00'); // 6:30 Einsätze + 2 x 0:15 Anfahrt
  assert.deepEqual(mit.nichtBestaetigt, [], 'steht nicht unter „nicht bestätigt“');
  assert.deepEqual(mit.ohneLohn.map((t) => [t.datum, t.von, t.bis, t.sollMin, t.klient, t.taetigkeit]), [
    ['2026-11-20', '13:45', '15:00', 75, 'Otto Beispiel', 'Alltagsbegleitung'],
  ]);
  assert.match(mit.ohneLohn[0].id, /^recOhneLohn\d{6}$/);
  // ohne Haken: derselbe Einsatz steht wie bisher unter „nicht bestätigt“
  const ohneHaken = berechneZeitnachweis([...tag, offen('2026-11-20', '13:45', '15:00')], { jetzt: ZEIT });
  assert.equal(ohneHaken.nichtBestaetigt.length, 1);
  assert.deepEqual(ohneHaken.ohneLohn, []);
});

test('Markierter Einsatz MIT eingetragener Ist-Zeit: zählt trotzdem nie, keine Anfahrt dorthin oder von dort', () => {
  const a = b('2026-11-19', '08:00', '09:00');
  const c = b('2026-11-19', '10:30', '11:30');
  const m = b('2026-11-19', '09:15', '10:15', { [FELD]: true }); // bestätigt UND markiert
  const ohne = berechneZeitnachweis([a, c], { jetzt: ZEIT });
  const mit = berechneZeitnachweis([a, m, c], { jetzt: ZEIT });
  assert.deepEqual(mit.tage, ohne.tage);
  assert.deepEqual(mit.summen, ohne.summen);
  // Lücke 09:00–10:30 = 1:30 Pause, keine Anfahrt (als gäbe es den markierten Einsatz nicht;
  // ab 1 Stunde keine Kunden-Anfahrt – Vorgabe Geschäftsleitung 27.11.2026, vorher 1:00 Pause + 0:30 Anfahrt)
  assert.deepEqual(mit.tage[0].zeilen.map((z) => `${z.art}:${z.von}-${z.bis}`),
    ['einsatz:08:00-09:00', 'pause:09:00-10:30', 'einsatz:10:30-11:30']);
  assert.equal(mit.ohneLohn.length, 1);
  // Gegenprobe ohne Haken: der Einsatz zählt und verändert die Anfahrt
  const normal = berechneZeitnachweis([a, b('2026-11-19', '09:15', '10:15'), c], { jetzt: ZEIT });
  assert.equal(normal.summen.einsaetze, 3);
  assert.equal(normal.summen.pauseMin, 0);
});

test('Markiert wirkt für Lohn exakt wie „nicht vorhanden“ (200 Zufallsszenarien)', () => {
  let seed = 20261123;
  const zufall = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 200; i++) {
    const basis = [];
    const zusatz = [];
    for (let k = 0; k < 2 + Math.floor(zufall() * 6); k++) {
      const tagNr = 16 + Math.floor(zufall() * 5);
      const start = 6 * 60 + Math.floor(zufall() * 40) * 15;
      const dauer = 15 + Math.floor(zufall() * 12) * 15;
      const von = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      const ende = Math.min(start + dauer, 22 * 60);
      const bis = `${String(Math.floor(ende / 60)).padStart(2, '0')}:${String(ende % 60).padStart(2, '0')}`;
      if (bis <= von) continue;
      const art = zufall();
      if (art < 0.5) basis.push(b(`2026-11-${tagNr}`, von, bis));
      else if (art < 0.7) basis.push(offen(`2026-11-${tagNr}`, von, bis));
      else if (art < 0.85) zusatz.push(markiert(`2026-11-${tagNr}`, von, bis));
      else zusatz.push(b(`2026-11-${tagNr}`, von, bis, { [FELD]: true })); // markiert mit Ist-Zeit
    }
    const ohne = berechneZeitnachweis(basis, { jetzt: ZEIT });
    const mit = berechneZeitnachweis([...zusatz, ...basis], { jetzt: ZEIT });
    assert.deepEqual(mit.tage, ohne.tage, `Szenario ${i}: Tage`);
    assert.deepEqual(mit.summen, ohne.summen, `Szenario ${i}: Summen`);
    assert.deepEqual(mit.nichtBestaetigt, ohne.nichtBestaetigt, `Szenario ${i}: nicht bestätigt`);
    assert.equal(mit.ohneLohn.length, zusatz.length, `Szenario ${i}: Liste`);
  }
});

test('„Abgesagt“ geht vor; künftige Einsätze fehlen; Liste über Tage sortiert', () => {
  const r = berechneZeitnachweis([
    markiert('2026-11-20', '14:00', '15:00'),
    markiert('2026-11-18', '09:00', '10:00'),
    markiert('2026-11-18', '07:00', '07:30'),
    markiert('2026-11-19', '08:00', '09:00', { Status: 'Abgesagt' }),
    markiert('2026-11-24', '08:00', '09:00'),                    // morgen
    markiert('2026-11-23', '14:00', '15:00'),                    // heute, noch nicht vorbei
  ], { jetzt: ZEIT });
  assert.deepEqual(r.ohneLohn.map((t) => `${t.datum} ${t.von}`), ['2026-11-18 07:00', '2026-11-18 09:00', '2026-11-20 14:00']);
  assert.deepEqual(r.ausgelassen, { abgesagt: 1, zukunft: 2 });
  assert.deepEqual(r.tage, []);
});

test('Nichts Bestehendes verändert: Aufbau der Summen bleibt, ohne Haken ist die Liste leer', () => {
  const r = berechneZeitnachweis([b('2026-11-18', '08:00', '09:00'), offen('2026-11-18', '10:00', '11:00')], { jetzt: ZEIT });
  assert.deepEqual(Object.keys(r.summen), SUMMEN_SCHLUESSEL);
  assert.deepEqual(Object.keys(r.ausgelassen), ['abgesagt', 'zukunft']);
  assert.deepEqual(r.ohneLohn, []);
  assert.deepEqual(berechneZeitnachweis([], { jetzt: ZEIT }).ohneLohn, []);
  assert.deepEqual(berechneZeitnachweis(undefined, { jetzt: ZEIT }).ohneLohn, []);
});

// ================================================================ Stundenzettel (api/stundenzettel.js)
const zettelPdf = (besuche, final = true) => stundenzettel.erstellePdf({
  maName: 'Anna B.', maNr: 90001, monat: '2026-11', nachweis: berechneZeitnachweis(besuche, { jetzt: '2026-11-27T04:00:00Z' }), final,
});

test('Stundenzettel: Zeilen, Hinweis und Erläuterung nur mit markierten Einsätzen', () => {
  const nachweis = berechneZeitnachweis([
    b('2026-11-20', '08:00', '09:00'),
    markiert('2026-11-20', '13:45', '15:00', { Patient_Name: ['Otto Beispiel'] }),
    markiert('2026-11-21', '10:00', '12:30', { Patient_Name: ['Lina Probe'] }),
  ], { jetzt: ZEIT });
  assert.deepEqual(stundenzettel.ohneLohnZeilen(nachweis), [
    { datum: '20.11.2026', fenster: '13:45 – 15:00', soll: '1:15', ist: '–', klient: 'Otto Beispiel' },
    { datum: '21.11.2026', fenster: '10:00 – 12:30', soll: '2:30', ist: '–', klient: 'Lina Probe' },
  ]);
  assert.equal(stundenzettel.ohneLohnText(nachweis), 'Ohne Arbeitszeit (vom Büro eingetragen): 2 Einsätze, geplant 3:45 Std. – nicht in der Summe.');
  assert.equal(stundenzettel.ohneLohnText({ ohneLohn: [{ sollMin: 75 }] }), 'Ohne Arbeitszeit (vom Büro eingetragen): 1 Einsatz, geplant 1:15 Std. – nicht in der Summe.');
  assert.deepEqual(stundenzettel.erlaeuterungFuer(nachweis), [...stundenzettel.ERLAEUTERUNG, stundenzettel.OHNE_LOHN_ERLAEUTERUNG]);
  // ohne markierte Einsätze: nichts davon
  for (const leer of [undefined, {}, { ohneLohn: [] }]) {
    assert.deepEqual(stundenzettel.ohneLohnZeilen(leer), []);
    assert.equal(stundenzettel.ohneLohnText(leer), '');
    assert.equal(stundenzettel.erlaeuterungFuer(leer), stundenzettel.ERLAEUTERUNG, 'Erläuterung unverändert (dasselbe Array)');
  }
  assert.deepEqual(stundenzettel.ohneLohnZeilen({ ohneLohn: [{ datum: null, von: '', bis: '', sollMin: null, klient: '' }] }), [
    { datum: '–', fenster: '–', soll: '–', ist: '–', klient: '–' },
  ]);
});

test('Stundenzettel-PDF: eigener Abschnitt, Summe unverändert; für die Mitarbeiterin neutral formuliert', async () => {
  const tag = [b('2026-11-20', '08:00', '09:00'), b('2026-11-20', '09:15', '11:15')];
  const geplant = markiert('2026-11-20', '13:45', '15:00', { Patient_Name: ['Otto Beispiel'] });
  const ohne = pdfTexte(await zettelPdf(tag));
  const mit = pdfTexte(await zettelPdf([...tag, geplant]));
  assert.ok(mit.includes(stundenzettel.OHNE_LOHN_TITEL));
  assert.ok(mit.includes('Otto Beispiel'));
  assert.ok(mit.includes('Ohne Arbeitszeit (vom Büro eingetragen): 1 Einsatz, geplant 1:15 Std. – nicht in der Summe.'));
  assert.ok(mit.join(' ').includes('Stimmt das bei einem Einsatz nicht, bitte beim Büro melden.'));
  assert.ok(!mit.includes(stundenzettel.NICHT_BESTAETIGT_TITEL), 'nicht unter „nicht bestätigt“');
  // Monatssumme identisch: 3:00 Einsätze + 0:15 Anfahrt
  const summe = (texte) => texte[texte.indexOf('Monatssumme (bezahlt)') + 1];
  assert.equal(summe(mit), '3:15 Std.');
  assert.equal(summe(mit), summe(ohne));
  // Der Zettel der Mitarbeiterin nennt weder Lohn noch Abrechnung mit dem Klienten
  const neu = mit.filter((t) => !ohne.includes(t)).join(' ');
  assert.ok(!/Lohn|abgerechnet|berechnet|Rechnung/i.test(neu), `neutraler Text erwartet: ${neu}`);
  // ohne markierten Einsatz: kein Wort davon – der Zettel bleibt, wie er war
  assert.ok(!ohne.join(' ').includes('Ohne Arbeitszeit'));
  assert.ok(!ohne.includes(stundenzettel.OHNE_LOHN_TITEL));
});

test('Stundenzettel-PDF ohne Haken: inhaltsgleich mit dem bisherigen Aufbau (Nachweis ohne das neue Feld)', async () => {
  const besuche = [
    b('2026-11-18', '08:00', '09:00'), b('2026-11-18', '09:30', '10:30'), offen('2026-11-19', '08:00', '09:00'),
    { id: 'recUrlaubTest0001', fields: { Datum: '2026-11-17', Status: 'Bestätigt', 'Abwesend/Urlaub': 'Urlaub', 'Stunden Urlaub/Gleitzeit': 28800 } },
  ];
  const nachweis = berechneZeitnachweis(besuche, { jetzt: '2026-11-27T04:00:00Z' });
  const alt = { ...nachweis };
  delete alt.ohneLohn; // Aufbau vor der Erweiterung
  const args = { maName: 'Anna B.', maNr: 90001, monat: '2026-11', final: true };
  assert.deepEqual(pdfTexte(await stundenzettel.erstellePdf({ ...args, nachweis })), pdfTexte(await stundenzettel.erstellePdf({ ...args, nachweis: alt })));
});

test('Monat nur mit markierten Einsätzen: 0:00, keine Unterschrift, kein „keine vergangenen Einsätze“', async () => {
  const texte = pdfTexte(await zettelPdf([markiert('2026-11-20', '13:45', '15:00')]));
  assert.ok(texte.includes('Keine bestätigten Einsätze in diesem Monat.'));
  assert.ok(!texte.includes('Keine vergangenen Einsätze in diesem Monat.'));
  assert.equal(texte[texte.indexOf('Monatssumme (bezahlt)') + 1], '0:00 Std.');
  assert.ok(!texte.includes(stundenzettel.UNTERSCHRIFT_ROLLE), 'keine Unterschrift ohne bezahlte Zeit');
});

test('Stundenzettel: neue Texte darstellbar und passen in die Breite; lange Liste läuft über Seiten', async () => {
  const { pdfText, OHNE_LOHN_TITEL, OHNE_LOHN_ERLAEUTERUNG, ohneLohnText } = stundenzettel;
  for (const satz of [OHNE_LOHN_TITEL, OHNE_LOHN_ERLAEUTERUNG, ohneLohnText({ ohneLohn: [{ sollMin: 60 }] })]) assert.equal(pdfText(satz), satz);
  assert.ok(!OHNE_LOHN_ERLAEUTERUNG.includes('*'));
  assert.ok(OHNE_LOHN_ERLAEUTERUNG.includes(`„${OHNE_LOHN_TITEL}“`));
  const doc = await PDFDocument.create();
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const breite = 595.28 - 2 * 50;
  const viele = { ohneLohn: Array.from({ length: 999 }, () => ({ sollMin: 6 * 60 })) }; // 5994:00 Std.
  assert.ok(fett.widthOfTextAtSize(pdfText(ohneLohnText(viele)), 9) <= breite, 'Hinweis im Summenblock zu breit');
  assert.ok(fett.widthOfTextAtSize(pdfText(OHNE_LOHN_TITEL), 10) <= breite);
  // 120 markierte Einsätze: mehrere Seiten, jede Zeile genau einmal
  const besuche = Array.from({ length: 120 }, (_, i) => markiert(`2026-11-${String(1 + (i % 26)).padStart(2, '0')}`, '08:00', '09:00', { Patient_Name: [`Klient Nr${i}X`] }));
  const bytes = await zettelPdf(besuche);
  const texte = pdfTexte(bytes);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 3);
  for (let i = 0; i < 120; i++) assert.equal(texte.filter((t) => t === `Klient Nr${i}X`).length, 1, `Zeile ${i}`);
});

test('Stundenzettel-Endpoint: Antwort nennt die Zahl, Summe ohne den markierten Einsatz', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-05T10:00:00Z') });
  const ZETTEL = 'tblmlg9ZNrtwRxmXx';
  const MA = 'recMaTestXXXXXXX1';
  const REC = 'recZettelTest0001';
  const mitMa = (r) => ({ ...r, fields: { ...r.fields, Monat: r.fields.Datum.slice(0, 7), Pfleger_ID: [MA] } });
  let upload = null;
  const patches = [];
  airtableAttrappe(async (a) => {
    if (a.host === 'content.airtable.com') { upload = a.body; return antwort(200, { id: REC }); }
    if (a.tabelle === ZETTEL && a.methode === 'GET') return antwort(200, { id: REC, fields: { Mitarbeiter: [MA], Monat_Auswahl: 'November 2026' } });
    if (a.tabelle === ZETTEL && a.methode === 'PATCH') { patches.push(a.body.fields); return antwort(200, {}); }
    if (a.tabelle === PERSONAL) return antwort(200, { id: MA, fields: { Name: 'Anna B.', Anmelde_ID: 90001 } });
    if (a.tabelle === BESUCHE) {
      return antwort(200, { records: [
        mitMa(b('2026-11-20', '08:00', '09:00')),
        mitMa(markiert('2026-11-20', '13:45', '15:00')),
        mitMa(b('2026-11-21', '08:00', '10:00', { [FELD]: true })), // bestätigt, aber markiert: zählt nicht
      ] });
    }
    return antwort(404, {});
  });
  const res = antwortObjekt();
  await stundenzettel.default({ method: 'POST', headers: { 'x-hook-secret': process.env.STUNDENZETTEL_SECRET }, body: { recordId: REC } }, res);
  t.mock.timers.reset();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summe, '1:00');
  assert.equal(res.body.einsaetze, 1);
  assert.equal(res.body.ohneLohn, 2);
  assert.equal(res.body.ohneIst, 0);
  assert.equal(patches[0].Summe_Stunden, '1:00');
  assert.equal(upload.filename, 'Stundenzettel_2026-11_final.pdf');
});

// ================================================================ Wochendienstplan aller Mitarbeiter
const BEREICH = dp.wocheZuDatum('2026-11-20'); // KW 47: Mo 16.11. – So 22.11.2026
const NACH_DER_WOCHE = Date.parse('2026-11-23T12:00:00+01:00');
const ma = (id, name) => ({ id, fields: { Name: name, Aktiv: true } });
const TEAM = [ma('recMA00000000001', 'Anna B.'), ma('recMA00000000002', 'Carl D.')];
const wb = (id, felder, maId = 'recMA00000000001') => ({ id, fields: { Pfleger_ID: [maId], Patient_Name: 'Erika Muster', ...felder } });

test('Wochendienstplan: markiert = geklärt (nicht „offen“), geplante Zeit mit *, nicht in der Summe', () => {
  const d = wu.baueWoche([
    wb('rec1', { Datum: '2026-11-20', Von: '13:30', Bis: '15:00', Dauer_Ist: 5400 }),
    wb('rec2', { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', [FELD]: true }),                   // Fall der Geschäftsleitung
    wb('rec3', { Datum: '2026-11-19', Von: '08:00', Bis: '10:00', Dauer_Ist: 7200, [FELD]: true }),   // mit Ist-Zeit: trotzdem keine Arbeitszeit
    wb('rec4', { Datum: '2026-11-18', Von: '08:00', Bis: '09:00', [FELD]: true, Status: 'Abgesagt' }),
    wb('rec5', { Datum: '2026-11-17', Von: '08:00', Bis: '09:00', [FELD]: true, Hervorhebung: 'Storniert' }),
    wb('rec6', { Datum: '2026-11-16', Von: '08:00', Bis: '09:00' }),                                   // ohne Haken: offen wie bisher
  ], TEAM, BEREICH, NACH_DER_WOCHE);
  const sp = d.mitarbeiter[0];
  const status = (iso) => sp.tage[iso].map((e) => e.status);
  assert.deepEqual(status('2026-11-20'), ['bestaetigt', 'ohneLohn']);
  assert.deepEqual(status('2026-11-19'), ['ohneLohn']);
  assert.deepEqual(status('2026-11-18'), ['abgesagt'], 'Abgesagt geht vor');
  assert.deepEqual(status('2026-11-17'), ['abgesagt'], 'Storniert geht vor');
  assert.deepEqual(status('2026-11-16'), ['offen']);
  // Summe der Mitarbeiterin: nur der bestätigte Einsatz ohne Haken; offen nur der ohne Haken
  assert.deepEqual(wu.summen(sp), { min: 90, offen: 1 });
  const geplant = sp.tage['2026-11-20'][1];
  assert.equal(wu.ohneLohnAnzeige(geplant), '1,25*');
  assert.equal(wu.ohneLohnAnzeige({ planMin: null }), '*');
  assert.equal(wu.ohneLohnAnzeige({ planMin: 120 }), '2*');
});

test('Wochendienstplan: im Voraus markiert (künftiger Einsatz) steht schon als geklärt da', () => {
  const vorher = Date.parse('2026-11-16T07:00:00+01:00');
  const d = wu.baueWoche([
    wb('rec1', { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', [FELD]: true }),
    wb('rec2', { Datum: '2026-11-20', Von: '08:00', Bis: '09:00' }),
  ], TEAM, BEREICH, vorher);
  assert.deepEqual(d.mitarbeiter[0].tage['2026-11-20'].map((e) => e.status), ['geplant', 'ohneLohn']);
});

test('Wochendienstplan-PDF: „1,25*“ am Einsatz; Legende nur auf Seiten mit markiertem Einsatz', async () => {
  const personal = Array.from({ length: 5 }, (_, i) => ma(`recMA0000000001${i}`, `Test ${i} M.`));
  const besuche = personal.map((p, i) => wb(`recB${i}`, { Datum: '2026-11-18', Von: '08:00', Bis: '09:30', Dauer_Ist: 5400, Patient_Name: `Klient ${i}` }, p.id));
  // nur der 5. Mitarbeiter (Seite 2) hat einen markierten Einsatz
  besuche.push(wb('recBX', { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', Patient_Name: 'Otto Beispiel', [FELD]: true }, personal[4].id));
  const d = wu.baueWoche(besuche, personal, BEREICH, NACH_DER_WOCHE);
  const bytes = await wu.erstelleWochenuebersichtPdf({ ...d, stand: '23.11.2026, 12:48' });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  const texte = pdfTexte(bytes);
  assert.ok(texte.includes('Otto Beispiel 13.45–15.00'));
  assert.ok(texte.includes('1,25*'));
  assert.ok(!texte.includes('offen'), 'der markierte Einsatz steht nicht als „offen“ da');
  // Seite 1 ohne Zusatz (Legende wie bisher), Seite 2 mit Zusatz
  assert.equal(texte.filter((t) => t === wu.LEGENDE).length, 1);
  assert.equal(texte.filter((t) => t === wu.LEGENDE + wu.LEGENDE_OHNE_LOHN).length, 1);
  assert.equal(wu.hatOhneLohn(d.mitarbeiter.slice(0, 4)), false);
  assert.equal(wu.hatOhneLohn(d.mitarbeiter.slice(4)), true);
  assert.equal(wu.hatOhneLohn([]), false);
  // Summe der Mitarbeiterin unverändert: 1,5 Std. bestätigt
  assert.equal(texte.filter((t) => t === '1,5 Std. bestätigt').length, 5);
});

test('Wochendienstplan-PDF ohne Haken: Legende wörtlich wie bisher, kein *', async () => {
  const d = wu.baueWoche([
    wb('rec1', { Datum: '2026-11-18', Von: '08:00', Bis: '09:30', Dauer_Ist: 5400 }),
    wb('rec2', { Datum: '2026-11-19', Von: '08:00', Bis: '09:00' }),
  ], TEAM, BEREICH, NACH_DER_WOCHE);
  const texte = pdfTexte(await wu.erstelleWochenuebersichtPdf({ ...d, stand: 'x' }));
  assert.equal(wu.LEGENDE, 'Zahl rechts = bestätigte Ist-Zeit in Stunden  ·  offen = nicht bestätigt, zählt nicht  ·  durchgestrichen = abgesagt  ·  gelb = Zusatz/Änderung des Büros');
  assert.ok(texte.includes(wu.LEGENDE));
  assert.ok(!texte.some((t) => t.includes('*')));
  assert.ok(!texte.some((t) => /ohne Lohn/i.test(t)));
});

test('Wochendienstplan: Legende mit Zusatz passt links neben das Logo', async () => {
  const { LOGO_BREITE, LOGO_HOEHE } = await import('../api/_logo.js');
  const { pdfText } = await import('../api/_pdftext.js');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const W = 841.89, M = 26;
  const frei = W - 2 * M - 16 * (LOGO_BREITE / LOGO_HOEHE) - 6;
  const text = wu.LEGENDE + wu.LEGENDE_OHNE_LOHN;
  assert.equal(pdfText(text), text, 'darstellbar');
  assert.ok(font.widthOfTextAtSize(text, 7.5) <= frei, `Legende ${font.widthOfTextAtSize(text, 7.5).toFixed(1)} > ${frei.toFixed(1)}`);
  assert.match(wu.LEGENDE_OHNE_LOHN, /Abrechnen ohne Lohn/);
});

// ---------------------------------------------------------------- Endpoint /api/wochenuebersicht
const REC_WOCHE = 'recWoche0000000001';
const wocheReq = () => ({ method: 'POST', headers: { 'x-hook-secret': process.env.STUNDENZETTEL_SECRET }, body: { recordId: REC_WOCHE } });
function wocheAttrappe(besucheAntwort) {
  const log = { besuche: [], upload: null };
  airtableAttrappe((a) => {
    if (a.host === 'content.airtable.com') { log.upload = a.body; return antwort(200, { fields: { Datei: [{ id: 'att1' }] } }); }
    if (a.tabelle === 'Wochendienstplan' && a.methode === 'GET') return antwort(200, { id: REC_WOCHE, fields: { Woche: '2026-11-20' } });
    if (a.tabelle === 'Wochendienstplan') return antwort(200, {});
    if (a.tabelle === BESUCHE) { log.besuche.push(a.url.searchParams.getAll('fields[]')); return besucheAntwort(log.besuche.length); }
    if (a.tabelle === PERSONAL) return antwort(200, { records: TEAM });
    return antwort(200, {});
  });
  return log;
}
const EIN_BESUCH = { records: [wb('rec11', { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', [FELD]: true })] };

test('Endpoint Wochendienstplan: fragt die Spalte mit ab (eine Abfrage)', async () => {
  const log = wocheAttrappe(() => antwort(200, EIN_BESUCH));
  const res = antwortObjekt();
  await wochenuebersichtHandler(wocheReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(log.besuche.length, 1);
  assert.ok(log.besuche[0].includes(FELD));
  for (const f of ['Datum', 'Von', 'Bis', 'Patient_Name', 'Pfleger_ID', 'Dauer_Ist', 'Ist_Stunden_Monat', 'Abwesend/Urlaub']) assert.ok(log.besuche[0].includes(f), f);
  assert.ok(log.upload, 'PDF hochgeladen');
});

test('Endpoint Wochendienstplan: Spalte umbenannt/gelöscht (422) -> Blatt entsteht trotzdem, Alarm', async () => {
  const log = wocheAttrappe((nr) => (nr === 1 ? antwort(422, { error: { type: 'UNKNOWN_FIELD_NAME' } }) : antwort(200, EIN_BESUCH)));
  const res = antwortObjekt();
  const meldungen = await ruhig(() => wochenuebersichtHandler(wocheReq(), res));
  assert.equal(res.statusCode, 200);
  assert.equal(log.besuche.length, 2);
  assert.ok(log.besuche[0].includes(FELD));
  assert.ok(!log.besuche[1].includes(FELD), 'zweite Abfrage ohne die optionale Spalte');
  assert.deepEqual(log.besuche[1], log.besuche[0].filter((f) => f !== FELD), 'sonst dieselben Felder');
  assert.ok(log.upload, 'PDF trotzdem hochgeladen');
  assert.ok(meldungen.some((m) => m.includes('[ALERT]') && m.includes('api/wochenuebersicht') && m.includes(FELD)), 'Alarm fehlt');
});

test('Endpoint Wochendienstplan: andere Fehler werden nicht verschluckt (Status „Fehler“)', async () => {
  for (const status of [500, 429]) {
    const log = wocheAttrappe(() => antwort(status, {}));
    const res = antwortObjekt();
    await ruhig(() => wochenuebersichtHandler(wocheReq(), res));
    assert.equal(res.statusCode, status === 429 ? 503 : 500);
    assert.equal(log.besuche.length, 1, 'kein zweiter Versuch');
    assert.equal(log.upload, null);
  }
  // auch die Abfrage ohne die Spalte scheitert mit 422 (z. B. Formel abgelehnt) -> Fehlerpfad
  const log = wocheAttrappe(() => antwort(422, {}));
  const res = antwortObjekt();
  await ruhig(() => wochenuebersichtHandler(wocheReq(), res));
  assert.equal(res.statusCode, 500);
  assert.equal(log.besuche.length, 2);
});

// ================================================================ fetchAllOptional (api/_lib.js)
test('fetchAllOptional: ohne optionale Felder eine Abfrage; 422 nur einmal wiederholt; Seitenweise', async () => {
  const anfragen = [];
  airtableAttrappe((a) => {
    anfragen.push({ felder: a.url.searchParams.getAll('fields[]'), formel: a.formel, offset: a.url.searchParams.get('offset') });
    if (anfragen.length === 1) return antwort(200, { records: [{ id: 'rec1' }], offset: 'seite2' });
    return antwort(200, { records: [{ id: 'rec2' }] });
  });
  const alle = await fetchAllOptional(BESUCHE, 'filterByFormula=1', ['Datum', 'Von'], ['Neu'], 'test');
  assert.deepEqual(alle.map((r) => r.id), ['rec1', 'rec2']);
  assert.deepEqual(anfragen[0].felder, ['Datum', 'Von', 'Neu'], 'erst Pflicht, dann optional');
  assert.equal(anfragen[1].offset, 'seite2');
  assert.equal(anfragen[0].formel, '1');

  anfragen.length = 0;
  airtableAttrappe((a) => { anfragen.push(a.url.searchParams.getAll('fields[]')); return antwort(200, { records: [] }); });
  await fetchAllOptional(BESUCHE, 'filterByFormula=1', ['Datum'], [], 'test');
  await fetchAllOptional(BESUCHE, 'filterByFormula=1', ['Datum'], undefined, 'test');
  assert.deepEqual(anfragen, [['Datum'], ['Datum']]);
});

// ================================================================ Wochenplan je Mitarbeiter (api/_dienstplan.js)
const BISHERIGE_FELDER = [
  'Datum', 'Uhrzeit', 'Von', 'Bis', 'Dauer_Soll', 'Status', 'Patient', 'Patient_Name', 'Tätigkeit',
  'Adresse_Klient', 'Hervorhebung', 'Pfleger_Ersatz_Name', 'Abwesend/Urlaub', 'Stunden Urlaub/Gleitzeit',
];
const pb = (id, fields) => ({ id, fields: { Status: 'Bestätigt', Patient: ['recPatTest0000001'], Patient_Name: ['Erika Musterfrau'], ...fields } });

test('Wochenplan je Mitarbeiter: Spalte ist optional und steht am Ende; Pflichtfelder wie bisher', () => {
  assert.deepEqual(dp.BESUCHE_PFLICHTFELDER, BISHERIGE_FELDER);
  assert.deepEqual(dp.BESUCHE_FELDER_OPTIONAL, [FELD]);
  assert.deepEqual(dp.BESUCHE_FELDER, [...BISHERIGE_FELDER, FELD]);
});

test('Wochenplan je Mitarbeiter: Einsatz bleibt im Plan und in der geplanten Zeit, Hinweis „Ohne Zeiterfassung“', () => {
  const felder = { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', 'Tätigkeit': 'Alltagsbegleitung' };
  const normal = dp.wochenplan([pb('recA', felder), pb('recB', { Datum: '2026-11-20', Von: '13:30', Bis: '15:00' })], BEREICH);
  const mit = dp.wochenplan([pb('recA', { ...felder, [FELD]: true }), pb('recB', { Datum: '2026-11-20', Von: '13:30', Bis: '15:00' })], BEREICH);
  // Zahlen identisch: der Einsatz ist verplant und wird abgerechnet
  assert.deepEqual(mit.summen, normal.summen);
  assert.equal(mit.summen.einsaetze, 2);
  assert.equal(mit.summen.planMin, 165);
  const [ersatz, geplant] = mit.tage[4].eintraege; // Freitag, sortiert nach Beginn
  assert.equal(ersatz.id, 'recB');
  assert.equal('ohneLohn' in ersatz, false, 'Einträge ohne Haken behalten ihren Aufbau');
  assert.deepEqual(ersatz, normal.tage[4].eintraege[0]);
  assert.equal(geplant.ohneLohn, true);
  assert.deepEqual(geplant.hinweise, [{ text: 'Ohne Zeiterfassung', art: 'ohnelohn' }]);
  assert.equal(dp.OHNE_LOHN_HINWEIS, 'Ohne Zeiterfassung');
  assert.equal(dp.ohneLohnNotiz(mit), 'Ohne Zeiterfassung: Fr 20.11. 13:45 – 15:00 – vom Büro so eingetragen, keine Arbeitszeit.');
  assert.equal(dp.ohneLohnNotiz(normal), '');
  assert.equal(dp.ohneLohnNotiz(undefined), '');
});

test('Wochenplan je Mitarbeiter: abgesagt geht vor; mehrere markierte Einsätze in der Notiz', () => {
  const plan = dp.wochenplan([
    pb('recA', { Datum: '2026-11-16', Von: '08:00', Bis: '09:00', [FELD]: true }),
    pb('recB', { Datum: '2026-11-18', Von: '10:00', Bis: '11:30', [FELD]: true, Hervorhebung: 'Neu' }),
    pb('recC', { Datum: '2026-11-19', Von: '08:00', Bis: '09:00', [FELD]: true, Status: 'Abgesagt' }),
  ], BEREICH);
  assert.equal(dp.ohneLohnNotiz(plan), 'Ohne Zeiterfassung: Mo 16.11. 08:00 – 09:00, Mi 18.11. 10:00 – 11:30 – vom Büro so eingetragen, keine Arbeitszeit.');
  const abgesagt = plan.tage[3].eintraege[0];
  assert.equal('ohneLohn' in abgesagt, false);
  assert.deepEqual(abgesagt.hinweise, [{ text: 'Abgesagt', art: 'abgesagt' }]);
  assert.deepEqual(plan.tage[2].eintraege[0].hinweise.map((h) => h.text), ['Neu', 'Ohne Zeiterfassung']);
  assert.equal(plan.summen.abgesagt, 1);
});

test('Wochenplan-PDF je Mitarbeiter: Hinweis und Notiz nur mit markiertem Einsatz; Legende unverändert', async () => {
  const jetzt = Date.parse('2026-11-16T07:00:00+01:00');
  const felder = { Datum: '2026-11-20', Von: '13:45', Bis: '15:00' };
  const ohne = pdfTexte(await dp.erstelleDienstplanPdf({ maName: 'Anna B.', bereich: BEREICH, plan: dp.wochenplan([pb('recA', felder)], BEREICH), jetzt }));
  const mit = pdfTexte(await dp.erstelleDienstplanPdf({ maName: 'Anna B.', bereich: BEREICH, plan: dp.wochenplan([pb('recA', { ...felder, [FELD]: true })], BEREICH), jetzt }));
  assert.ok(mit.includes('Ohne Zeiterfassung'));
  assert.ok(mit.join(' ').includes('Ohne Zeiterfassung: Fr 20.11. 13:45 – 15:00 – vom Büro so eingetragen, keine Arbeitszeit.'));
  assert.ok(!ohne.join(' ').includes('Ohne Zeiterfassung'));
  // alles andere ist gleich: der Plan ohne Haken enthält genau die Texte des Plans mit Haken minus Hinweis/Notiz
  assert.deepEqual(mit.filter((t) => !t.includes('Ohne Zeiterfassung')), ohne);
  assert.equal(dp.LEGENDE.length, 3);
  assert.ok(!/Lohn|abgerechnet|berechnet/i.test(mit.filter((t) => !ohne.includes(t)).join(' ')), 'für die Mitarbeiterin neutral formuliert');
});

// ---------------------------------------------------------------- Endpoint /api/dienstplan-pdf
const MA_PLAN = 'recMaPlanTest0001';
const SCHLUESSEL = 'AbCdEfGhIjKlMnOpQrStUvWxYz012_-9';
function planAttrappe(besucheAntwort) {
  const log = { besuche: [] };
  airtableAttrappe((a) => {
    if (a.tabelle === PERSONAL) {
      return antwort(200, { records: [{ id: MA_PLAN, fields: { [dp.PERSONAL_FELDER.NAME]: 'Anna B.', [dp.PERSONAL_FELDER.AKTIV]: true, [dp.PERSONAL_FELDER.SCHLUESSEL]: SCHLUESSEL } }] });
    }
    if (a.tabelle === BESUCHE) { log.besuche.push(a.url.searchParams.getAll('fields[]')); return besucheAntwort(log.besuche.length); }
    return antwort(404, {});
  });
  return log;
}

test('Endpoint Wochenplan je Mitarbeiter: Spalte fehlt in Airtable (422) -> Plan entsteht trotzdem, Alarm', async () => {
  const log = planAttrappe((nr) => (nr === 1 ? antwort(422, { error: { type: 'UNKNOWN_FIELD_NAME' } }) : antwort(200, { records: [] })));
  const res = antwortObjekt();
  const meldungen = await ruhig(() => dienstplanHandler({ method: 'GET', headers: {}, query: { ma: MA_PLAN, t: SCHLUESSEL } }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.deepEqual(log.besuche, [dp.BESUCHE_FELDER, dp.BESUCHE_PFLICHTFELDER]);
  assert.ok(meldungen.some((m) => m.includes('[ALERT]') && m.includes('api/dienstplan-pdf')), 'Alarm fehlt');
});

// ================================================================ Zeiterfassung (/api/besuch-dauer)
const TOKEN = 'MaToken_abcdefghijklmnopqrstuvwxyz012345';
const MA_ID = 'recPflTest0000001';
const ANDERE = 'recPflTest0000002';
const BESUCH_ID = 'recBesTest0000001';
function dauerAttrappe(felder) {
  const log = { patches: [] };
  airtableAttrappe(async (a) => {
    if (a.tabelle === PERSONAL) {
      return antwort(200, { records: a.formel.includes(TOKEN) ? [{ id: MA_ID, fields: { Name: 'Anna Beispiel', Aktiv: true } }] : [] });
    }
    if (a.tabelle === BESUCHE && a.methode === 'GET') return antwort(200, { id: BESUCH_ID, fields: felder });
    if (a.tabelle === BESUCHE && a.methode === 'PATCH') { log.patches.push(a.body.fields); return antwort(200, { id: BESUCH_ID, fields: {} }); }
    return antwort(404, {});
  });
  return log;
}
const erfassen = async (minuten = 75) => {
  const res = antwortObjekt();
  await besuchDauerHandler(anfrage({ method: 'POST', token: TOKEN, body: { besuchId: BESUCH_ID, minuten } }), res);
  return res;
};
const EINSATZ = { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', Pfleger: [MA_ID], Patient: ['recPatTest0000001'], Patient_Name: ['Otto Beispiel'] };

test('Zeiterfassung: markierter Einsatz -> 409, nichts wird geschrieben', async () => {
  let log = dauerAttrappe({ ...EINSATZ, [FELD]: true });
  let res = await erfassen(75);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'ohne_zeiterfassung');
  assert.ok(!/Lohn/i.test(JSON.stringify(res.body)), 'neutrale Meldung an die Mitarbeiterin');
  assert.equal(log.patches.length, 0);
  // auch mit schon eingetragener Zeit: derselbe Grund
  log = dauerAttrappe({ ...EINSATZ, [FELD]: true, Dauer_Ist: 4500, Erledigt_Am: '2026-11-20T14:05:00.000Z' });
  res = await erfassen(75);
  assert.equal(res.body.error, 'ohne_zeiterfassung');
  assert.equal(log.patches.length, 0);
  // als Vertretung genauso
  log = dauerAttrappe({ ...EINSATZ, Pfleger: [ANDERE], Pfleger_Ersatz: [MA_ID], [FELD]: true });
  assert.equal((await erfassen(75)).statusCode, 409);
});

test('Zeiterfassung: ohne Haken wie bisher; fremder markierter Einsatz 403 vor jeder Auskunft', async () => {
  let log = dauerAttrappe(EINSATZ);
  let res = await erfassen(75);
  assert.equal(res.statusCode, 200);
  assert.equal(log.patches[0].Dauer_Ist, 4500);
  log = dauerAttrappe({ ...EINSATZ, [FELD]: false });
  assert.equal((await erfassen(75)).statusCode, 200);
  log = dauerAttrappe({ ...EINSATZ, Pfleger: [ANDERE], [FELD]: true });
  res = await erfassen(75);
  assert.equal(res.statusCode, 403);
  assert.equal(log.patches.length, 0);
  // Urlaubszeile ohne Klient mit Haken: bleibt die Abwesenheits-Meldung
  log = dauerAttrappe({ Datum: '2026-11-20', Pfleger: [MA_ID], 'Abwesend/Urlaub': 'Urlaub', [FELD]: true });
  res = await erfassen(60);
  assert.equal(res.body.error, 'abwesenheit');
});

// ================================================================ Klienten-App (/api/app-data)
const KLIENT_TOKEN = 'KlientToken_abcdefghijklmnopqrstuvwxyz0123';
test('Klienten-App: die Markierung geht nie an Klienten – auch nicht umbenannt; alles andere bleibt', async () => {
  const besuch = { id: 'recBesuchTest0001', fields: {
    Datum: '2026-11-20', Von: '13:45', Bis: '15:00', 'Tätigkeit': 'Alltagsbegleitung', Status: 'Bestätigt',
    Pfleger_Name: ['Anna B.'], [FELD]: true, 'Berechnen ohne Lohn (alt)': true,
  } };
  airtableAttrappe(async (a) => {
    if (a.tabelle === PATIENTEN && a.methode === 'GET') {
      return antwort(200, { records: [{ id: 'recPatientTest001', fields: { Name: 'Otto Beispiel', Zuletzt_aktiv: new Date().toISOString() } }] });
    }
    if (a.tabelle === BESUCHE) return antwort(200, { records: [besuch] });
    return antwort(200, { records: [] });
  });
  const res = antwortObjekt();
  await appDataHandler(anfrage({ token: KLIENT_TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(!/ohne Lohn/i.test(JSON.stringify(res.body)), 'Markierung darf nicht in der Antwort stehen');
  assert.deepEqual(res.body.data.besuche[0].fields, {
    Datum: '2026-11-20', Von: '13:45', Bis: '15:00', 'Tätigkeit': 'Alltagsbegleitung', Status: 'Bestätigt', Pfleger_Name: ['Anna B.'],
  });
  assert.equal(besuch.fields[FELD], true, 'Original darf nicht verändert werden');
  // die bestehenden Listen bleiben, wie sie waren
  assert.deepEqual(NUR_MITARBEITER_FELDER.besuch, ['Abwesend/Urlaub', 'Stunden Urlaub/Gleitzeit']);
  assert.ok(!INTERNE_FELDER.besuch.includes(FELD));
});

// ================================================================ Mitarbeiter-App
test('Mitarbeiter-App bekommt die Markierung (über /api/ma-termine)', async () => {
  const einsatz = { id: 'recBesTest0000001', fields: { Datum: '2026-11-20', Pfleger_ID: [MA_ID], Patient_Name: ['Otto Beispiel'], [FELD]: true } };
  airtableAttrappe(async (a) => {
    if (a.tabelle === PERSONAL) return antwort(200, { records: a.formel.includes(TOKEN) ? [{ id: MA_ID, fields: { Name: 'Anna Beispiel', Aktiv: true } }] : [] });
    if (a.tabelle === BESUCHE) return antwort(200, { records: [einsatz] });
    return antwort(404, {});
  });
  const res = antwortObjekt();
  await maTermineHandler(anfrage({ method: 'POST', token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].fields[FELD], true);
});

test('Mitarbeiter-App: statt Zeiterfassung „Ohne Zeiterfassung“; „Lohn / Zeit“ zählt den Einsatz nie', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /import \{[^}]*\babrechnenOhneLohn\b[^}]*\} from '\.\.\/api\/_abrechnung';/);
  // eine Regel: Klient vorhanden UND Haken (wie api/_zeitkonto.js)
  assert.match(app, /const ohneZeiterfassung = \(t: any\) =>\s*!!\(getValue\(t, 'Patient'\) \|\| getValue\(t, 'Patient_Name'\)\) && abrechnenOhneLohn\(t && t\.fields \? t\.fields : t\);/);
  // Zeitnachweis: ausgeschlossen, bevor nach erfassten Zeiten gefiltert wird
  assert.match(app, /const zeitEinsaetze = \(zeitTermine \|\| \[\]\)\s*\.filter\(\(t\) => !abwesenheitVon\(t\)\)\s*\.filter\(\(t\) => !ohneZeiterfassung\(t\)\)/);
  // Karte „Heute“: der Hinweis steht VOR der Eingabe der Ist-Zeit und ersetzt sie
  const hinweis = app.indexOf('if (ohneZeiterfassung(t)) {');
  const eingabe = app.indexOf('Tatsächliche Dauer (Minuten)');
  assert.ok(hinweis > 0 && eingabe > hinweis, 'Hinweis muss vor der Eingabe stehen');
  const block = app.slice(hinweis, eingabe);
  assert.ok(block.includes('Ohne Zeiterfassung'));
  assert.ok(/return \(/.test(block), 'der Hinweis beendet den Block (keine Eingabe danach)');
  assert.ok(!/Lohn|abgerechnet|berechnet/.test(block.replace(/„Abrechnen ohne Lohn“/g, '')), 'für die Mitarbeiterin neutral formuliert');
  // Server lehnt ab (die App zeigte noch den alten Stand): kein falscher Hinweis „Bereits bestätigt“ –
  // nach dem Neuladen zeigt die Karte selbst „Ohne Zeiterfassung“
  assert.match(app, /if \(grund !== 'ohne_zeiterfassung'\) \{\s*setDauerHinweis\(prev => \(\{ \.\.\.prev, \[besuchId\]: 'Bereits bestätigt\. Änderungen nur über das Büro\.' \}\)\);\s*\}/);
  const nurHinweis = app.slice(hinweis, app.indexOf('const istMin = ', hinweis)); // nur der Zweig „Ohne Zeiterfassung“
  assert.ok(nurHinweis.includes('Ohne Zeiterfassung') && nurHinweis.length < block.length);
  assert.ok(!nurHinweis.includes('dauerHinweis'), 'unter „Ohne Zeiterfassung“ steht kein anderer Hinweis');
});

test('NEU-Markierung: Ankreuzen ist eine Änderung; alle übrigen Fingerabdrücke bleiben gleich', async () => {
  const quelle = readFileSync(new URL('../src/neuigkeiten.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(quelle, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const N = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const einsatz = (felder = {}) => ({ id: 'recA', fields: {
    Status: 'Geplant', Uhrzeit: '2026-11-03T07:00:00.000Z', Datum: '2026-11-03', Von: '08:00', Bis: '08:30',
    'Tätigkeit': 'Grundpflege', Patient_Name: ['Erika Musterfrau'], Adresse_Klient: ['Musterweg 1'], ...felder,
  } });
  // fester Wert der bisherigen Fassung (auf den Geräten gespeichert) -> kein „Geändert“ für alle
  assert.equal(N.einsatzSignatur(einsatz()), 'Geplant|8umegg');
  assert.equal(N.einsatzSignatur(einsatz({ [FELD]: false })), 'Geplant|8umegg');
  assert.equal(N.einsatzSignatur(einsatz({ [FELD]: '' })), 'Geplant|8umegg');
  const mit = N.einsatzSignatur(einsatz({ [FELD]: true }));
  assert.notEqual(mit, 'Geplant|8umegg');
  assert.ok(!/Lohn/i.test(mit), 'nur ein Prüfwert wird gemerkt');
  // gleiche Regel wie api/_abrechnung.js (auch umbenannt mit „ohne Lohn“)
  assert.equal(N.einsatzSignatur(einsatz({ 'Berechnen ohne Lohn': true })), mit);
  assert.equal(abrechnenOhneLohn({ 'Berechnen ohne Lohn': true }), true);
  // Markierung gegenüber dem gemerkten Stand
  const ab = Date.parse('2026-11-03T00:00:00');
  const stand = N.einsatzStand([einsatz()], ab);
  assert.deepEqual(N.einsatzMarken([einsatz({ [FELD]: true })], stand, ab), { recA: 'geaendert' });
  assert.deepEqual(N.einsatzMarken([einsatz()], stand, ab), {});
});
