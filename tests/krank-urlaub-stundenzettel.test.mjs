// Krank und Urlaub auf dem Stundenzettel (Meldung Geschäftsleitung 25.11.2026):
// 1. Krank: Der Tag steht immer drauf. Stunden nur, wenn das Büro sie einträgt (Teil-/Vollzeit) –
//    dann zählen sie zur Monatssumme; ohne Eintrag (Minijob) bleibt es beim Tag („–“).
// 2. So trägt das Büro Krankheit ein: Einsätze der Kranken absagen und dort „Krank“ wählen. Solche
//    abgesagten Einsätze ergeben einen Abwesenheitstag (Regel 7 in api/_zeitkonto.js).
// 3. Eingetragene Abwesenheiten gelten für den ganzen Zeitraum – auch auf dem vorläufigen Zettel,
//    wenn der Tag noch bevorsteht.
// 4. Geht eine Abwesenheit über das Ende des Zeitraums hinaus, sagt der Zettel, wo die Tage danach stehen.
// Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { airtableAttrappe, antwort, antwortObjekt, pdfTexte } from './_hilfen.mjs';

process.env.STUNDENZETTEL_SECRET = 'test-secret-1234567890';
process.env.CRON_SECRET = 'cron-secret-test-123';
process.env.AIRTABLE_TOKEN = 'test-key';

const {
  berechneZeitnachweis, abwesenheitNachArt, abwesenheitsEintraege, ausfallWegen, termin, berlin, hm,
} = await import('../api/_zeitkonto.js');
const { abrechnungszeitraum, imZeitraum } = await import('../api/_abrechnung.js');
const sz = await import('../api/stundenzettel.js');
const wu = await import('../api/_wochenuebersicht.js');
const { wocheZuDatum } = await import('../api/_dienstplan.js');
const monatslauf = (await import('../api/stundenzettel-monatslauf.js')).default;
const stundenzettel = sz.default;

const ZETTEL = 'tblmlg9ZNrtwRxmXx', PERSONAL = 'tbl3pMfhOLYPsQ5jF', BESUCHE = 'tblXJOSz4LaJCG10M';
const MA = 'recMaTestXXXXXXX1';
const STD = 'Stunden Urlaub/Gleitzeit';
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

let lfd = 0;
const id = (art) => `rec${art}${String(++lfd).padStart(14 - art.length, '0')}`;
// Bestätigter Einsatz mit Klient (Ist = Zeitfenster)
const einsatz = (datum, von, bis, extra = {}) => ({
  id: id('Ein'),
  fields: {
    Datum: datum, Monat: datum.slice(0, 7), Von: von, Bis: bis, Status: 'Bestätigt', Pfleger_ID: [MA],
    Patient: ['recKlientTest0001'], Patient_Name: ['Kurt Kunde'], Dauer_Ist: (min(bis) - min(von)) * 60, ...extra,
  },
});
// Abgesagter Einsatz mit Klient, an dem das Büro „Krank“ (oder eine andere Art) gewählt hat
const ausfall = (datum, von, bis, art = 'Krank', extra = {}) => {
  const r = einsatz(datum, von, bis, { Status: 'Abgesagt', 'Abwesend/Urlaub': art, ...extra });
  delete r.fields.Dauer_Ist;
  return r;
};
// Eigene Abwesenheitszeile ohne Klient
const zeile = (datum, art, extra = {}) => ({
  id: id('Abw'),
  fields: { Datum: datum, Monat: datum.slice(0, 7), Status: 'Bestätigt', Pfleger_ID: [MA], 'Abwesend/Urlaub': art, ...extra },
});
const std = (h) => ({ [STD]: Math.round(h * 3600) });

// „Jetzt“ für den Rechenkern: nach dem Ende des Zeitraums November 2026 (01.11.–26.11.)
const FINAL = '2026-11-27T03:00:00Z';
// vorläufig: Mi 25.11.2026, 18:13 Uhr deutscher Zeit – wie in der Meldung
const VORLAEUFIG = '2026-11-25T17:13:00Z';
const kurz = (n) => n.abwesenheiten.map((a) => [a.datum, a.art, a.von, a.bis, a.min, a.einsaetze]);

// ================================================================ Regel 7: abgesagter Einsatz + „Krank“
test('Meldung 25.11.: drei Tage Einsätze abgesagt + „Krank“ -> drei Krankheitstage, ohne Stunden nur der Tag', () => {
  const besuche = [
    einsatz('2026-11-23', '08:15', '10:15'), einsatz('2026-11-23', '10:30', '11:45'),
    ausfall('2026-11-24', '08:00', '09:15'), ausfall('2026-11-24', '09:15', '10:15'), ausfall('2026-11-24', '10:30', '11:45'),
    ausfall('2026-11-25', '09:00', '12:00'),
    ausfall('2026-11-26', '08:30', '09:45'), ausfall('2026-11-26', '10:00', '12:00'),
  ];
  const n = berechneZeitnachweis(besuche, { jetzt: FINAL });
  // EIN Eintrag je Tag; Zeitfenster = Spanne der ausgefallenen Einsätze; dahinter die Zahl der Einsätze
  assert.deepEqual(kurz(n), [
    ['2026-11-24', 'Krank', '08:00', '11:45', null, 3],
    ['2026-11-25', 'Krank', '09:00', '12:00', null, 1],
    ['2026-11-26', 'Krank', '08:30', '12:00', null, 2],
  ]);
  assert.ok(n.abwesenheiten.every((a) => a.grund === '' && !('bevorstehend' in a)));
  // die Einsätze selbst bleiben abgesagt: kein Soll, kein Ist, keine Anfahrt, nicht „nicht bestätigt“
  assert.deepEqual(n.ausgelassen, { abgesagt: 6, zukunft: 0 });
  assert.equal(n.summen.einsaetze, 2);
  assert.equal(hm(n.summen.einsatzMin), '3:15');
  assert.equal(hm(n.summen.anfahrtMin), '0:15');
  assert.equal(hm(n.summen.sollMin), '3:15');
  assert.equal(hm(n.summen.bezahltMin), '3:30');
  assert.equal(n.summen.ohneIst, 0);
  assert.deepEqual(n.nichtBestaetigt, []);
  // Minijob: keine Stunden, keine Lücke, nichts bezahlt
  assert.equal(n.summen.abwesenheitBezahltMin, 0);
  assert.equal(n.summen.abwesenheitOhneStunden, 0);
  assert.deepEqual(abwesenheitNachArt(n.abwesenheiten), [
    { art: 'Krank', anzahl: 3, tage: 3, min: 0, ohneStunden: 0, mitStunden: false, bezahlt: false },
  ]);
  // Zettel: Tage erkennbar, kein Betrag
  assert.deepEqual(sz.abwesenheitZeilen(n), [
    { datum: '24.11.2026', fenster: '08:00 – 11:45', soll: '–', ist: '–', klient: 'Krank · 3 Einsätze abgesagt' },
    { datum: '25.11.2026', fenster: '09:00 – 12:00', soll: '–', ist: '–', klient: 'Krank · 1 Einsatz abgesagt' },
    { datum: '26.11.2026', fenster: '08:30 – 12:00', soll: '–', ist: '–', klient: 'Krank · 2 Einsätze abgesagt' },
  ]);
  assert.deepEqual(sz.abwesenheitSummen(n), [
    { label: 'Krank (3 Tage)', anzeige: '–', notiz: 'Lohnfortzahlung rechnet das Lohnbüro', bezahlt: false },
  ]);
  assert.equal(sz.summeNotiz(n), '= Ist + Kunden-Anfahrt');
});

