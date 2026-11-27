// Kunden-Anfahrt: ab 1 Stunde zwischen zwei Einsätzen keine Anfahrt (Meldung Geschäftsleitung 27.11.2026).
// Bisher (Vorgabe Karl 28.10.2026): Lücke bis 30 Min ganz bezahlt, darüber 30 Min Anfahrt + Rest Pause.
// Dazu kommt: Liegt 1 Stunde oder mehr zwischen dem Ende eines Einsatzes (laut Ist) und dem Beginn des
// nächsten, wird keine Anfahrt berechnet – die ganze Lücke ist unbezahlte Pause. Alles andere bleibt.
// Alle Daten frei erfunden; nur die Uhrzeiten der beiden Fälle stammen aus der Meldung. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { airtableAttrappe, antwort, antwortObjekt, pdfTexte } from './_hilfen.mjs';

process.env.STUNDENZETTEL_SECRET = 'test-secret-1234567890';
process.env.AIRTABLE_TOKEN = 'test-key';

const { berechneZeitnachweis, hm, takt, ANFAHRT_MAX_MIN, ANFAHRT_KEINE_AB_MIN } = await import('../api/_zeitkonto.js');
const { abrechnungszeitraum } = await import('../api/_abrechnung.js');
const sz = await import('../api/stundenzettel.js');
const stundenzettel = sz.default;

const ZETTEL = 'tblmlg9ZNrtwRxmXx', PERSONAL = 'tbl3pMfhOLYPsQ5jF', BESUCHE = 'tblXJOSz4LaJCG10M';
const MA = 'recMaTestXXXXXXX1';
const HAKEN = 'Abrechnen ohne Lohn';
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const uhr = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

let lfd = 0;
// Bestätigter Einsatz mit Klient (Ist = Zeitfenster, wenn nichts anderes angegeben ist)
const einsatz = (datum, von, bis, extra = {}) => ({
  id: `recEin${String(++lfd).padStart(11, '0')}`,
  fields: {
    Datum: datum, Monat: datum.slice(0, 7), Von: von, Bis: bis, Status: 'Bestätigt', Pfleger_ID: [MA],
    Patient: ['recKlientTest0001'], Patient_Name: ['Kurt Kunde'], Dauer_Ist: (min(bis) - min(von)) * 60, ...extra,
  },
});
const klient = (name) => ({ Patient_Name: [name] });
// „Jetzt“ nach dem Ende des Zeitraums November 2026 (01.11.–26.11.): alles ist vorbei
const FINAL = '2026-11-27T03:00:00Z';
const kurz = (tag) => tag.zeilen.map((z) => `${z.art}:${z.von}-${z.bis}=${hm(z.min)}`);
const zwischen = (tag) => kurz(tag).filter((s) => !s.startsWith('einsatz'));

test('Die beiden Grenzen stehen als Konstanten da: bis 30 Minuten ganz Anfahrt, ab 60 Minuten keine', () => {
  assert.equal(ANFAHRT_MAX_MIN, 30);
  assert.equal(ANFAHRT_KEINE_AB_MIN, 60);
});

test('Meldung 27.11., Fall 1: 10:15–11:30 und 15:00–16:15 (Lücke 3:30) -> keine Kunden-Anfahrt, 3:30 Pause', () => {
  const n = berechneZeitnachweis([
    einsatz('2026-11-25', '10:15', '11:30'),
    einsatz('2026-11-25', '15:00', '16:15', klient('Lina Probe')),
  ], { jetzt: FINAL });
  const tag = n.tage[0];
  assert.deepEqual(kurz(tag), ['einsatz:10:15-11:30=1:15', 'pause:11:30-15:00=3:30', 'einsatz:15:00-16:15=1:15']);
  assert.equal(hm(tag.anfahrtMin), '0:00');
  assert.equal(hm(tag.pauseMin), '3:30');
  assert.equal(hm(tag.bezahltMin), '2:30'); // bis 26.11.2026: 3:00 (3:00 Pause + 0:30 Anfahrt)
  assert.equal(hm(n.summen.anfahrtMin), '0:00');
  assert.equal(hm(n.summen.bezahltMin), '2:30');
  assert.equal(hm(n.summen.sollMin), '2:30');
  // so steht es auf dem Zettel: eine Pause-Zeile über die ganze Lücke, keine Zeile „Kunden-Anfahrt“
  assert.deepEqual(sz.tagesZeilen(tag).map((z) => [z.art, z.fenster, z.ist, z.klient]), [
    ['einsatz', '10:15 – 11:30', '1:15', 'Kurt Kunde'],
    ['pause', '11:30 – 15:00', '(3:30)', 'Pause (unbezahlt)'],
    ['einsatz', '15:00 – 16:15', '1:15', 'Lina Probe'],
  ]);
  assert.equal(sz.tagesSummeText(tag), 'Tagessumme · Pause 3:30 unbezahlt');
});

