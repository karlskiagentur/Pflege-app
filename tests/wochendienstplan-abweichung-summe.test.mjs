// Wochendienstplan aller Mitarbeiter (Wünsche der Geschäftsleitung, 25.11.2026):
// 1. Hat die Mitarbeiterin eine andere Zeit bestätigt als geplant (z. B. 2 Std. bei 14.45–16.00), steht
//    die Zahl FETT da – wie auf dem Stundenzettel. So wundert sich niemand, dass Zahl und Zeitfenster
//    nicht zusammenpassen.
// 2. Vom Büro eingetragene Stunden für Urlaub und Krank stehen unter der Wochensumme und werden
//    dazugezählt („+ 24 Urlaub = 48 Std.“). Die Zeile „… Std. bestätigt“ bleibt die gearbeitete Zeit.
// 3. Gleitzeit zählt wie auf dem Stundenzettel nicht dazu – ihre Stunden stehen in Klammern.
// Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { pdfTexte, pdfStreams } from './_hilfen.mjs';

const wu = await import('../api/_wochenuebersicht.js');
const { wocheZuDatum } = await import('../api/_dienstplan.js');
const { pdfText, druckbreite } = await import('../api/_pdftext.js');
const { LOGO_BREITE, LOGO_HOEHE } = await import('../api/_logo.js');

const MA = 'recMaTestXXXXXXX1';
const MA2 = 'recMaTestXXXXXXX2';
const STD = 'Stunden Urlaub/Gleitzeit';
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
let lfd = 0;
const id = (art) => `rec${art}${String(++lfd).padStart(14 - art.length, '0')}`;
// Einsatz mit Klient. istStd: bestätigte Stunden; weggelassen = wie geplant; null = nicht bestätigt
const einsatz = (datum, von, bis, istStd, extra = {}) => {
  const f = { Datum: datum, Von: von, Bis: bis, Status: 'Bestätigt', Pfleger_ID: [MA], Patient: ['recKlientTest0001'], Patient_Name: ['Kurt Kunde'], ...extra };
  if (istStd !== null) f.Dauer_Ist = Math.round((istStd === undefined ? (min(bis) - min(von)) / 60 : istStd) * 3600);
  return { id: id('Ein'), fields: f };
};
const ausfall = (datum, von, bis, art = 'Krank', extra = {}) => einsatz(datum, von, bis, null, { Status: 'Abgesagt', 'Abwesend/Urlaub': art, ...extra });
const zeile = (datum, art, extra = {}) => ({ id: id('Abw'), fields: { Datum: datum, Status: 'Bestätigt', Pfleger_ID: [MA], 'Abwesend/Urlaub': art, ...extra } });
const std = (h) => ({ [STD]: Math.round(h * 3600) });

// KW 48/2026 (Mo 23.11. – So 29.11.), Stand Mi 25.11., 18:21 Uhr – wie auf dem Blatt der Meldung
const BEREICH = wocheZuDatum('2026-11-25');
const JETZT = Date.parse('2026-11-25T17:21:00Z');
const PERSONAL = [[MA, 'Erika M.'], [MA2, 'Otto B.']].map(([i, Name]) => ({ id: i, fields: { Name, Aktiv: true } }));
const woche = (besuche, personal = PERSONAL) => wu.baueWoche(besuche, personal, BEREICH, JETZT);
const pdf = (d) => wu.erstelleWochenuebersichtPdf({ ...d, stand: '25.11.2026, 18:21' });