test('Teil-/Vollzeit: an den abgesagten Einsätzen eingetragene Stunden zählen – je Tag die Summe', () => {
  const n = berechneZeitnachweis([
    einsatz('2026-11-23', '08:00', '10:00'),
    ausfall('2026-11-24', '08:00', '09:15', 'Krank', std(3.5)), ausfall('2026-11-24', '09:15', '10:15'), // Tageswert an EINEM Einsatz
    ausfall('2026-11-25', '08:30', '09:45', 'Krank', std(1.25)), ausfall('2026-11-25', '10:00', '12:00', 'Krank', std(2)), // je Einsatz
    ausfall('2026-11-26', '09:00', '12:00'), // dieser Tag ohne Stunden
  ], { jetzt: FINAL });
  assert.deepEqual(kurz(n), [
    ['2026-11-24', 'Krank', '08:00', '10:15', 210, 2],
    ['2026-11-25', 'Krank', '08:30', '12:00', 195, 2],
    ['2026-11-26', 'Krank', '09:00', '12:00', null, 1],
  ]);
  assert.equal(n.summen.abwesenheitBezahltMin, 405);
  assert.equal(n.summen.abwesenheitOhneStunden, 0, 'zählt nur Urlaub/Gleitzeit ohne Stunden');
  assert.equal(hm(n.summen.bezahltMin), '8:45'); // 2:00 Einsatz + 6:45 Krank
  assert.equal(n.summen.einsaetze, 1);
  assert.equal(hm(n.summen.sollMin), '2:00');
  assert.deepEqual(abwesenheitNachArt(n.abwesenheiten), [
    { art: 'Krank', anzahl: 3, tage: 3, min: 405, ohneStunden: 1, mitStunden: true, bezahlt: true },
  ]);
  assert.deepEqual(sz.abwesenheitZeilen(n).map((z) => [z.datum, z.ist]), [['24.11.2026', '3:30'], ['25.11.2026', '3:15'], ['26.11.2026', '–']]);
  assert.deepEqual(sz.abwesenheitSummen(n), [
    { label: 'Krank (3 Tage)', anzeige: '6:45 Std.', notiz: 'davon 1 Tag ohne Stunden (0:00)', bezahlt: true },
  ]);
  assert.equal(sz.summeNotiz(n), '= Ist + Kunden-Anfahrt + Krank');
});

test('Stunden am abgesagten Einsatz: mehr als ein ganzer Tag ist ein Tippfehler und zählt nicht', () => {
  const n = berechneZeitnachweis([
    ausfall('2026-11-24', '08:00', '12:00', 'Krank', std(13)), ausfall('2026-11-24', '13:00', '17:00', 'Krank', std(12)), // 25 Std. an einem Tag
    ausfall('2026-11-25', '08:00', '12:00', 'Krank', std(25)),                                                          // schon je Zeile ungültig
    ausfall('2026-11-26', '08:00', '12:00', 'Krank', std(12)), ausfall('2026-11-26', '13:00', '17:00', 'Krank', std(12)), // genau 24 Std.: gilt
  ], { jetzt: FINAL });
  assert.deepEqual(n.abwesenheiten.map((a) => a.min), [null, null, 1440]);
  assert.equal(n.summen.abwesenheitBezahltMin, 1440);
});

test('Eigene Zeile derselben Art am selben Tag geht vor – nichts zählt doppelt; andere Art steht daneben', () => {
  const n = berechneZeitnachweis([
    // 24.11.: eigene Krank-Zeile mit 8:00 UND abgesagte Einsätze mit Stunden -> nur die eigene Zeile
    zeile('2026-11-24', 'Krank', std(8)),
    ausfall('2026-11-24', '08:00', '09:00', 'Krank', std(3)), ausfall('2026-11-24', '09:30', '10:30', 'Krank', std(1)),
    // 25.11.: eigene Urlaubszeile, Einsätze als „Krank“ abgesagt -> beide Arten
    zeile('2026-11-25', 'Urlaub', std(8)),
    ausfall('2026-11-25', '08:00', '09:00'),
    // 26.11.: zwei Arten an den abgesagten Einsätzen -> je Art ein Eintrag
    ausfall('2026-11-26', '08:00', '09:00', 'Krank'), ausfall('2026-11-26', '10:00', '11:00', 'Urlaub', std(4)), ausfall('2026-11-26', '12:00', '13:00', 'Urlaub'),
  ], { jetzt: FINAL });
  assert.deepEqual(kurz(n), [
    ['2026-11-24', 'Krank', '', '', 480, undefined],
    ['2026-11-25', 'Urlaub', '', '', 480, undefined],
    ['2026-11-25', 'Krank', '08:00', '09:00', null, 1],
    ['2026-11-26', 'Krank', '08:00', '09:00', null, 1],
    ['2026-11-26', 'Urlaub', '10:00', '13:00', 240, 2],
  ]);
  assert.equal(n.summen.abwesenheitBezahltMin, 480 + 480 + 240);
  assert.deepEqual(abwesenheitNachArt(n.abwesenheiten).map((a) => [a.art, a.anzahl, a.tage, a.min, a.ohneStunden, a.bezahlt]), [
    ['Urlaub', 2, 2, 720, 0, true],
    ['Krank', 3, 3, 480, 2, true],
  ]);
});