test('Meldung 27.11., Fall 2: der Einsatz dazwischen ist abgesagt (08:30–09:45, 12:15–13:15) -> Lücke 2:30, keine Anfahrt', () => {
  const erster = einsatz('2026-11-26', '08:30', '09:45');
  const letzter = einsatz('2026-11-26', '12:15', '13:15', klient('Lina Probe'));
  // abgesagt und „Abrechnen ohne Lohn“, obwohl in der App schon 2:00 bestätigt waren – zählt nie
  const abgesagt = einsatz('2026-11-26', '10:00', '12:00', { ...klient('Otto Beispiel'), Status: 'Abgesagt', [HAKEN]: true });
  const n = berechneZeitnachweis([erster, abgesagt, letzter], { jetzt: FINAL });
  assert.deepEqual(kurz(n.tage[0]), ['einsatz:08:30-09:45=1:15', 'pause:09:45-12:15=2:30', 'einsatz:12:15-13:15=1:00']);
  assert.equal(hm(n.tage[0].bezahltMin), '2:15'); // bis 26.11.2026: 2:45 (2:00 Pause + 0:30 Anfahrt)
  assert.equal(hm(n.summen.anfahrtMin), '0:00');
  assert.equal(hm(n.summen.pauseMin), '2:30');
  assert.deepEqual(n.ausgelassen, { abgesagt: 1, zukunft: 0 });
  assert.equal(sz.tagesSummeText(n.tage[0]), 'Tagessumme · Pause 2:30 unbezahlt');
  // Gegenprobe: Findet der Einsatz statt, sind es zwei kurze Lücken – beide bezahlt wie bisher
  const mit = berechneZeitnachweis([erster, einsatz('2026-11-26', '10:00', '12:00', klient('Otto Beispiel')), letzter], { jetzt: FINAL });
  assert.deepEqual(zwischen(mit.tage[0]), ['anfahrt:09:45-10:00=0:15', 'anfahrt:12:00-12:15=0:15']);
  assert.equal(hm(mit.summen.bezahltMin), '4:45'); // 1:15 + 2:00 + 1:00 + 0:30 Anfahrt
  assert.equal(mit.summen.pauseMin, 0);
});

test('Grenzen in Viertelstunden: bis 0:30 ganz Anfahrt · 0:45 = 0:30 Anfahrt + 0:15 Pause · ab 1:00 nur Pause', () => {
  const erwartet = {
    15: ['anfahrt:09:00-09:15=0:15'],
    30: ['anfahrt:09:00-09:30=0:30'],
    45: ['pause:09:00-09:15=0:15', 'anfahrt:09:15-09:45=0:30'],
    60: ['pause:09:00-10:00=1:00'],
    75: ['pause:09:00-10:15=1:15'],
    90: ['pause:09:00-10:30=1:30'],
    150: ['pause:09:00-11:30=2:30'],
    210: ['pause:09:00-12:30=3:30'],
    480: ['pause:09:00-17:00=8:00'],
  };
  for (const [l, zeilen] of Object.entries(erwartet)) {
    const luecke = Number(l);
    const n = berechneZeitnachweis([
      einsatz('2026-11-10', '08:00', '09:00'),
      einsatz('2026-11-10', uhr(9 * 60 + luecke), uhr(10 * 60 + luecke)),
    ], { jetzt: FINAL });
    assert.deepEqual(zwischen(n.tage[0]), zeilen, `Lücke ${hm(luecke)}`);
    const anfahrt = luecke >= 60 ? 0 : Math.min(luecke, 30);
    assert.equal(n.summen.anfahrtMin, anfahrt, `Lücke ${hm(luecke)}: Anfahrt`);
    assert.equal(n.summen.pauseMin, luecke - anfahrt, `Lücke ${hm(luecke)}: Pause`);
    assert.equal(n.summen.bezahltMin, 120 + anfahrt, `Lücke ${hm(luecke)}: bezahlt = 2 Einsätze + Anfahrt`);
  }
});