// Alle Texte eines PDFs mit Schrift, Größe und Position (pdf-lib schreibt je Text einen Block BT … ET;
// Text als <HEX> in Windows-1252 – 0x80–0x9F über eine eigene Tabelle, wie in tests/_hilfen.mjs)
const CP1252_80_9F = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const cp1252 = (hex) => [...Buffer.from(hex, 'hex')].map((x) => (x >= 0x80 && x <= 0x9f ? CP1252_80_9F[x - 0x80] : String.fromCharCode(x))).join('');
function texteMitStil(bytes) {
  const liste = [];
  for (const inhalt of pdfStreams(bytes)) {
    for (const block of inhalt.matchAll(/BT\n([\s\S]*?)\nET/g)) {
      const b = block[1];
      const schrift = /\/(\S+) ([\d.]+) Tf/.exec(b);
      const ort = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/.exec(b);
      const text = /<([0-9A-Fa-f]*)> Tj/.exec(b);
      const farbe = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) rg/.exec(b);
      if (!schrift || !ort || !text) continue;
      liste.push({
        text: cp1252(text[1]), fett: /Bold/.test(schrift[1]), size: Number(schrift[2]), x: Number(ort[1]), y: Number(ort[2]),
        farbe: farbe ? farbe.slice(1, 4).map((z) => Math.round(Number(z) * 100) / 100).join(' ') : '',
      });
    }
  }
  return liste;
}

// Farben des Blatts (api/_wochenuebersicht.js)
const BLAU = '0.11 0.42 0.68';
const VIOLETT = '0.42 0.25 0.63';

// ================================================================ 1) abweichende Ist-Zeit
test('Meldung 25.11.: 2 Std. bestätigt bei 14.45–16.00 -> die Zahl ist fett; bestätigt wie geplant bleibt normal', () => {
  const d = woche([
    einsatz('2026-11-25', '08:30', '14:30'),          // 6 Std. geplant, 6 bestätigt
    einsatz('2026-11-25', '14:45', '16:00', 2),       // 1,25 geplant, 2 bestätigt (länger geblieben)
  ]);
  const [wieGeplant, laenger] = d.mitarbeiter[0].tage['2026-11-25'];
  assert.deepEqual([wieGeplant.planMin, wieGeplant.istMin, wieGeplant.status], [360, 360, 'bestaetigt']);
  assert.deepEqual([laenger.planMin, laenger.istMin, laenger.status], [75, 120, 'bestaetigt']);
  assert.equal(wu.istAbweichend(wieGeplant), false);
  assert.equal(wu.istAbweichend(laenger), true);
  assert.deepEqual(wu.eintragStil(wieGeplant), { farbe: 'blau', rechts: '6', fett: false, strich: '' });
  assert.deepEqual(wu.eintragStil(laenger), { farbe: 'blau', rechts: '2', fett: true, strich: '' });
  // die Summe zählt weiter die bestätigte Zeit (8 Std.), nicht die geplante
  assert.deepEqual(wu.summen(d.mitarbeiter[0]), { min: 480, offen: 0 });
  assert.equal(wu.hatAbweichung(d.mitarbeiter), true);
  assert.equal(wu.hatAbweichung([{ tage: { '2026-11-25': [wieGeplant] } }]), false);
});

test('Abweichung gilt im 15-Minuten-Takt wie auf dem Stundenzettel: 1:18 bei 1:15 ist keine, 1:23 schon; kürzer und bewusste 0 auch', () => {
  const d = woche([
    einsatz('2026-11-23', '08:00', '09:15', 78 / 60),   // 1:18 -> 1,25 = wie geplant
    einsatz('2026-11-23', '10:00', '11:15', 83 / 60),   // 1:23 -> 1,5
    einsatz('2026-11-24', '08:00', '11:00', 2.5),       // kürzer als geplant
    einsatz('2026-11-24', '12:00', '13:00', 0),         // bewusst 0 bestätigt (z. B. Klient nicht angetroffen)
  ]);
  const t = d.mitarbeiter[0].tage;
  assert.deepEqual(t['2026-11-23'].map((e) => [wu.eintragStil(e).rechts, wu.istAbweichend(e)]), [['1,25', false], ['1,5', true]]);
  assert.deepEqual(t['2026-11-24'].map((e) => [wu.eintragStil(e).rechts, wu.istAbweichend(e)]), [['2,5', true], ['0', true]]);
});