test('Nur ein ABGESAGTER Einsatz zählt als Abwesenheit – ein nicht abgesagter bleibt ein Einsatz', () => {
  const offen = einsatz('2026-11-25', '08:00', '09:00', { 'Abwesend/Urlaub': 'Krank', ...std(8) });
  delete offen.fields.Dauer_Ist;
  const n = berechneZeitnachweis([
    einsatz('2026-11-24', '08:00', '09:00', { 'Abwesend/Urlaub': 'Krank', ...std(8) }), // bestätigt (z. B. von der Vertretung): Arbeitszeit
    offen,                                                                              // nicht bestätigt: steht unter „nicht bestätigt“
    einsatz('2026-11-26', '08:00', '09:00', { Status: 'Abgesagt' }),                    // abgesagt ohne Auswahl: einfach abgesagt
    zeile('2026-11-26', 'Krank', { Status: 'Abgesagt', ...std(8) }),                    // wieder abgesagte Krank-Zeile: zählt nie
  ], { jetzt: FINAL });
  assert.deepEqual(n.abwesenheiten, []);
  assert.equal(n.summen.einsaetze, 1);
  assert.equal(hm(n.summen.bezahltMin), '1:00');
  assert.equal(n.summen.ohneIst, 1);
  assert.equal(n.summen.abwesenheitBezahltMin, 0);
  assert.deepEqual(n.ausgelassen, { abgesagt: 2, zukunft: 0 });
  // die Regel selbst
  const f = (extra) => ({ Patient: ['recKlientTest0001'], Status: 'Abgesagt', 'Abwesend/Urlaub': 'Krank', ...extra });
  assert.equal(ausfallWegen(f({})), 'Krank');
  assert.equal(ausfallWegen(f({ Patient: undefined, Patient_Name: ['Kurt Kunde'] })), 'Krank');
  assert.equal(ausfallWegen(f({ 'Abwesend/Urlaub': { id: 'selTest', name: 'Urlaub' } })), 'Urlaub');
  assert.equal(ausfallWegen(f({ Status: { name: 'Abgesagt' } })), 'Krank');
  assert.equal(ausfallWegen(f({ Status: 'Bestätigt' })), '');
  assert.equal(ausfallWegen(f({ Status: 'Geplant' })), '');
  assert.equal(ausfallWegen(f({ 'Abwesend/Urlaub': '' })), '');
  assert.equal(ausfallWegen(f({ Patient: [] })), '', 'ohne Klient ist es eine (abgesagte) Abwesenheitszeile');
  assert.equal(ausfallWegen(undefined), '');
  // termin(): die neuen Angaben stehen nur am zutreffenden Termin – alle anderen behalten ihren Aufbau
  const basis = Object.keys(termin(einsatz('2026-11-24', '08:00', '09:00').fields));
  assert.ok(!basis.includes('ausfall') && !basis.includes('ausfallStundenMin'));
  assert.deepEqual(Object.keys(termin(zeile('2026-11-24', 'Krank').fields)), basis);
  assert.deepEqual(Object.keys(termin(einsatz('2026-11-24', '08:00', '09:00', { Status: 'Abgesagt' }).fields)), basis);
  const t = termin(ausfall('2026-11-24', '08:00', '09:00', 'Krank', std(2)).fields);
  assert.deepEqual(Object.keys(t), [...basis, 'ausfall', 'ausfallStundenMin']);
  assert.equal(t.ausfall, 'Krank');
  assert.equal(t.ausfallStundenMin, 120);
  assert.equal(t.abwesenheit, '', 'der Termin selbst bleibt ein (abgesagter) Einsatz');
});

test('Halber Tag: morgens gearbeitet, nachmittags abgesagt + „Krank“ -> Arbeitszeit UND Krankheitstag', () => {
  const n = berechneZeitnachweis([
    einsatz('2026-11-24', '08:00', '10:00'), einsatz('2026-11-24', '10:15', '11:15'),
    ausfall('2026-11-24', '13:00', '14:00', 'Krank', std(2)), ausfall('2026-11-24', '14:30', '15:30'),
  ], { jetzt: FINAL });
  assert.equal(n.tage.length, 1);
  assert.deepEqual(n.tage[0].zeilen.map((z) => z.art), ['einsatz', 'anfahrt', 'einsatz']);
  assert.equal(hm(n.tage[0].bezahltMin), '3:15');
  assert.deepEqual(kurz(n), [['2026-11-24', 'Krank', '13:00', '15:30', 120, 2]]);
  assert.equal(hm(n.summen.bezahltMin), '5:15'); // 3:00 Einsätze + 0:15 Anfahrt + 2:00 Krank
});

test('Abgesagter Einsatz ohne Uhrzeit: der Tag steht als „ganztägig“ da', () => {
  const ohneZeit = ausfall('2026-11-24', '08:00', '09:00');
  delete ohneZeit.fields.Von; delete ohneZeit.fields.Bis;
  const n = berechneZeitnachweis([ohneZeit, ausfall('2026-11-24', '10:00', '11:00')], { jetzt: FINAL });
  assert.deepEqual(kurz(n), [['2026-11-24', 'Krank', '', '', null, 2]]);
  assert.equal(sz.abwesenheitZeilen(n)[0].fenster, 'ganztägig');
});

// ================================================================ Krank als eigene Zeile
test('Krank als eigene Zeile: mit eingetragenen Stunden bezahlt, ohne nur der Tag – 0:00 heißt „keine Stunden“', () => {
  const n = berechneZeitnachweis([
    einsatz('2026-11-10', '08:00', '09:00'),
    zeile('2026-11-11', 'Krank', std(8)),
    zeile('2026-11-12', 'Krank', std(7.7)),          // 7:42 genau wie eingetragen
    zeile('2026-11-13', 'Krank'),                    // ohne Stunden
    zeile('2026-11-16', 'Krank', { [STD]: 0 }),      // 0:00 = keine Stunden
    zeile('2026-11-17', 'Abwesend', std(8)),         // Abwesend: nie Stunden
    zeile('2026-11-18', 'Gleitzeit', std(6)),
  ], { jetzt: FINAL });
  assert.deepEqual(n.abwesenheiten.map((a) => [a.datum, a.art, a.min]), [
    ['2026-11-11', 'Krank', 480], ['2026-11-12', 'Krank', 462], ['2026-11-13', 'Krank', null], ['2026-11-16', 'Krank', null],
    ['2026-11-17', 'Abwesend', null], ['2026-11-18', 'Gleitzeit', 360],
  ]);
  assert.equal(n.summen.abwesenheitBezahltMin, 942);
  assert.equal(n.summen.abwesenheitZeitkontoMin, 360);
  assert.equal(n.summen.abwesenheitOhneStunden, 0);
  assert.equal(hm(n.summen.bezahltMin), '16:42'); // 1:00 + 15:42 Krank – ohne Gleitzeit
  assert.deepEqual(sz.abwesenheitZeilen(n).map((z) => z.ist), ['8:00', '7:42', '–', '–', '–', '(6:00)']);
  // Reihenfolge der Arten wie bisher (Urlaub, Gleitzeit, Krank, Abwesend); auf dem Zettel stehen die
  // bezahlten vor der Monatssumme, die übrigen danach
  assert.deepEqual(sz.abwesenheitSummen(n), [
    { label: 'Gleitzeit (1 Tag)', anzeige: '(6:00 Std.)', notiz: 'Freizeitausgleich (Zeitkonto) – nicht in der Summe', bezahlt: false },
    { label: 'Krank (4 Tage)', anzeige: '15:42 Std.', notiz: 'davon 2 Tage ohne Stunden (0:00)', bezahlt: true },
    { label: 'Abwesend (1 Tag)', anzeige: '–', notiz: 'nicht in der Summe', bezahlt: false },
  ]);
  // alle Krank-Tage mit Stunden: der Hinweis nennt die Lohnfortzahlung
  const alle = berechneZeitnachweis([zeile('2026-11-11', 'Krank', std(8)), zeile('2026-11-12', 'Krank', std(8))], { jetzt: FINAL });
  assert.deepEqual(sz.abwesenheitSummen(alle), [
    { label: 'Krank (2 Tage)', anzeige: '16:00 Std.', notiz: 'Lohnfortzahlung, vom Büro eingetragen', bezahlt: true },
  ]);
  // Urlaub und Krank zusammen: beide in der Summe, Reihenfolge Urlaub – Krank
  const beide = berechneZeitnachweis([zeile('2026-11-11', 'Krank', std(8)), zeile('2026-11-12', 'Urlaub', std(8))], { jetzt: FINAL });
  assert.equal(sz.summeNotiz(beide), '= Ist + Kunden-Anfahrt + Urlaub + Krank');
  assert.equal(hm(beide.summen.bezahltMin), '16:00');
});