test('Grenze minutengenau: 59 Minuten wie bisher (0:30 Anfahrt), genau 60 Minuten keine Anfahrt', () => {
  const fall = (von2) => berechneZeitnachweis([
    einsatz('2026-11-10', '08:00', '09:00'),
    einsatz('2026-11-10', von2, '12:00', { Dauer_Ist: 3600 }),
  ], { jetzt: FINAL }).tage[0];
  // 59 Minuten: unter 1 Stunde – im 15-Minuten-Takt 1:00 = 0:30 Pause + 0:30 Anfahrt (unverändert)
  assert.deepEqual(zwischen(fall('09:59')), ['pause:09:00-09:29=0:30', 'anfahrt:09:29-09:59=0:30']);
  assert.equal(fall('09:59').anfahrtMin, 30);
  // 60 Minuten: „ab 1 Stunde“ – keine Anfahrt
  assert.deepEqual(zwischen(fall('10:00')), ['pause:09:00-10:00=1:00']);
  assert.equal(fall('10:00').anfahrtMin, 0);
  // 61 und 68 Minuten: keine Anfahrt, die Pause steht im 15-Minuten-Takt da
  assert.deepEqual(zwischen(fall('10:01')), ['pause:09:00-10:01=1:00']);
  assert.deepEqual(zwischen(fall('10:08')), ['pause:09:00-10:08=1:15']);
  for (const von2 of ['10:00', '10:01', '10:08']) assert.equal(fall(von2).bezahltMin, 120, `${von2}: nur die beiden Einsätze`);
});

test('Die Lücke rechnet ab dem Ende laut Ist: früher fertig kann die Anfahrt kosten, länger geblieben bringt sie zurück', () => {
  // geplant 08:00–09:30 und 10:00–11:00 (Lücke 0:30) – wie geplant: 0:30 Anfahrt
  const wieGeplant = berechneZeitnachweis([
    einsatz('2026-11-12', '08:00', '09:30'), einsatz('2026-11-12', '10:00', '11:00'),
  ], { jetzt: FINAL });
  assert.deepEqual(zwischen(wieGeplant.tage[0]), ['anfahrt:09:30-10:00=0:30']);
  assert.equal(hm(wieGeplant.summen.bezahltMin), '3:00');
  // erster Einsatz nur 1:00 bestätigt -> Ende laut Ist 09:00, Lücke 1:00 -> keine Anfahrt
  const frueher = berechneZeitnachweis([
    einsatz('2026-11-12', '08:00', '09:30', { Dauer_Ist: 3600 }), einsatz('2026-11-12', '10:00', '11:00'),
  ], { jetzt: FINAL });
  assert.deepEqual(kurz(frueher.tage[0]), ['einsatz:08:00-09:30=1:00', 'pause:09:00-10:00=1:00', 'einsatz:10:00-11:00=1:00']);
  assert.equal(hm(frueher.summen.bezahltMin), '2:00');
  // geplante Lücke 1:15, erster Einsatz 0:30 länger -> Lücke laut Ist 0:45 -> 0:15 Pause + 0:30 Anfahrt
  const laenger = berechneZeitnachweis([
    einsatz('2026-11-12', '08:00', '09:00', { Dauer_Ist: 5400 }), einsatz('2026-11-12', '10:15', '11:15'),
  ], { jetzt: FINAL });
  assert.deepEqual(zwischen(laenger.tage[0]), ['pause:09:30-09:45=0:15', 'anfahrt:09:45-10:15=0:30']);
  assert.equal(hm(laenger.summen.bezahltMin), '3:00'); // 1:30 + 1:00 + 0:30
});

test('Mehrere Lücken an einem Tag: jede für sich – die kurzen sind bezahlt, die lange nicht', () => {
  const n = berechneZeitnachweis([
    einsatz('2026-11-13', '08:00', '09:00'),
    einsatz('2026-11-13', '09:15', '10:00'), // Lücke 0:15 -> Anfahrt 0:15
    einsatz('2026-11-13', '10:45', '11:30'), // Lücke 0:45 -> 0:15 Pause + 0:30 Anfahrt
    einsatz('2026-11-13', '14:00', '15:00'), // Lücke 2:30 -> nur Pause
    einsatz('2026-11-13', '15:30', '16:00'), // Lücke 0:30 -> Anfahrt 0:30
  ], { jetzt: FINAL });
  assert.deepEqual(zwischen(n.tage[0]), [
    'anfahrt:09:00-09:15=0:15',
    'pause:10:00-10:15=0:15', 'anfahrt:10:15-10:45=0:30',
    'pause:11:30-14:00=2:30',
    'anfahrt:15:00-15:30=0:30',
  ]);
  assert.equal(hm(n.summen.einsatzMin), '4:00');
  assert.equal(hm(n.summen.anfahrtMin), '1:15');
  assert.equal(hm(n.summen.pauseMin), '2:45');
  assert.equal(hm(n.summen.bezahltMin), '5:15');
  assert.equal(sz.tagesSummeText(n.tage[0]), 'Tagessumme · davon Anfahrt 1:15 · Pause 2:45 unbezahlt');
});