test('Nur ein bestätigter Einsatz kann abweichen: offen, geplant, abgesagt, „Abrechnen ohne Lohn“ und Abwesenheit nie; ohne geplante Dauer kein Vergleich', () => {
  const d = woche([
    einsatz('2026-11-23', '08:00', '09:00', null),                                   // vorbei, nicht bestätigt -> offen
    einsatz('2026-11-27', '08:00', '09:00', null, { Status: 'Geplant' }),            // Freitag: noch geplant
    einsatz('2026-11-24', '08:00', '09:00', 2, { Status: 'Abgesagt' }),              // abgesagt (mit alter Ist-Zeit)
    einsatz('2026-11-24', '10:00', '11:00', 2, { 'Abrechnen ohne Lohn': true }),     // geklärt, keine Arbeitszeit
    zeile('2026-11-25', 'Urlaub', std(8)),
  ]);
  const t = d.mitarbeiter[0].tage;
  const alle = Object.values(t).flat();
  assert.deepEqual(alle.map((e) => e.status || e.art).sort(), ['abgesagt', 'abwesenheit', 'geplant', 'offen', 'ohneLohn']);
  for (const e of alle) assert.equal(wu.istAbweichend(e), false, e.status || e.art);
  assert.equal(wu.hatAbweichung(d.mitarbeiter), false);
  // der geplante Einsatz zeigt wie bisher „0“ – nicht fett (eine bestätigte 0 dagegen schon, siehe oben)
  assert.deepEqual(wu.eintragStil(t['2026-11-27'][0]), { farbe: 'blau', rechts: '0', fett: false, strich: '' });
  // „Abrechnen ohne Lohn“ bleibt, wie es war: geplante Zeit mit *, fett, violett
  assert.deepEqual(wu.eintragStil(t['2026-11-24'].find((e) => e.status === 'ohneLohn')), { farbe: 'violett', rechts: '1*', fett: true, strich: '' });
  // geplante Dauer unbekannt (Altdaten ohne Bis und ohne Dauer_Soll): kein Vergleich, also nicht fett
  const e = { art: 'einsatz', status: 'bestaetigt', istMin: 90, planMin: null };
  assert.equal(wu.istAbweichend(e), false);
  assert.equal(wu.eintragStil(e).fett, false);
  // nichts davon wirft
  for (const x of [undefined, null, {}, 'x', 7, { art: 'einsatz' }, { art: 'einsatz', status: 'bestaetigt' }]) assert.equal(wu.istAbweichend(x), false);
  assert.equal(wu.hatAbweichung(undefined), false);
  assert.equal(wu.hatAbweichung([null, {}, { tage: null }]), false);
});

test('PDF: die abweichende Zahl ist fett gesetzt, alle übrigen Zahlen nicht; Klient und Zeitfenster bleiben normal', async () => {
  const d = woche([
    einsatz('2026-11-23', '08:00', '09:30'),                       // 1,5 wie geplant
    einsatz('2026-11-25', '08:30', '14:30'),                       // 6 wie geplant
    einsatz('2026-11-25', '14:45', '16:00', 2),                    // 2 statt 1,25
    einsatz('2026-11-26', '09:00', '11:30', null, { Status: 'Geplant' }),
  ]);
  const texte = texteMitStil(await pdf(d));
  const zahl = (t) => texte.filter((x) => x.text === t && x.size === 8.5);
  assert.deepEqual(zahl('2').map((x) => x.fett), [true], '2 Std. (statt 1,25) fett');
  assert.deepEqual(zahl('2').map((x) => x.farbe), [BLAU], 'weiter blau wie jede bestätigte Zeit');
  assert.deepEqual(zahl('6').map((x) => x.fett), [false]);
  assert.deepEqual(zahl('1,5').map((x) => x.fett), [false]);
  assert.deepEqual(zahl('0').map((x) => x.fett), [false], 'geplanter Einsatz bleibt normal');
  const klient = texte.filter((x) => x.text.startsWith('Kurt Kunde '));
  assert.equal(klient.length, 4);
  assert.ok(klient.every((x) => !x.fett), 'nur die Zahl ist fett');
  // die fette Zahl steht rechtsbündig an derselben Kante wie die normalen
  const rechteKante = (x, schrift) => x.x + schrift.widthOfTextAtSize(x.text, 8.5);
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  assert.ok(Math.abs(rechteKante(zahl('2')[0], fett) - rechteKante(zahl('6')[0], normal)) < 0.01);
});