// ================================================================ vorläufiger Zettel: ganzer Zeitraum
test('Meldung 25.11.: Urlaub am 26.11. steht schon am 25.11. auf dem vorläufigen Zettel und zählt', () => {
  const besuche = [
    ...['23', '24', '25'].map((t) => einsatz(`2026-11-${t}`, '08:00', '16:00')),
    zeile('2026-11-26', 'Urlaub', std(8)),
    einsatz('2026-11-26', '17:00', '18:00'), // ein kommender EINSATZ zählt weiterhin nicht
  ];
  const vorl = berechneZeitnachweis(besuche, { jetzt: VORLAEUFIG });
  assert.deepEqual(vorl.abwesenheiten.map((a) => [a.datum, a.art, a.min, a.bevorstehend]), [['2026-11-26', 'Urlaub', 480, true]]);
  assert.equal(hm(vorl.summen.bezahltMin), '32:00'); // 24:00 Einsätze + 8:00 Urlaub
  assert.deepEqual(vorl.ausgelassen, { abgesagt: 0, zukunft: 1 });
  assert.equal(sz.vorlaeufigInhalt(vorl), sz.VORLAEUFIG_INHALT_ABWESENHEIT);
  // am 27. ist der Tag vorbei: gleiche Summe ohne die Kennzeichnung (und mit dem dann vergangenen Einsatz)
  const fertig = berechneZeitnachweis(besuche, { jetzt: FINAL });
  assert.deepEqual(fertig.abwesenheiten.map((a) => [a.datum, a.min, 'bevorstehend' in a]), [['2026-11-26', 480, false]]);
  assert.equal(hm(fertig.summen.bezahltMin), '33:00');
  assert.equal(sz.vorlaeufigInhalt(fertig), sz.VORLAEUFIG_INHALT);
  // ohne bevorstehende Abwesenheit bleibt die Kopfzeile, wie sie war
  assert.equal(sz.VORLAEUFIG_INHALT, 'enthält nur bereits vergangene Termine');
  assert.equal(sz.vorlaeufigInhalt(berechneZeitnachweis([einsatz('2026-11-23', '08:00', '09:00')], { jetzt: VORLAEUFIG })), sz.VORLAEUFIG_INHALT);
  assert.equal(sz.vorlaeufigInhalt(undefined), sz.VORLAEUFIG_INHALT);
});

test('Auch der Krankheitstag aus abgesagten Einsätzen steht vorab drauf (heute nach Plan-Ende: vorbei, morgen: bevorstehend)', () => {
  const n = berechneZeitnachweis([
    ausfall('2026-11-25', '09:00', '12:00'),   // heute, geplantes Ende vor 18:13
    ausfall('2026-11-25', '19:00', '20:00', 'Urlaub'), // heute, geplantes Ende noch nicht erreicht
    ausfall('2026-11-26', '08:30', '09:45'),
  ], { jetzt: VORLAEUFIG });
  assert.deepEqual(n.abwesenheiten.map((a) => [a.datum, a.art, !!a.bevorstehend]), [
    ['2026-11-25', 'Krank', false], ['2026-11-25', 'Urlaub', true], ['2026-11-26', 'Krank', true],
  ]);
  assert.deepEqual(n.ausgelassen, { abgesagt: 3, zukunft: 0 });
});

// ================================================================ über das Ende des Zeitraums hinaus
test('Meldung 25.11.: Urlaub 26.–28.11. – der November-Zettel zählt den 26.11. und sagt, wo 27. und 28.11. stehen', () => {
  const zeitraum = abrechnungszeitraum('2026-11');
  const alle = [
    einsatz('2026-11-25', '08:00', '16:00'),
    zeile('2026-11-26', 'Urlaub', std(8)), zeile('2026-11-27', 'Urlaub', std(8)), zeile('2026-11-28', 'Urlaub', std(8)),
  ];
  const besuche = alle.filter((b) => imZeitraum(b.fields.Datum, zeitraum));
  const danach = alle.filter((b) => b.fields.Datum > zeitraum.bis);
  const n = berechneZeitnachweis(besuche, { jetzt: FINAL, zeitraum, danach });
  assert.deepEqual(n.abwesenheiten.map((a) => a.datum), ['2026-11-26']);
  assert.equal(hm(n.summen.bezahltMin), '16:00'); // 8:00 Einsatz + 8:00 Urlaub; 27./28.11. gehören zu Dezember
  assert.deepEqual(n.ueberZeitraumende, { arten: ['Urlaub'], bis: '2026-11-26', ab: '2026-11-27', monat: '2026-12' });
  assert.equal(sz.zeitraumendeHinweis(n),
    'Urlaub über den 26.11. hinaus: Die Tage ab 27.11. stehen auf dem Stundenzettel Dezember 2026 (nächster Abrechnungszeitraum).');
  // der Dezember-Zettel (27.11.–26.12.) zählt die beiden Tage
  const dez = abrechnungszeitraum('2026-12');
  const nDez = berechneZeitnachweis(alle.filter((b) => imZeitraum(b.fields.Datum, dez)), { jetzt: '2026-12-27T03:00:00Z', zeitraum: dez, danach: [] });
  assert.deepEqual(nDez.abwesenheiten.map((a) => [a.datum, a.min]), [['2026-11-27', 480], ['2026-11-28', 480]]);
  assert.equal(hm(nDez.summen.bezahltMin), '16:00');
  assert.equal('ueberZeitraumende' in nDez, false);
});

test('Hinweis zum Zeitraumende nur, wenn dieselbe Art am letzten Tag UND am Tag danach eingetragen ist', () => {
  const zeitraum = abrechnungszeitraum('2026-12'); // 27.11.–26.12.2026
  const lauf = (besuche, danach, opt = {}) => berechneZeitnachweis(besuche, { jetzt: '2026-12-27T03:00:00Z', zeitraum, danach, ...opt });
  const ende = (art, extra) => zeile('2026-12-26', art, extra);
  const folge = (art, extra) => zeile('2026-12-27', art, extra);
  // trifft zu – auch über den Jahreswechsel im Namen des nächsten Zettels
  assert.deepEqual(lauf([ende('Krank')], [folge('Krank')]).ueberZeitraumende, { arten: ['Krank'], bis: '2026-12-26', ab: '2026-12-27', monat: '2027-01' });
  assert.match(sz.zeitraumendeHinweis(lauf([ende('Krank')], [folge('Krank')])), /^Krank über den 26\.12\. hinaus: Die Tage ab 27\.12\. stehen auf dem Stundenzettel Januar 2027 /);
  // … auch aus abgesagten Einsätzen, auf beiden Seiten
  assert.deepEqual(lauf([ausfall('2026-12-26', '08:00', '09:00')], [ausfall('2026-12-27', '08:00', '09:00')]).ueberZeitraumende.arten, ['Krank']);
  // zwei Arten: beide genannt, Reihenfolge Urlaub – Krank
  const zwei = lauf([ende('Krank'), ende('Urlaub', std(8))], [folge('Urlaub'), folge('Krank')]);
  assert.deepEqual(zwei.ueberZeitraumende.arten, ['Urlaub', 'Krank']);
  assert.match(sz.zeitraumendeHinweis(zwei), /^Urlaub und Krank über den 26\.12\. hinaus:/);
  // trifft nicht zu: andere Art danach, Lücke am Folgetag, nichts am letzten Tag, abgesagt, erst am 28.
  for (const [name, besuche, danach] of [
    ['andere Art', [ende('Urlaub')], [folge('Krank')]],
    ['nichts am Folgetag', [ende('Urlaub')], []],
    ['nichts am letzten Tag', [zeile('2026-12-25', 'Urlaub')], [folge('Urlaub')]],
    ['Folgetag abgesagt', [ende('Urlaub')], [folge('Urlaub', { Status: 'Abgesagt' })]],
    ['letzter Tag abgesagt', [ende('Urlaub', { Status: 'Abgesagt' })], [folge('Urlaub')]],
    ['erst am 28.', [ende('Urlaub')], [zeile('2026-12-28', 'Urlaub')]],
    ['Einsatz am Folgetag', [ende('Urlaub')], [einsatz('2026-12-27', '08:00', '09:00', { 'Abwesend/Urlaub': 'Urlaub' })]],
  ]) {
    const n = lauf(besuche, danach);
    assert.equal('ueberZeitraumende' in n, false, name);
    assert.equal(sz.zeitraumendeHinweis(n), '', name);
  }
  // ohne Zeitraum oder ohne die Zeilen danach: kein Hinweis, Aufbau des Ergebnisses wie bisher
  const ohne = berechneZeitnachweis([ende('Urlaub')], { jetzt: '2026-12-27T03:00:00Z' });
  assert.deepEqual(Object.keys(ohne), ['jetzt', 'tage', 'summen', 'ausgelassen', 'nichtBestaetigt', 'abwesenheiten', 'ohneLohn']);
  assert.equal('ueberZeitraumende' in lauf([ende('Urlaub')], undefined), false);
  assert.equal('ueberZeitraumende' in lauf([ende('Urlaub')], [folge('Urlaub')], { zeitraum: undefined }), false);
  assert.equal(sz.zeitraumendeHinweis(undefined), '');
  assert.equal(sz.zeitraumendeHinweis({ ueberZeitraumende: { arten: [] } }), '');
});