test('400 Zufallstage: jede Lücke folgt der Regel, nie eine Anfahrt ab 1 Stunde, die Summe stimmt', () => {
  // kleiner fester Zufallsgenerator (mulberry32) – der Test läuft jedes Mal gleich
  let s = 20261127;
  const zufall = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const aus = (liste) => liste[Math.floor(zufall() * liste.length)];
  let langeLuecken = 0, kurzeLuecken = 0;
  for (let lauf = 0; lauf < 400; lauf++) {
    // 2–6 Einsätze im Viertelstunden-Raster, alle am selben Tag (Ende spätestens 22:00 Uhr);
    // Ist weicht manchmal vom Plan ab
    const anzahl = 2 + Math.floor(zufall() * 5);
    const einsaetze = [];
    let start = 7 * 60 + 15 * Math.floor(zufall() * 6);
    for (let i = 0; i < anzahl; i++) {
      const plan = aus([30, 45, 60, 75, 90, 120]);
      if (i >= 2 && start + plan > 22 * 60) break;
      const ist = Math.max(0, plan + aus([0, 0, 0, 0, -15, -30, 15, 30]));
      einsaetze.push({ start, plan, ist });
      start += plan + aus([0, 15, 15, 30, 30, 45, 45, 60, 75, 90, 120, 180, 240]);
    }
    const n = berechneZeitnachweis(einsaetze.map((e) => einsatz('2026-11-17', uhr(e.start), uhr(e.start + e.plan), { Dauer_Ist: e.ist * 60 })), { jetzt: FINAL });
    // unabhängig nachgerechnet: Zeitachse laut Ist, je Lücke die Regel
    let ende = null, anfahrt = 0, pause = 0, arbeit = 0;
    for (const e of einsaetze) {
      let beginn = e.start;
      if (ende !== null) {
        const luecke = beginn - ende;
        if (luecke < 0) beginn = ende;
        else if (luecke >= 60) { pause += luecke; langeLuecken++; }
        else if (luecke > 30) { anfahrt += 30; pause += luecke - 30; kurzeLuecken++; }
        else if (luecke > 0) { anfahrt += luecke; kurzeLuecken++; }
      }
      ende = beginn + e.ist;
      arbeit += e.ist;
    }
    const tag = n.tage[0];
    assert.equal(tag.anfahrtMin, anfahrt, `Lauf ${lauf}: Anfahrt`);
    assert.equal(tag.pauseMin, pause, `Lauf ${lauf}: Pause`);
    assert.equal(tag.bezahltMin, arbeit + anfahrt, `Lauf ${lauf}: bezahlt`);
    assert.equal(n.summen.bezahltMin, arbeit + anfahrt, `Lauf ${lauf}: Monatssumme`);
    // an den Zeilen selbst: keine Anfahrt über 30 Minuten; Pause + Anfahrt derselben Lücke bleiben unter 1 Stunde
    for (const [i, z] of tag.zeilen.entries()) {
      if (z.art !== 'anfahrt') continue;
      assert.ok(z.min > 0 && z.min <= 30, `Lauf ${lauf}: Anfahrt ${z.min} Min`);
      const davor = tag.zeilen[i - 1];
      if (davor.art === 'pause') assert.ok(davor.min + z.min < 60, `Lauf ${lauf}: Anfahrt trotz Lücke ab 1 Stunde`);
      assert.equal(tag.zeilen[i + 1].art, 'einsatz', `Lauf ${lauf}: Anfahrt steht direkt vor dem Einsatz`);
    }
    for (const [i, z] of tag.zeilen.entries()) {
      if (z.art === 'pause' && z.min >= 60) assert.equal(tag.zeilen[i + 1].art, 'einsatz', `Lauf ${lauf}: nach einer Pause ab 1 Stunde folgt direkt der Einsatz`);
    }
  }
  assert.ok(langeLuecken > 100 && kurzeLuecken > 100, 'die Zufallstage decken beide Fälle ab');
});