// ================================================================ 2) Legende
test('Legende: der Zusatz „fett = …“ steht nur auf Seiten mit abweichender Ist-Zeit', async () => {
  // fünf Mitarbeiter -> zwei Seiten; nur auf Seite 1 weicht eine Zeit ab
  const personal = ['A', 'B', 'C', 'D', 'E'].map((b, i) => ({ id: `recMaTestXXXXXXX${i + 1}`, fields: { Name: `${b}-Muster M.`, Aktiv: true } }));
  const besuche = personal.map((p, i) => einsatz('2026-11-23', '08:00', '09:15', i === 0 ? 2 : undefined, { Pfleger_ID: [p.id] }));
  const d = woche(besuche, personal);
  const texte = pdfTexte(await pdf(d));
  assert.equal(wu.LEGENDE_ABWEICHUNG, '  ·  fett = Ist-Zeit weicht vom Plan ab');
  assert.equal(pdfText(wu.LEGENDE_ABWEICHUNG), wu.LEGENDE_ABWEICHUNG);
  assert.equal(texte.filter((t) => t === wu.LEGENDE + wu.LEGENDE_ABWEICHUNG).length, 1, 'Seite 1 mit Zusatz');
  assert.equal(texte.filter((t) => t === wu.LEGENDE).length, 1, 'Seite 2 wie bisher');
});

test('Legende: eine Zeile, solange alles passt; abweichende Zeit UND * auf einer Seite -> der Zusatz zum * steht in einer zweiten Zeile', async () => {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const breite = (t) => druckbreite(pdfText(t), normal, 7.5);
  const platz = 841.89 - 2 * 26 - 16 * (LOGO_BREITE / LOGO_HOEHE) - 6; // wie im PDF: Breite ohne Ränder und Logo
  const z = (abweichung, ohneLohn, p = platz) => wu.legendeZeilen({ abweichung, ohneLohn }, breite, p);
  assert.deepEqual(z(false, false), [wu.LEGENDE]);
  assert.deepEqual(z(false, true), [wu.LEGENDE + wu.LEGENDE_OHNE_LOHN], 'wie bisher in einer Zeile');
  assert.deepEqual(z(true, false), [wu.LEGENDE + wu.LEGENDE_ABWEICHUNG]);
  assert.deepEqual(z(true, true), [wu.LEGENDE + wu.LEGENDE_ABWEICHUNG, '* = Abrechnen ohne Lohn: geplante Zeit abrechnen, zählt nicht']);
  // nichts ragt über den Platz
  for (const zeilen of [z(false, false), z(false, true), z(true, false), z(true, true)]) {
    for (const t of zeilen) assert.ok(breite(t) <= platz, `${breite(t).toFixed(1)} > ${platz.toFixed(1)}: ${t.slice(-40)}`);
  }
  // wäre genug Platz, bliebe auch beides in einer Zeile
  assert.deepEqual(z(true, true, 2000), [wu.LEGENDE + wu.LEGENDE_ABWEICHUNG + wu.LEGENDE_OHNE_LOHN]);
  assert.deepEqual(wu.legendeZeilen(undefined, breite, platz), [wu.LEGENDE]);

  // im PDF: zwei Zeilen Legende, die Vertraulichkeitszeile rückt eine Zeile tiefer – und bleibt über dem unteren Rand
  const d = woche([
    einsatz('2026-11-23', '09:00', '10:15', 1.75),
    einsatz('2026-11-24', '13:45', '15:00', null, { Status: 'Abgesagt', 'Abrechnen ohne Lohn': true }),
  ]);
  const texte = texteMitStil(await pdf(d));
  const zeile1 = texte.find((t) => t.text.startsWith('Zahl rechts = '));
  const zeile2 = texte.find((t) => t.text.startsWith('* = Abrechnen ohne Lohn'));
  const vertraulich = texte.find((t) => t.text.startsWith('Vertraulich'));
  assert.ok(zeile1 && zeile2 && vertraulich);
  assert.ok(zeile1.text.endsWith('fett = Ist-Zeit weicht vom Plan ab'));
  assert.ok(Math.abs((zeile1.y - zeile2.y) - 11) < 0.01 && Math.abs((zeile2.y - vertraulich.y) - 11) < 0.01, 'drei Zeilen im Abstand von 11 pt');
  assert.ok(vertraulich.y >= 26 + 6, `Fußzeile zu tief: ${vertraulich.y}`);
  // ohne * (nur Abweichung): zwei Fußzeilen an der bisherigen Stelle
  const ohne = texteMitStil(await pdf(woche([einsatz('2026-11-23', '09:00', '10:15', 1.75)])));
  const v2 = ohne.find((t) => t.text.startsWith('Vertraulich'));
  const l2 = ohne.find((t) => t.text.startsWith('Zahl rechts = '));
  assert.ok(Math.abs((l2.y - v2.y) - 11) < 0.01);
  assert.ok(Math.abs(v2.y - (vertraulich.y)) < 0.01, 'die unterste Zeile steht immer auf derselben Höhe über dem Rand');
});