// ================================================================ Bestand bleibt
test('Ohne die neuen Fälle bleibt alles, wie es war: Aufbau, Summen, Reihenfolge', () => {
  const besuche = [
    einsatz('2026-11-10', '08:00', '09:00'), einsatz('2026-11-10', '09:30', '10:30'),
    einsatz('2026-11-11', '08:00', '09:00', { Status: 'Abgesagt' }),
    zeile('2026-11-12', 'Urlaub', { ...std(8), 'Tätigkeit': 'Urlaub' }),
    zeile('2026-11-13', 'Gleitzeit', std(6)),
    zeile('2026-11-13', 'Abwesend', { Von: '10:00', Bis: '12:00', 'Tätigkeit': 'Fortbildung' }),
    zeile('2026-11-16', 'Krank'),
  ];
  const n = berechneZeitnachweis(besuche, { jetzt: FINAL });
  assert.deepEqual(Object.keys(n), ['jetzt', 'tage', 'summen', 'ausgelassen', 'nichtBestaetigt', 'abwesenheiten', 'ohneLohn']);
  assert.deepEqual(Object.keys(n.summen), ['sollMin', 'einsatzMin', 'anfahrtMin', 'pauseMin', 'bezahltMin', 'einsaetze', 'ohneIst', 'ohneIstSollMin',
    'abwesenheitBezahltMin', 'abwesenheitZeitkontoMin', 'abwesenheitOhneStunden']);
  for (const a of n.abwesenheiten) assert.deepEqual(Object.keys(a), ['id', 'datum', 'art', 'grund', 'von', 'bis', 'min']);
  assert.deepEqual(n.abwesenheiten.map((a) => [a.datum, a.art, a.grund, a.von, a.min]), [
    ['2026-11-12', 'Urlaub', '', '', 480],
    ['2026-11-13', 'Abwesend', 'Fortbildung', '10:00', null],
    ['2026-11-13', 'Gleitzeit', '', '', 360],
    ['2026-11-16', 'Krank', '', '', null],
  ]);
  assert.equal(hm(n.summen.bezahltMin), '10:30'); // 2:00 + 0:30 Anfahrt + 8:00 Urlaub
  assert.deepEqual(sz.abwesenheitSummen(n).map((z) => [z.label, z.anzeige, z.notiz, z.bezahlt]), [
    ['Urlaub (1 Tag)', '8:00 Std.', 'bezahlt, vom Büro eingetragen', true],
    ['Gleitzeit (1 Tag)', '(6:00 Std.)', 'Freizeitausgleich (Zeitkonto) – nicht in der Summe', false],
    ['Krank (1 Tag)', '–', 'Lohnfortzahlung rechnet das Lohnbüro', false],
    ['Abwesend (1 Tag)', '–', 'nicht in der Summe', false],
  ]);
  assert.deepEqual(sz.abwesenheitZeilen(n).map((z) => z.klient), ['Urlaub', 'Abwesend · Fortbildung', 'Gleitzeit', 'Krank']);
  // abwesenheitsEintraege allein: eigene Zeilen vor den abgeleiteten des Tages, ohne Datum nie
  const e = abwesenheitsEintraege(
    [termin(zeile('2026-11-24', 'Urlaub').fields, 'recB'), termin({ 'Abwesend/Urlaub': 'Krank' }, 'recOhneDatum')],
    [termin(ausfall('2026-11-24', '08:00', '09:00').fields, 'recA'), termin(ausfall('2026-11-23', '08:00', '09:00').fields, 'recC')],
  );
  assert.deepEqual(e.map((a) => [a.id, a.datum, a.art]), [['recC', '2026-11-23', 'Krank'], ['recB', '2026-11-24', 'Urlaub'], ['recA', '2026-11-24', 'Krank']]);
  assert.ok(e.every((a) => !('bevorstehend' in a)), 'ohne „jetzt“ wird nichts gekennzeichnet');
});

// ================================================================ PDF
const zettel = async (besuche, { jetzt = FINAL, final = true, danach } = {}) => {
  const zeitraum = abrechnungszeitraum('2026-11');
  const nachweis = berechneZeitnachweis(besuche, { jetzt, zeitraum, danach });
  const bytes = await sz.erstellePdf({ maName: 'Erika M.', maNr: 90123, monat: '2026-11', zeitraum, nachweis, final });
  return { nachweis, bytes, texte: pdfTexte(bytes), seiten: (await PDFDocument.load(bytes)).getPageCount() };
};