test('Zettel: Pause-Zeile über die ganze Lücke, keine Zeile „Kunden-Anfahrt“ dafür; Summenblock und Erläuterung passen dazu', async () => {
  const zeitraum = abrechnungszeitraum('2026-11');
  const besuche = [
    einsatz('2026-11-24', '08:00', '09:00'), einsatz('2026-11-24', '09:15', '10:00', klient('Lina Probe')), // Lücke 0:15
    einsatz('2026-11-25', '10:15', '11:30'), einsatz('2026-11-25', '15:00', '16:15', klient('Lina Probe')), // Lücke 3:30
    einsatz('2026-11-26', '08:30', '09:45'), einsatz('2026-11-26', '12:15', '13:15', klient('Otto Beispiel')), // Lücke 2:30
  ];
  const nachweis = berechneZeitnachweis(besuche, { jetzt: FINAL, zeitraum });
  const bytes = await sz.erstellePdf({ maName: 'Erika M.', maNr: 90123, monat: '2026-11', zeitraum, nachweis, final: true });
  const texte = pdfTexte(bytes);
  const nach = (text, ab = 0) => texte.slice(texte.indexOf(text, ab) + 1);
  // 25.11.: Zeitfenster der Pause = die ganze Lücke, danach direkt der nächste Einsatz
  const p1 = texte.indexOf('11:30 – 15:00');
  assert.ok(p1 > 0, 'Pause 11:30 – 15:00 fehlt');
  assert.deepEqual(texte.slice(p1, p1 + 5), ['11:30 – 15:00', '(3:30', ')', 'Pause (unbezahlt)', '15:00 – 16:15']);
  assert.ok(!texte.includes('14:30 – 15:00'), 'alte Anfahrt-Zeile 14:30 – 15:00 steht noch drauf');
  assert.ok(texte.includes('Tagessumme · Pause 3:30 unbezahlt'));
  // 26.11.
  const p2 = texte.indexOf('09:45 – 12:15');
  assert.deepEqual(texte.slice(p2, p2 + 5), ['09:45 – 12:15', '(2:30', ')', 'Pause (unbezahlt)', '12:15 – 13:15']);
  assert.ok(!texte.includes('11:45 – 12:15'), 'alte Anfahrt-Zeile 11:45 – 12:15 steht noch drauf');
  assert.ok(texte.includes('Tagessumme · Pause 2:30 unbezahlt'));
  // die kurze Lücke am 24.11. ist bezahlt wie bisher
  assert.deepEqual(texte.slice(texte.indexOf('09:00 – 09:15'), texte.indexOf('09:00 – 09:15') + 3), ['09:00 – 09:15', '0:15', 'Kunden-Anfahrt']);
  assert.ok(texte.includes('Tagessumme · davon Anfahrt 0:15'));
  // „Kunden-Anfahrt“ als eigene Zeile: genau einmal am 24.11. und einmal im Summenblock
  assert.equal(texte.filter((t) => t === 'Kunden-Anfahrt').length, 2);
  assert.equal(texte.filter((t) => t === 'Pause (unbezahlt)').length, 2);
  // Summenblock: 1:45 + 2:30 + 2:15 Einsätze, 0:15 Anfahrt, 6:00 Pause
  assert.equal(nach('Einsätze bestätigt (Ist)')[0], '6:30 Std.');
  assert.equal(nach('Kunden-Anfahrt', texte.indexOf('Einsätze bestätigt (Ist)'))[0], '0:15 Std.');
  assert.equal(nach('Monatssumme (bezahlt)')[0], '6:45 Std.');
  assert.equal(nach('Pausen (unbezahlt)')[0], '6:00 Std.');
  assert.equal(hm(nachweis.summen.bezahltMin), '6:45'); // bis 26.11.2026: 7:45
  // Erläuterung: neue Regel steht drauf, die alte Formulierung nicht mehr
  const alles = texte.join(' ');
  assert.ok(alles.includes('Ab 1 Stunde zwischen zwei Einsätzen gibt es keine Anfahrt – die ganze Lücke ist Pause.'));
  assert.ok(alles.includes('Ist die Lücke länger, aber kürzer als 1 Stunde, werden 30 Minuten Anfahrt bezahlt'));
  assert.ok(!/trotzdem 30 Minuten Anfahrt|Lücke 1:00 = 0:30 Pause/.test(alles), 'alte Regel steht noch in der Erläuterung');
});