// ================================================================ 3) Wochensumme mit Abwesenheitsstunden
test('Meldung 25.11.: drei Urlaubstage mit je 8 Std. -> unter „24 Std. bestätigt“ steht „+ 24 Urlaub = 48 Std.“', async () => {
  const d = woche([
    einsatz('2026-11-23', '08:00', '16:00'), einsatz('2026-11-24', '08:00', '16:00'), einsatz('2026-11-25', '08:00', '16:00'),
    zeile('2026-11-26', 'Urlaub', std(8)), zeile('2026-11-27', 'Urlaub', std(8)), zeile('2026-11-28', 'Urlaub', std(8)),
  ]);
  const ma = d.mitarbeiter[0];
  assert.deepEqual(wu.summen(ma), { min: 1440, offen: 0 }, '„bestätigt“ bleibt die gearbeitete Zeit');
  assert.deepEqual(wu.summeAbwesenheit(ma), { min: 1440, teile: [{ art: 'Urlaub', min: 1440 }] });
  assert.equal(wu.abwesenheitSummenText(ma), '+ 24 Urlaub = 48 Std.');
  assert.deepEqual(wu.summenZusatz(ma), [{ text: '+ 24 Urlaub = 48 Std.', farbe: 'blau' }]);
  const texte = texteMitStil(await pdf(d));
  const bestaetigt = texte.find((t) => t.text === '24 Std. bestätigt');
  const zusatz = texte.find((t) => t.text === '+ 24 Urlaub = 48 Std.');
  assert.ok(bestaetigt && zusatz, 'beide Zeilen stehen im PDF');
  assert.ok(zusatz.fett && zusatz.size === 9);
  assert.ok(Math.abs((bestaetigt.y - zusatz.y) - 12) < 0.01, 'direkt unter der Summe');
  // rechtsbündig an derselben Kante
  const doc = await PDFDocument.create();
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  assert.ok(Math.abs((bestaetigt.x + fett.widthOfTextAtSize(bestaetigt.text, 9.5)) - (zusatz.x + fett.widthOfTextAtSize(zusatz.text, 9))) < 0.01);
});