test('PDF Minijob: die drei Krankheitstage stehen erkennbar drauf – ohne jede Stundenzahl', async () => {
  const { texte, seiten } = await zettel([
    einsatz('2026-11-23', '08:15', '10:15'),
    ausfall('2026-11-24', '08:00', '09:15'), ausfall('2026-11-24', '09:15', '10:15'), ausfall('2026-11-24', '10:30', '11:45'),
    ausfall('2026-11-25', '09:00', '12:00'),
    ausfall('2026-11-26', '08:30', '09:45'), ausfall('2026-11-26', '10:00', '12:00'),
  ]);
  assert.equal(seiten, 1);
  const titel = texte.indexOf(sz.ABWESENHEIT_TITEL);
  assert.ok(titel > 0);
  assert.deepEqual(texte.slice(titel + 1, titel + 16), [
    '24.11.2026', '08:00 – 11:45', '–', '–', 'Krank · 3 Einsätze abgesagt',
    '25.11.2026', '09:00 – 12:00', '–', '–', 'Krank · 1 Einsatz abgesagt',
    '26.11.2026', '08:30 – 12:00', '–', '–', 'Krank · 2 Einsätze abgesagt',
  ]);
  const i = texte.indexOf('Krank (3 Tage)');
  assert.deepEqual(texte.slice(i, i + 3), ['Krank (3 Tage)', '–', 'Lohnfortzahlung rechnet das Lohnbüro']);
  assert.ok(texte.indexOf('Monatssumme (bezahlt)') < i, 'ohne Stunden steht Krank nach der Monatssumme');
  const s = texte.indexOf('Monatssumme (bezahlt)');
  assert.deepEqual(texte.slice(s, s + 3), ['Monatssumme (bezahlt)', '2:00 Std.', '= Ist + Kunden-Anfahrt']);
  // die abgesagten Einsätze selbst stehen nirgends als Arbeit oder „nicht bestätigt“
  assert.ok(!texte.includes(sz.NICHT_BESTAETIGT_TITEL));
  assert.ok(!texte.includes('1:15') && !texte.includes('3:00'));
  assert.ok(texte.includes(sz.UNTERSCHRIFT_ROLLE));
});

test('PDF Teil-/Vollzeit: eingetragene Krank-Stunden stehen fett in der Ist-Spalte und in der Monatssumme', async () => {
  const { texte } = await zettel([
    einsatz('2026-11-23', '08:15', '10:15'),
    ausfall('2026-11-24', '08:00', '09:15', 'Krank', std(3.5)), ausfall('2026-11-24', '09:15', '10:15'),
    zeile('2026-11-25', 'Krank', std(8)),
  ]);
  const titel = texte.indexOf(sz.ABWESENHEIT_TITEL);
  assert.deepEqual(texte.slice(titel + 1, titel + 11), [
    '24.11.2026', '08:00 – 10:15', '–', '3:30', 'Krank · 2 Einsätze abgesagt',
    '25.11.2026', 'ganztägig', '–', '8:00', 'Krank',
  ]);
  const i = texte.indexOf('Krank (2 Tage)');
  assert.deepEqual(texte.slice(i, i + 3), ['Krank (2 Tage)', '11:30 Std.', 'Lohnfortzahlung, vom Büro eingetragen']);
  const s = texte.indexOf('Monatssumme (bezahlt)');
  assert.ok(i < s, 'Krank mit Stunden steht vor der Monatssumme');
  assert.deepEqual(texte.slice(s, s + 3), ['Monatssumme (bezahlt)', '13:30 Std.', '= Ist + Kunden-Anfahrt + Krank']);
});

test('PDF vorläufig: Kopfzeile nennt die eingetragenen Abwesenheiten nur, wenn eine bevorsteht; Hinweis zum Zeitraumende steht unter der Liste', async () => {
  const basis = [einsatz('2026-11-23', '08:00', '16:00'), einsatz('2026-11-24', '08:00', '16:00'), einsatz('2026-11-25', '08:00', '16:00')];
  const urlaub = [zeile('2026-11-26', 'Urlaub', std(8))];
  const danach = [zeile('2026-11-27', 'Urlaub', std(8)), zeile('2026-11-28', 'Urlaub', std(8))];
  const mit = await zettel([...basis, ...urlaub], { jetzt: VORLAEUFIG, final: false, danach });
  const kopf = mit.texte.find((t) => t.startsWith('VORLÄUFIG'));
  assert.equal(kopf, 'VORLÄUFIG · Stand 25.11.2026, 18:13 Uhr · vergangene Einsätze und alle eingetragenen Abwesenheiten');
  const titel = mit.texte.indexOf(sz.ABWESENHEIT_TITEL);
  assert.deepEqual(mit.texte.slice(titel + 1, titel + 7), [
    '26.11.2026', 'ganztägig', '–', '8:00', 'Urlaub',
    'Urlaub über den 26.11. hinaus: Die Tage ab 27.11. stehen auf dem Stundenzettel Dezember 2026 (nächster Abrechnungszeitraum).',
  ]);
  const s = mit.texte.indexOf('Zwischensumme (bezahlt)');
  assert.deepEqual(mit.texte.slice(s, s + 3), ['Zwischensumme (bezahlt)', '32:00 Std.', '= Ist + Kunden-Anfahrt + Urlaub']);
  assert.ok(!mit.texte.includes(sz.UNTERSCHRIFT_ROLLE), 'vorläufig: keine Unterschrift');
  // ohne bevorstehende Abwesenheit: Kopfzeile wie bisher, kein Hinweis
  const ohne = await zettel(basis, { jetzt: VORLAEUFIG, final: false, danach });
  assert.equal(ohne.texte.find((t) => t.startsWith('VORLÄUFIG')), 'VORLÄUFIG · Stand 25.11.2026, 18:13 Uhr · enthält nur bereits vergangene Termine');
  assert.ok(!ohne.texte.some((t) => t.includes('hinaus:')));
  // fertiger Zettel: der Hinweis bleibt (die Tage danach stehen auf dem nächsten Zettel)
  const fertig = await zettel([...basis, ...urlaub], { danach });
  assert.ok(fertig.texte.includes('Erstellt am 27.11.2026, 04:00 Uhr'));
  assert.ok(fertig.texte.some((t) => t.startsWith('Urlaub über den 26.11. hinaus:')));
  assert.ok(!fertig.texte.some((t) => t.startsWith('VORLÄUFIG')));
});