test('Die Erläuterung ist nicht länger geworden: Ein kurzer endgültiger Zettel bleibt auf einer Seite', async () => {
  const zeitraum = abrechnungszeitraum('2026-11');
  const nachweis = berechneZeitnachweis([
    einsatz('2026-11-25', '10:15', '11:30'), einsatz('2026-11-25', '15:00', '16:15', klient('Lina Probe')),
  ], { jetzt: FINAL, zeitraum });
  const bytes = await sz.erstellePdf({ maName: 'Erika M.', maNr: 90123, monat: '2026-11', zeitraum, nachweis, final: true });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  assert.ok(pdfTexte(bytes).includes(sz.UNTERSCHRIFT_ROLLE), 'Unterschriftszeile fehlt');
});

test('Ganzer Weg (Airtable -> /api/stundenzettel): Summe ohne die Anfahrt der langen Lücken, endgültiger Zettel', async () => {
  const besuche = [
    einsatz('2026-11-25', '10:15', '11:30'), einsatz('2026-11-25', '15:00', '16:15', klient('Lina Probe')),
    einsatz('2026-11-26', '08:30', '09:45'),
    einsatz('2026-11-26', '10:00', '12:00', { ...klient('Otto Beispiel'), Status: 'Abgesagt', [HAKEN]: true }),
    einsatz('2026-11-26', '12:15', '13:15', klient('Lina Probe')),
    einsatz('2026-11-27', '08:00', '09:00'), // nächster Zeitraum – zählt nicht
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
  // 2:30 (25.11.) + 2:15 (26.11.) – bis 26.11.2026 wären es 5:45 gewesen (je Lücke 0:30 Anfahrt)
  assert.equal(res.body.summe, '4:45');
  assert.equal(res.body.einsaetze, 4);
  assert.equal(log.patches.at(-1).Summe_Stunden, '4:45');
  assert.equal(log.patches.at(-1).Status, 'Erstellt');
  const texte = pdfTexte(Buffer.from(log.upload.file, 'base64'));
  assert.equal(texte.filter((t) => t === 'Kunden-Anfahrt').length, 1, 'nur noch die Zeile im Summenblock');
  assert.equal(texte[texte.indexOf('Kunden-Anfahrt') + 1], '0:00 Std.');
  assert.equal(texte[texte.indexOf('Pausen (unbezahlt)') + 1], '6:00 Std.');
});

test('Unverändert: Lücken unter 1 Stunde, Tagesgrenzen, nicht Bestätigtes und Abgesagtes', () => {
  // Karls Testtag vom 28.10.2026 – jede Zahl wie bisher
  const n = berechneZeitnachweis([
    einsatz('2026-11-18', '06:45', '07:00'), einsatz('2026-11-18', '07:30', '08:15'), einsatz('2026-11-18', '09:00', '10:00'),
  ], { jetzt: FINAL });
  assert.deepEqual(kurz(n.tage[0]), [
    'einsatz:06:45-07:00=0:15', 'anfahrt:07:00-07:30=0:30', 'einsatz:07:30-08:15=0:45',
    'pause:08:15-08:30=0:15', 'anfahrt:08:30-09:00=0:30', 'einsatz:09:00-10:00=1:00',
  ]);
  assert.equal(hm(n.summen.bezahltMin), '3:00');
  // über Nacht gibt es nie Anfahrt oder Pause (auch nicht „ab 1 Stunde“ als Pause-Zeile)
  const zweiTage = berechneZeitnachweis([einsatz('2026-11-19', '16:00', '17:00'), einsatz('2026-11-20', '08:00', '09:00')], { jetzt: FINAL });
  assert.deepEqual(zweiTage.tage.map((t) => kurz(t)), [['einsatz:16:00-17:00=1:00'], ['einsatz:08:00-09:00=1:00']]);
  assert.equal(zweiTage.summen.pauseMin, 0);
  // ein nicht bestätigter Einsatz zählt nicht – die Lücke um ihn herum wird wie jede Lücke gerechnet
  const offen = einsatz('2026-11-21', '09:15', '09:45');
  delete offen.fields.Dauer_Ist;
  const mitOffenem = berechneZeitnachweis([einsatz('2026-11-21', '08:00', '09:00'), offen, einsatz('2026-11-21', '10:00', '11:00')], { jetzt: FINAL });
  assert.deepEqual(zwischen(mitOffenem.tage[0]), ['pause:09:00-10:00=1:00']);
  assert.equal(mitOffenem.summen.ohneIst, 1);
  assert.equal(takt(59), 60); // die Rundung selbst ist unverändert
});