test('Wochensumme: Krank zählt nur mit eingetragenen Stunden (eigene Zeile oder abgesagte Einsätze); Gleitzeit, Abwesend und Urlaub ohne Stunden nie', () => {
  const d = woche([
    einsatz('2026-11-23', '08:00', '16:00', 7.5),
    ausfall('2026-11-24', '08:00', '12:00', 'Krank', std(5)), ausfall('2026-11-24', '13:00', '16:00', 'Krank', std(3)), // 8 Std. an zwei abgesagten Einsätzen
    zeile('2026-11-25', 'Krank', std(8)),                                 // eigene Zeile mit Stunden
    zeile('2026-11-26', 'Urlaub', std(7.7)),                              // 7:42
    zeile('2026-11-27', 'Gleitzeit', std(6)),                             // Zeitkonto: zählt nicht
    zeile('2026-11-28', 'Abwesend', std(4)),                              // nie Stunden
    // Kollege: Minijob krank (ohne Stunden), Urlaub ohne Stunden und mit 0:00, abgesagter Urlaub mit Stunden
    ausfall('2026-11-24', '09:00', '10:00', 'Krank', { Pfleger_ID: [MA2] }),
    zeile('2026-11-25', 'Urlaub', { Pfleger_ID: [MA2] }),
    zeile('2026-11-26', 'Urlaub', { Pfleger_ID: [MA2], ...std(0) }),
    zeile('2026-11-27', 'Urlaub', { Pfleger_ID: [MA2], Status: 'Abgesagt', ...std(8) }),
    einsatz('2026-11-23', '08:00', '10:00', undefined, { Pfleger_ID: [MA2] }),
  ]);
  const [erika, otto] = d.mitarbeiter;
  assert.deepEqual(wu.summeAbwesenheit(erika), { min: 462 + 960, teile: [{ art: 'Urlaub', min: 462 }, { art: 'Krank', min: 960 }] });
  // Reihenfolge wie auf dem Stundenzettel: Urlaub vor Krank; Gesamt = 7,5 + 7,7 + 16 = 31,2
  assert.equal(wu.abwesenheitSummenText(erika), '+ 7,7 Urlaub + 16 Krank = 31,2 Std.');
  assert.deepEqual(wu.summen(erika), { min: 450, offen: 0 });
  // Kollege: nichts zu zählen -> keine Zusatzzeile, Summe wie bisher
  assert.deepEqual(wu.summeAbwesenheit(otto), { min: 0, teile: [] });
  assert.equal(wu.abwesenheitSummenText(otto), '');
  assert.deepEqual(wu.summenZusatz(otto), []);
  assert.deepEqual(wu.summen(otto), { min: 120, offen: 0 });
  // nichts davon wirft
  for (const x of [undefined, null, {}, { tage: null }, { tage: { a: [null, 7, {}] } }]) {
    assert.deepEqual(wu.summeAbwesenheit(x), { min: 0, teile: [] });
    assert.equal(wu.abwesenheitSummenText(x), '');
  }
});

test('Gleitzeit-Stunden stehen in Klammern (zählen nicht), Urlaub und Krank als Zahl; ohne Stunden steht nur die Art da', async () => {
  const a = (grund, stundenMin) => ({ art: 'abwesenheit', grund, stundenMin });
  assert.equal(wu.abwesenheitAnzeige(a('Urlaub', 480)), '8');
  assert.equal(wu.abwesenheitAnzeige(a('Krank', 210)), '3,5');
  assert.equal(wu.abwesenheitAnzeige(a('Gleitzeit', 360)), '(6)');
  assert.equal(wu.abwesenheitAnzeige(a('Gleitzeit', 462)), '(7,7)');
  for (const leer of [a('Urlaub', null), a('Urlaub', 0), a('Krank', null), a('Abwesend', null), a('Gleitzeit', undefined), null, undefined, {}]) {
    assert.equal(wu.abwesenheitAnzeige(leer), '');
  }
  const d = woche([zeile('2026-11-23', 'Urlaub', std(8)), zeile('2026-11-24', 'Gleitzeit', std(6)), zeile('2026-11-25', 'Krank')]);
  const texte = texteMitStil(await pdf(d));
  assert.ok(texte.some((t) => t.text === '8' && t.fett));
  assert.ok(texte.some((t) => t.text === '(6)' && t.fett));
  assert.ok(!texte.some((t) => t.text === '6'), 'Gleitzeit nie ohne Klammern');
  // in der Wochensumme steht nur der Urlaub
  assert.ok(texte.some((t) => t.text === '+ 8 Urlaub = 8 Std.'));
});