test('Texte: darstellbar, passen gedruckt in die Breite; die Erläuterung ist so lang wie bisher (kein zusätzlicher Seitenumbruch)', async () => {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const kursiv = await doc.embedFont(StandardFonts.HelveticaOblique);
  const breite = 595.28 - 2 * 50;
  assert.equal(sz.HINWEIS, 'Zeitfenster und Soll = Planung · bezahlt: bestätigte Ist-Zeit + Kunden-Anfahrt + eingetragene Stunden Urlaub/Krank · Erläuterung am Ende');
  assert.ok(sz.druckbreite(sz.pdfText(sz.HINWEIS), normal, 8) <= breite, 'HINWEIS zu breit');
  for (const inhalt of [sz.VORLAEUFIG_INHALT, sz.VORLAEUFIG_INHALT_ABWESENHEIT]) {
    const kopf = `VORLÄUFIG · Stand 25.11.2026, 18:13 Uhr · ${inhalt}`;
    assert.equal(sz.pdfText(kopf), kopf);
    assert.ok(sz.druckbreite(kopf, fett, 9) <= breite, `Kopfzeile zu breit: ${inhalt}`);
  }
  // Hinweis zum Zeitraumende: längster Fall (zwei Arten, langer Monatsname) – wird umbrochen, jedes Wort passt
  const lang = sz.zeitraumendeHinweis({ ueberZeitraumende: { arten: ['Gleitzeit', 'Abwesend'], bis: '2027-08-26', ab: '2027-08-27', monat: '2027-09' } });
  assert.equal(sz.pdfText(lang), lang);
  assert.match(lang, /Stundenzettel September 2027 \(nächster Abrechnungszeitraum\)\.$/);
  const langZeilen = sz.umbrechen(lang, kursiv, 8, breite);
  assert.equal(langZeilen.length, 2);
  assert.equal(langZeilen.join(' '), lang, 'beim Umbrechen geht kein Wort verloren');
  assert.ok(langZeilen.every((z) => sz.druckbreite(z, kursiv, 8) <= breite));
  const einfach = sz.zeitraumendeHinweis({ ueberZeitraumende: { arten: ['Urlaub'], bis: '2026-11-26', ab: '2026-11-27', monat: '2026-12' } });
  assert.deepEqual(sz.umbrechen(einfach, kursiv, 8, breite), [einfach], 'der übliche Hinweis passt in eine Zeile');
  // Klient-Spalte (10 pt fett, ab x=272): auch viele abgesagte Einsätze passen ohne Kürzen
  for (const t of ['Krank · 99 Einsätze abgesagt', 'Gleitzeit · 99 Einsätze abgesagt']) {
    assert.ok(fett.widthOfTextAtSize(sz.pdfText(t), 10) <= 595.28 - 50 - sz.SPALTEN.klient, t);
  }
  // Summen-Notizen (8 pt, ab x=312)
  for (const t of ['Lohnfortzahlung, vom Büro eingetragen', '= Ist + Kunden-Anfahrt + Urlaub + Krank']) {
    assert.ok(normal.widthOfTextAtSize(sz.pdfText(t), 8) <= 595.28 - 50 - 312, t);
  }
  // Erläuterung: der Absatz zu Urlaub/Krank braucht weiter 5 Zeilen (8 pt, Breite wie im PDF) – jede
  // zusätzliche Zeile könnte einen bisher einseitigen Zettel auf zwei Seiten verteilen
  const absaetze = [...sz.ERLAEUTERUNG, sz.OHNE_LOHN_ERLAEUTERUNG].map((t) => sz.umbrechen(t, normal, 8, breite - 10));
  assert.deepEqual(absaetze.map((z) => z.length), [2, 2, 2, 5, 2, 3, 2, 2, 3]);
  // … und keine Zeile ragt gedruckt über den rechten Rand
  for (const zeilen of absaetze) {
    for (const z of zeilen) assert.ok(sz.druckbreite(z, normal, 8) <= breite - 10, `Zeile zu breit: ${z}`);
  }
});

// ================================================================ Endpoint /api/stundenzettel
test('Endpoint: Zeilen nach dem Zeitraum liefern nur den Hinweis; Antwort nennt Urlaub- und Krank-Stunden', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-05T10:00:00Z') });
  const besuche = [
    einsatz('2026-11-23', '08:00', '10:00'),
    ausfall('2026-11-24', '08:00', '09:15', 'Krank', std(3.5)), ausfall('2026-11-24', '09:15', '10:15'),
    zeile('2026-11-26', 'Urlaub', std(8)),
    zeile('2026-11-27', 'Urlaub', std(8)), zeile('2026-11-28', 'Urlaub', std(8)), // nächster Zeitraum
    einsatz('2026-11-30', '08:00', '09:00'),                                        // nächster Zeitraum
  ];
  const log = { upload: null, patches: [] };
  airtableAttrappe(async (a) => {
    if (a.host === 'content.airtable.com') { log.upload = a.body; return antwort(200, { id: 'recZettelTest0001' }); }
    if (a.tabelle === ZETTEL && a.methode === 'GET') return antwort(200, { id: 'recZettelTest0001', fields: { Mitarbeiter: [MA], Monat_Auswahl: 'November 2026' } });
    if (a.tabelle === ZETTEL && a.methode === 'PATCH') { log.patches.push(a.body.fields); return antwort(200, {}); }
    if (a.tabelle === PERSONAL) return antwort(200, { id: MA, fields: { Name: 'Erika M.', Anmelde_ID: 90123 } });
    if (a.tabelle === BESUCHE) return antwort(200, { records: besuche });
    return antwort(404, {});
  });
  const res = antwortObjekt();
  await stundenzettel({ method: 'POST', headers: { 'x-hook-secret': process.env.STUNDENZETTEL_SECRET }, body: { recordId: 'recZettelTest0001' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.summe, '13:30'); // 2:00 Einsatz + 3:30 Krank + 8:00 Urlaub (26.11.) – nichts vom 27.–30.11.
  assert.equal(res.body.einsaetze, 1);
  assert.equal(res.body.abwesenheiten, 2);
  assert.equal(res.body.urlaubStunden, '11:30', 'bezahlte Abwesenheit gesamt (Urlaub + Krank), Feldname unverändert');
  assert.equal(res.body.krankStunden, '3:30');
  assert.equal(res.body.vorlaeufig, false);
  assert.deepEqual(res.body.ausgelassen, { abgesagt: 2, zukunft: 0 });
  assert.equal(log.patches.at(-1).Summe_Stunden, '13:30');
  assert.equal(log.upload.filename, 'Stundenzettel_2026-11_final.pdf');
  const texte = pdfTexte(Buffer.from(log.upload.file, 'base64'));
  assert.ok(texte.includes('Krank · 2 Einsätze abgesagt'));
  assert.ok(texte.some((z) => z.startsWith('Urlaub über den 26.11. hinaus: Die Tage ab 27.11. stehen auf dem Stundenzettel Dezember 2026')));
  assert.ok(!texte.includes('27.11.2026') && !texte.includes('28.11.2026') && !texte.includes('30.11.2026'), 'Tage nach dem Zeitraum stehen nicht als Zeilen drauf');
  const s = texte.indexOf('Monatssumme (bezahlt)');
  assert.deepEqual(texte.slice(s, s + 3), ['Monatssumme (bezahlt)', '13:30 Std.', '= Ist + Kunden-Anfahrt + Urlaub + Krank']);
});

// ================================================================ Wochendienstplan aller Mitarbeiter
const PERSONAL_WOCHE = [{ id: MA, fields: { Name: 'Erika M.', Aktiv: true } }, { id: 'recMaTestXXXXXXX2', fields: { Name: 'Otto B.', Aktiv: true } }];
const KW48 = wocheZuDatum('2026-11-25'); // 23.–29.11.2026
const woche = (besuche) => wu.baueWoche(besuche, PERSONAL_WOCHE, KW48, Date.parse(VORLAEUFIG));
const zeigen = (liste) => liste.map((e) => (e.art === 'abwesenheit' ? [e.grund, e.stundenMin] : [e.klient, e.status]));

test('Wochendienstplan: über den abgesagten Einsätzen der Kranken steht „Krank“ – ein Eintrag je Tag', async () => {
  const d = woche([
    einsatz('2026-11-23', '08:15', '10:15'),
    ausfall('2026-11-24', '08:00', '09:15'), ausfall('2026-11-24', '09:15', '10:15'), ausfall('2026-11-24', '10:30', '11:45'),
    ausfall('2026-11-25', '09:00', '12:00', 'Krank', std(3)),
    ausfall('2026-11-26', '08:30', '09:45'), zeile('2026-11-26', 'Krank'),               // eigene Zeile: kein zweiter Eintrag
    einsatz('2026-11-27', '08:00', '09:00', { Status: 'Abgesagt' }),                     // abgesagt ohne Auswahl
    einsatz('2026-11-24', '08:00', '09:00', { Pfleger_ID: ['recMaTestXXXXXXX2'] }),      // Kollege: unberührt
    ausfall('2026-11-27', '10:00', '11:00', 'Krank', { Pfleger_ID: ['recMaTestXXXXXXX2'] }), // Kollege am Freitag krank
  ]);
  const [erika, otto] = d.mitarbeiter;
  assert.equal(erika.name, 'Erika M.');
  assert.deepEqual(zeigen(erika.tage['2026-11-23']), [['Kurt Kunde', 'bestaetigt']]);
  assert.deepEqual(zeigen(erika.tage['2026-11-24']), [['Krank', null], ['Kurt Kunde', 'abgesagt'], ['Kurt Kunde', 'abgesagt'], ['Kurt Kunde', 'abgesagt']]);
  assert.deepEqual(zeigen(erika.tage['2026-11-25']), [['Krank', 180], ['Kurt Kunde', 'abgesagt']]);
  assert.deepEqual(zeigen(erika.tage['2026-11-26']), [['Krank', null], ['Kurt Kunde', 'abgesagt']]);
  assert.deepEqual(zeigen(erika.tage['2026-11-27']), [['Kurt Kunde', 'abgesagt']]);
  assert.deepEqual(zeigen(otto.tage['2026-11-24']), [['Kurt Kunde', 'bestaetigt']]);
  // jeder Krankheitstag steht beim richtigen Mitarbeiter – und nur dort
  assert.deepEqual(zeigen(otto.tage['2026-11-27']), [['Krank', null], ['Kurt Kunde', 'abgesagt']]);
  // der abgeleitete Eintrag hat denselben Aufbau wie eine eigene Zeile; Summe des Blatts unverändert
  assert.deepEqual(erika.tage['2026-11-24'][0], { art: 'abwesenheit', grund: 'Krank', notiz: '', stundenMin: null });
  assert.deepEqual(wu.summen(erika), { min: 120, offen: 0 });
  // im PDF steht „Krank“ an den drei Tagen
  const bytes = await wu.erstelleWochenuebersichtPdf({ ...d, stand: '25.11.2026, 18:21' });
  const texte = pdfTexte(bytes);
  assert.equal(texte.filter((t) => t === 'Krank').length, 4);
  assert.ok(texte.includes('3'), 'eingetragene Krank-Stunden stehen rechts');
});

test('Wochendienstplan: eine wieder abgesagte Abwesenheitszeile (z. B. abgelehnter Urlaub) steht nicht mehr als „Urlaub“ da', () => {
  const d = woche([
    zeile('2026-11-24', 'Urlaub', { Status: 'Abgesagt', ...std(8) }),
    zeile('2026-11-25', 'Urlaub', std(8)),
  ]);
  assert.deepEqual(Object.keys(d.mitarbeiter[0].tage), ['2026-11-25']);
  assert.deepEqual(zeigen(d.mitarbeiter[0].tage['2026-11-25']), [['Urlaub', 480]]);
  // nur abgesagte Abwesenheit in der Woche: keine Spalte
  assert.deepEqual(woche([zeile('2026-11-24', 'Urlaub', { Status: 'Abgesagt' })]).mitarbeiter, []);
});

// ================================================================ Monatslauf
function monatsSzenario({ aktiv = [], ausfaelle = [], zweiteAbfrage = 200 }) {
  const log = { erstellt: [], abfragen: [] };
  const p = airtableAttrappe(async (a) => {
    if (a.tabelle === PERSONAL) return antwort(200, { records: [MA, 'recMaTestXXXXXXX2', 'recMaTestXXXXXXX3'].map((x) => ({ id: x, fields: { Aktiv: true } })) });
    if (a.tabelle === BESUCHE) {
      log.abfragen.push(a);
      if (a.formel.includes("{Status} = 'Abgesagt'")) {
        if (zweiteAbfrage !== 200) return antwort(zweiteAbfrage, { error: { type: 'UNKNOWN_FIELD_NAME' } });
        return antwort(200, { records: ausfaelle });
      }
      return antwort(200, { records: aktiv });
    }
    if (a.tabelle === ZETTEL && a.methode === 'GET') return antwort(200, { records: [] });
    if (a.tabelle === ZETTEL && a.methode === 'POST') { log.erstellt.push(a.body.fields.Mitarbeiter[0]); return antwort(200, { id: 'recNeu' }); }
    return antwort(404, {});
  });
  return { p, log };
}
const cron = () => ({ method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} });