test('Summenblock: Zusatzzeilen direkt unter der Summe – erst Abwesenheit (blau), dann „* abrechnen ohne Lohn“ (violett); Höhe nach der längsten Spalte', async () => {
  const d = woche([
    // Erika: Urlaub UND ein Einsatz „Abrechnen ohne Lohn“ -> zwei Zusatzzeilen
    einsatz('2026-11-23', '08:00', '16:00'),
    zeile('2026-11-24', 'Urlaub', std(8)),
    einsatz('2026-11-25', '13:45', '15:00', null, { 'Abrechnen ohne Lohn': true }),
    // Otto: nur „Abrechnen ohne Lohn“ -> eine Zusatzzeile, direkt unter seiner Summe
    einsatz('2026-11-23', '08:00', '10:00', undefined, { Pfleger_ID: [MA2] }),
    einsatz('2026-11-24', '10:00', '11:00', null, { Pfleger_ID: [MA2], Status: 'Abgesagt', 'Abrechnen ohne Lohn': true }),
  ]);
  const [erika, otto] = d.mitarbeiter;
  assert.deepEqual(wu.summenZusatz(erika), [
    { text: '+ 8 Urlaub = 16 Std.', farbe: 'blau' },
    { text: '* abrechnen ohne Lohn: 1,25 Std.', farbe: 'violett' },
  ]);
  assert.deepEqual(wu.summenZusatz(otto), [{ text: '* abrechnen ohne Lohn: 1 Std.', farbe: 'violett' }]);
  const texte = texteMitStil(await pdf(d));
  const y = (t) => texte.find((x) => x.text === t).y;
  const summeErika = y('8 Std. bestätigt');
  const summeOtto = y('2 Std. bestätigt');
  assert.ok(Math.abs(summeErika - summeOtto) < 0.01);
  assert.ok(Math.abs((summeErika - y('+ 8 Urlaub = 16 Std.')) - 12) < 0.01);
  assert.ok(Math.abs((summeErika - y('* abrechnen ohne Lohn: 1,25 Std.')) - 24) < 0.01);
  assert.ok(Math.abs((summeOtto - y('* abrechnen ohne Lohn: 1 Std.')) - 12) < 0.01, 'ohne Leerzeile');
  const farbe = (t) => texte.find((x) => x.text === t).farbe;
  assert.equal(farbe('+ 8 Urlaub = 16 Std.'), BLAU);
  assert.equal(farbe('* abrechnen ohne Lohn: 1,25 Std.'), VIOLETT);
  assert.equal(farbe('* abrechnen ohne Lohn: 1 Std.'), VIOLETT);
  // alle Zusatzzeilen liegen über der unteren Tabellenlinie (Summe + 2 Zeilen = 46 pt hoch)
  const legende = texte.find((t) => t.text.startsWith('Zahl rechts = '));
  assert.ok(y('* abrechnen ohne Lohn: 1,25 Std.') > legende.y + 13, 'Zusatzzeile über der Tabellenunterkante');
});

test('Sehr viele Stunden: die Zusatzzeile wird kleiner, nie breiter als die Spalte', async () => {
  const doc = await PDFDocument.create();
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const spalte = (841.89 - 2 * 26 - 78) / 4 - 12;
  // üblich: passt mit 9 pt
  for (const t of ['+ 24 Urlaub = 48 Std.', '+ 8 Urlaub + 16 Krank = 48 Std.', '+ 40 Urlaub + 40 Krank = 119,75 Std.']) {
    assert.equal(wu.passendeGroesse(t, fett, 9, spalte), 9, t);
    assert.ok(druckbreite(t, fett, 9) <= spalte);
  }
  // Tippfehler-Woche (jeden Tag 24 Std. Urlaub und 23,75 Std. Krank): kleiner, aber in der Spalte
  const d = woche(BEREICH.tage.flatMap((tag) => [zeile(tag, 'Urlaub', std(24)), zeile(tag, 'Krank', std(23.75))]));
  const text = wu.abwesenheitSummenText(d.mitarbeiter[0]);
  assert.equal(text, '+ 168 Urlaub + 166,25 Krank = 334,25 Std.');
  const gr = wu.passendeGroesse(text, fett, 9, spalte);
  assert.ok(gr < 9 && gr >= 6.5, String(gr));
  assert.ok(druckbreite(text, fett, gr) <= spalte);
  const imPdf = texteMitStil(await pdf(d)).find((t) => t.text === text);
  assert.ok(imPdf && imPdf.size === gr, 'im PDF mit der passenden Größe, ungekürzt');
  // nie kleiner als 6,5 pt (dann kürzt der Renderer mit „…“)
  assert.equal(wu.passendeGroesse('x'.repeat(400), fett, 9, spalte), 6.5);
  assert.equal(wu.passendeGroesse('', fett, 9, spalte), 9);
});

// ================================================================ 4) alles andere bleibt
test('Ohne abweichende Zeit und ohne Abwesenheitsstunden bleibt das Blatt, wie es war: Einträge, Summe, Legende, Fußzeilen', async () => {
  const d = woche([
    einsatz('2026-11-23', '08:00', '09:30'),
    einsatz('2026-11-24', '08:00', '09:00', null),                             // offen
    einsatz('2026-11-24', '10:00', '11:00', null, { Status: 'Abgesagt' }),     // abgesagt
    zeile('2026-11-25', 'Krank'),                                              // Minijob: nur der Tag
    einsatz('2026-11-27', '08:00', '09:00', null, { Status: 'Geplant' }),
  ]);
  const ma = d.mitarbeiter[0];
  // Aufbau der Einträge unverändert (keine neuen Felder)
  assert.deepEqual(Object.keys(ma.tage['2026-11-23'][0]), ['art', 'klient', 'von', 'bis', 'istMin', 'planMin', 'status', 'markiert']);
  assert.deepEqual(Object.keys(ma.tage['2026-11-25'][0]), ['art', 'grund', 'notiz', 'stundenMin']);
  assert.deepEqual(wu.summen(ma), { min: 90, offen: 2 });
  assert.deepEqual(wu.summenZusatz(ma), []);
  assert.equal(wu.hatAbweichung(d.mitarbeiter), false);
  const texte = texteMitStil(await pdf(d));
  assert.deepEqual(texte.filter((t) => t.text.startsWith('Zahl rechts = ')).map((t) => t.text), [wu.LEGENDE]);
  assert.ok(!texte.some((t) => /^\+ /.test(t.text)), 'keine Zusatzzeile in der Summe');
  assert.ok(!texte.some((t) => t.size === 8.5 && t.fett), 'keine fette Zahl');
  const legende = texte.find((t) => t.text === wu.LEGENDE);
  const vertraulich = texte.find((t) => t.text.startsWith('Vertraulich'));
  assert.ok(Math.abs((legende.y - vertraulich.y) - 11) < 0.01);
  // feste Texte der Legende bleiben wörtlich
  assert.equal(wu.LEGENDE, 'Zahl rechts = bestätigte Ist-Zeit in Stunden  ·  offen = nicht bestätigt, zählt nicht  ·  durchgestrichen = abgesagt  ·  gelb = Zusatz/Änderung des Büros');
  assert.equal(wu.LEGENDE_OHNE_LOHN, '  ·  * = Abrechnen ohne Lohn: geplante Zeit abrechnen, zählt nicht');
});