test('Monatslauf: wer im ganzen Zeitraum nur abgesagte Einsätze mit „Krank“ hat, bekommt trotzdem einen Zettel', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-27T03:00:00Z') });
  const { log } = monatsSzenario({
    aktiv: [{ id: 'recA1', fields: { Pfleger_ID: [MA], Datum: '2026-11-10' } }],
    ausfaelle: [
      { id: 'recK1', fields: { Pfleger_ID: ['recMaTestXXXXXXX2'], Datum: '2026-11-24', Status: 'Abgesagt', Patient: ['recKlientTest0001'], 'Abwesend/Urlaub': 'Krank' } },
      // zählt nicht: außerhalb des Zeitraums, abgesagte Zeile ohne Klient
      { id: 'recK2', fields: { Pfleger_ID: ['recMaTestXXXXXXX3'], Datum: '2026-11-27', Status: 'Abgesagt', Patient: ['recKlientTest0001'], 'Abwesend/Urlaub': 'Krank' } },
      { id: 'recK3', fields: { Pfleger_ID: ['recMaTestXXXXXXX3'], Datum: '2026-11-20', Status: 'Abgesagt', 'Abwesend/Urlaub': 'Urlaub' } },
    ],
  });
  const res = antwortObjekt();
  await monatslauf(cron(), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.monat, 'November 2026');
  assert.deepEqual(log.erstellt.sort(), [MA, 'recMaTestXXXXXXX2']);
  assert.equal(res.body.mitEinsatz, 2);
  // erste Abfrage unverändert, zweite nur abgesagte Zeilen mit Auswahl
  assert.equal(log.abfragen.length, 2);
  assert.equal(log.abfragen[0].formel, "AND(OR({Monat} = '2026-11'), {Status} != 'Abgesagt')");
  assert.deepEqual(log.abfragen[0].url.searchParams.getAll('fields[]').sort(), ['Datum', 'Pfleger_ID']);
  assert.equal(log.abfragen[1].formel, "AND(OR({Monat} = '2026-11'), {Status} = 'Abgesagt', ({Abwesend/Urlaub} & '') != '')");
  assert.deepEqual(log.abfragen[1].url.searchParams.getAll('fields[]').sort(), ['Abwesend/Urlaub', 'Datum', 'Patient', 'Patient_Name', 'Pfleger_ID', 'Status']);
});

test('Monatslauf: scheitert die zweite Abfrage, läuft er wie bisher weiter und meldet es – kein Abbruch', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-27T03:00:00Z') });
  const { log } = monatsSzenario({ aktiv: [{ id: 'recA1', fields: { Pfleger_ID: [MA], Datum: '2026-11-10' } }], zweiteAbfrage: 422 });
  const gemeldet = [];
  const original = console.error;
  console.error = (...args) => { gemeldet.push(args.map(String).join(' ')); };
  const res = antwortObjekt();
  try { await monatslauf(cron(), res); } finally { console.error = original; }
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'ok');
  assert.deepEqual(log.erstellt, [MA]);
  assert.ok(gemeldet.some((z) => z.includes('Abgesagte Einsätze mit Abwesenheit nicht lesbar')), 'Betreiber wird alarmiert');
});
