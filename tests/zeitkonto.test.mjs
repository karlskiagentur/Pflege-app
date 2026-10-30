// Tests für den Stundenzettel-Rechenkern (api/_zeitkonto.js). Alle Daten frei erfunden.
// Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berechneZeitnachweis, berlin, takt, hm, termin, vorbei, minutenAus } from '../api/_zeitkonto.js';

let n = 0;
// Besuch wie aus der Airtable-REST-API (Selects als Text, Lookups als Array, Dauer in Sekunden).
// Standard: BESTÄTIGT, Ist = Zeitfenster (Dauer_Ist in Sekunden, wie /api/besuch-dauer schreibt).
const b = (datum, von, bis, extra = {}) => ({
  id: `recTest${String(++n).padStart(10, '0')}`,
  fields: {
    Datum: datum, Von: von, Bis: bis, Status: 'Bestätigt', Patient_Name: [`Klient ${n}`],
    Dauer_Ist: (minutenAus(bis) - minutenAus(von)) * 60,
    ...extra,
  },
});
// NICHT bestätigt: die REST-API lässt leere Felder weg - Dauer_Ist fehlt ganz.
const offen = (datum, von, bis, extra = {}) => {
  const r = b(datum, von, bis, extra);
  delete r.fields.Dauer_Ist;
  return r;
};
const ZEIT = '2026-10-23T12:00:00Z'; // "jetzt" = 23.10.2026, 14:00 Uhr in Berlin
// Kurzform der Zeilen. Ein Einsatz, der nicht auf einer bestätigten Ist-Zeit beruht, fällt sofort auf.
const kurz = (z) => z.zeilen.map((r) =>
  `${r.art}:${r.von}-${r.bis}=${hm(r.min)}${r.art === 'einsatz' && r.quelle !== 'ist' ? ' OHNE BESTÄTIGUNG' : ''}`);

test('Karls Testtag: Lücke 30 Min = Anfahrt; Lücke 45 Min = 15 Min Pause + 30 Min Anfahrt -> 3:00 Std.', () => {
  const r = berechneZeitnachweis([
    b('2026-10-22', '06:45', '07:00'),
    b('2026-10-22', '07:30', '08:15'),
    b('2026-10-22', '09:00', '10:00'),
  ], { jetzt: ZEIT });
  assert.equal(r.tage.length, 1);
  assert.deepEqual(kurz(r.tage[0]), [
    'einsatz:06:45-07:00=0:15',
    'anfahrt:07:00-07:30=0:30',
    'einsatz:07:30-08:15=0:45',
    'pause:08:15-08:30=0:15',
    'anfahrt:08:30-09:00=0:30',
    'einsatz:09:00-10:00=1:00',
  ]);
  assert.equal(hm(r.summen.einsatzMin), '2:00');
  assert.equal(hm(r.summen.anfahrtMin), '1:00');
  assert.equal(hm(r.summen.bezahltMin), '3:00');
  assert.equal(hm(r.summen.pauseMin), '0:15');
  assert.equal(hm(r.summen.sollMin), '2:00');
  assert.equal(r.summen.ohneIst, 0);
  assert.deepEqual(r.nichtBestaetigt, []);
  // Tagessumme (steht im PDF): bezahlt ohne Pause
  assert.equal(hm(r.tage[0].bezahltMin), '3:00');
  assert.equal(hm(r.tage[0].pauseMin), '0:15');
});

test('Vorgabe 30.10.2026: ohne bestätigte Ist-Zeit wird NICHTS berechnet - kein Soll-Ersatz, keine Anfahrt', () => {
  const r = berechneZeitnachweis([
    offen('2026-10-22', '09:00', '10:00', { Patient_Name: ['Klient C'] }),
    offen('2026-10-22', '06:45', '07:00', { Patient_Name: ['Klient A'] }),
    offen('2026-10-22', '07:30', '08:15', { Patient_Name: ['Klient B'], 'Tätigkeit': 'Grundpflege' }),
  ], { jetzt: ZEIT });
  assert.deepEqual(r.tage, []);
  assert.deepEqual(r.summen, {
    sollMin: 0, einsatzMin: 0, anfahrtMin: 0, pauseMin: 0, bezahltMin: 0, einsaetze: 0, ohneIst: 3, ohneIstSollMin: 120,
  });
  // Getrennt aufgeführt (zeitlich sortiert), damit das Büro prüfen und Geleistetes nachtragen kann
  assert.deepEqual(r.nichtBestaetigt.map((t) => [t.datum, t.von, t.bis, t.sollMin, t.klient]), [
    ['2026-10-22', '06:45', '07:00', 15, 'Klient A'],
    ['2026-10-22', '07:30', '08:15', 45, 'Klient B'],
    ['2026-10-22', '09:00', '10:00', 60, 'Klient C'],
  ]);
  assert.equal(r.nichtBestaetigt[1].taetigkeit, 'Grundpflege');
  assert.match(r.nichtBestaetigt[0].id, /^recTest\d{10}$/);
});

test('Nicht bestätigter Einsatz zwischen zwei bestätigten: keine Anfahrt dorthin; nachgetragen zählt er wieder', () => {
  const vorher = berechneZeitnachweis([
    b('2026-10-20', '08:00', '08:30'),
    offen('2026-10-20', '08:45', '09:15'),
    b('2026-10-20', '09:30', '10:00'),
  ], { jetzt: ZEIT });
  // Die Lücke 08:30-09:30 gilt wie jede Lücke: 30 Min Anfahrt zum nächsten bestätigten Einsatz, Rest Pause
  assert.deepEqual(kurz(vorher.tage[0]), [
    'einsatz:08:00-08:30=0:30', 'pause:08:30-09:00=0:30', 'anfahrt:09:00-09:30=0:30', 'einsatz:09:30-10:00=0:30',
  ]);
  assert.equal(hm(vorher.summen.bezahltMin), '1:30');
  assert.equal(vorher.summen.einsaetze, 2);
  assert.equal(vorher.summen.ohneIst, 1);
  assert.equal(hm(vorher.summen.ohneIstSollMin), '0:30');
  assert.equal(hm(vorher.summen.sollMin), '1:00'); // Soll nur der berechneten (bestätigten) Einsätze
  assert.deepEqual(vorher.nichtBestaetigt.map((t) => `${t.von}-${t.bis}`), ['08:45-09:15']);

  // Das Büro trägt die Zeit nach (Dauer_Ist) -> Einsatz und beide Anfahrten zählen
  const nachher = berechneZeitnachweis([
    b('2026-10-20', '08:00', '08:30'),
    b('2026-10-20', '08:45', '09:15'),
    b('2026-10-20', '09:30', '10:00'),
  ], { jetzt: ZEIT });
  assert.deepEqual(kurz(nachher.tage[0]), [
    'einsatz:08:00-08:30=0:30', 'anfahrt:08:30-08:45=0:15', 'einsatz:08:45-09:15=0:30',
    'anfahrt:09:15-09:30=0:15', 'einsatz:09:30-10:00=0:30',
  ]);
  assert.equal(hm(nachher.summen.bezahltMin), '2:00');
  assert.deepEqual(nachher.nichtBestaetigt, []);
});

test('Nicht bestätigt wirkt exakt wie "nicht vorhanden" (200 Zufallsszenarien)', () => {
  let seed = 20261030;
  const zufall = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  for (let s = 0; s < 200; s++) {
    const alle = [];
    for (let i = 0, anzahl = 1 + zufall(7); i < anzahl; i++) {
      const datum = `2026-10-${20 + zufall(3)}`;
      const von = 6 * 60 + 15 * zufall(48);
      const bis = von + 15 * (1 + zufall(8));
      const extra = { Dauer_Ist: 60 * 5 * zufall(30) };       // auch 0 und krumme Minuten
      if (zufall(6) === 0) extra.Status = 'Abgesagt';
      const r = b(datum, hhmm(von), hhmm(bis), extra);
      alle.push(zufall(3) === 0 ? offen(datum, hhmm(von), hhmm(bis), extra.Status ? { Status: extra.Status } : {}) : r);
    }
    const bestaetigt = alle.filter((r) => typeof r.fields.Dauer_Ist === 'number');
    const mit = berechneZeitnachweis(alle, { jetzt: ZEIT });
    const ohne = berechneZeitnachweis(bestaetigt, { jetzt: ZEIT });
    assert.deepEqual(mit.tage, ohne.tage, `Szenario ${s}: Tage`);
    const { ohneIst, ohneIstSollMin, ...rest } = mit.summen;
    const { ohneIst: o2, ohneIstSollMin: o3, ...restOhne } = ohne.summen;
    assert.deepEqual(rest, restOhne, `Szenario ${s}: Summen`);
    assert.equal(o2, 0);
    assert.equal(o3, 0);
    const erwartetOffen = alle.filter((r) => typeof r.fields.Dauer_Ist !== 'number' && r.fields.Status !== 'Abgesagt');
    assert.equal(ohneIst, erwartetOffen.length, `Szenario ${s}: Anzahl nicht bestätigt`);
    assert.equal(mit.nichtBestaetigt.length, ohneIst);
    assert.equal(ohneIstSollMin, mit.nichtBestaetigt.reduce((x, t) => x + t.sollMin, 0));
    assert.ok(mit.tage.every((t) => t.zeilen.every((z) => z.art !== 'einsatz' || z.quelle === 'ist')));
  }
});

test('Ist-Zeit wie geplant -> gleiches Ergebnis, Zeilen als "erfasst" markiert', () => {
  const r = berechneZeitnachweis([
    b('2026-10-22', '06:45', '07:00', { Dauer_Ist: 900 }),
    b('2026-10-22', '07:30', '08:15', { Dauer_Ist: 2700 }),
    b('2026-10-22', '09:00', '10:00', { Dauer_Ist: 3600 }),
  ], { jetzt: ZEIT });
  assert.equal(hm(r.summen.bezahltMin), '3:00');
  assert.equal(r.summen.ohneIst, 0);
  assert.ok(r.tage[0].zeilen.filter((z) => z.art === 'einsatz').every((z) => z.quelle === 'ist'));
});

test('Vom Büro eingetragene Ist-Zeit zählt wie eine App-Bestätigung; maßgeblich ist allein Dauer_Ist', () => {
  const r = berechneZeitnachweis([
    b('2026-10-20', '08:00', '08:30', { Dauer_Ist: 45 * 60 }),                                       // Büro: nur Dauer_Ist
    b('2026-10-20', '09:00', '09:30', { Dauer_Ist: 1800, Erledigt_Am: '2026-10-20T07:40:00.000Z' }), // App: Dauer + Zeitpunkt
    offen('2026-10-20', '10:00', '10:30', { Erledigt_Am: '2026-10-20T08:40:00.000Z' }),              // Zeitpunkt ohne Dauer
    offen('2026-10-20', '11:00', '11:30'),                                                            // nichts erfasst
  ], { jetzt: ZEIT });
  assert.equal(r.summen.einsaetze, 2);
  assert.equal(hm(r.summen.einsatzMin), '1:15');
  assert.equal(r.summen.ohneIst, 2);
  assert.deepEqual(r.nichtBestaetigt.map((t) => t.von), ['10:00', '11:00']);
  // Formelfeld Ist_Stunden_Monat (= gerundetes Dauer_Ist) reicht ebenfalls als Bestätigung
  assert.equal(termin({ Datum: '2026-10-20', Von: '08:00', Bis: '09:00', Ist_Stunden_Monat: 2700 }).istMin, 45);
  assert.equal(termin({ Datum: '2026-10-20', Von: '08:00', Bis: '09:00' }).istMin, null);
});

test('Grenzen: Lücke 15/30 Min = ganz Anfahrt, 45 Min = 30 Anfahrt + 15 Pause, 0 Min = nichts', () => {
  const r = berechneZeitnachweis([
    b('2026-10-20', '08:00', '08:30'),
    b('2026-10-20', '08:45', '09:00'), // 15 Min
    b('2026-10-20', '09:30', '10:00'), // 30 Min
    b('2026-10-20', '10:45', '11:00'), // 45 Min
    b('2026-10-20', '11:00', '11:30'), // 0 Min
  ], { jetzt: ZEIT });
  assert.deepEqual(kurz(r.tage[0]).filter((s) => !s.startsWith('einsatz')), [
    'anfahrt:08:30-08:45=0:15', 'anfahrt:09:00-09:30=0:30', 'pause:10:00-10:15=0:15', 'anfahrt:10:15-10:45=0:30',
  ]);
  assert.equal(hm(r.summen.einsatzMin), '2:00'); // 0:30+0:15+0:30+0:15+0:30
  assert.equal(hm(r.summen.anfahrtMin), '1:15'); // 0:15+0:30+0:30
  assert.equal(hm(r.summen.bezahltMin), '3:15');
  assert.equal(hm(r.summen.pauseMin), '0:15');
});

test('Lange Lücke (2:15): 30 Min Anfahrt bezahlt, nur 1:45 Pause', () => {
  const r = berechneZeitnachweis([
    b('2026-10-23', '09:00', '10:45', { Dauer_Ist: 105 * 60 }),
    b('2026-10-23', '13:00', '15:00', { Dauer_Ist: 120 * 60 }),
  ], { jetzt: '2026-10-24T12:00:00Z' });
  assert.deepEqual(kurz(r.tage[0]), [
    'einsatz:09:00-10:45=1:45', 'pause:10:45-12:30=1:45', 'anfahrt:12:30-13:00=0:30', 'einsatz:13:00-15:00=2:00',
  ]);
  assert.equal(hm(r.summen.bezahltMin), '4:15'); // 3:45 Einsätze + 0:30 Anfahrt
  assert.equal(hm(r.summen.pauseMin), '1:45');
});

test('Mehrere lange Lücken an einem Tag: je Lücke 30 Min Anfahrt', () => {
  const r = berechneZeitnachweis([
    b('2026-10-20', '09:30', '10:45', { Dauer_Ist: 75 * 60 }),
    b('2026-10-20', '11:30', '12:45', { Dauer_Ist: 75 * 60 }), // Lücke 0:45
    b('2026-10-20', '13:30', '15:00', { Dauer_Ist: 90 * 60 }), // Lücke 0:45
  ], { jetzt: ZEIT });
  assert.equal(hm(r.tage[0].einsatzMin), '4:00');
  assert.equal(hm(r.tage[0].anfahrtMin), '1:00');
  assert.equal(hm(r.tage[0].pauseMin), '0:30');
  assert.equal(hm(r.tage[0].bezahltMin), '5:00'); // vorher 4:00 (beide Lücken ganz Pause)
});

test('Jede Lücke: Anfahrt = höchstens 30 Min, Pause = Rest; Zeilen lückenlos bis zum nächsten Einsatz', () => {
  for (let luecke = 0; luecke <= 300; luecke += 5) {
    const beginn2 = 8 * 60 + 30 + luecke; // erster Einsatz 08:00-08:30
    const r = berechneZeitnachweis([
      b('2026-10-20', '08:00', '08:30'),
      b('2026-10-20', `${String(Math.floor(beginn2 / 60)).padStart(2, '0')}:${String(beginn2 % 60).padStart(2, '0')}`, '23:45'),
    ], { jetzt: '2026-10-21T12:00:00Z' });
    const t = r.tage[0];
    const gesamt = takt(luecke);
    const erwAnfahrt = luecke > 0 ? Math.min(gesamt, 30) : 0;
    assert.equal(t.anfahrtMin, erwAnfahrt, `Lücke ${luecke}: Anfahrt`);
    assert.equal(t.pauseMin, luecke > 30 ? gesamt - 30 : 0, `Lücke ${luecke}: Pause`);
    assert.equal(t.anfahrtMin + t.pauseMin, luecke > 0 ? gesamt : 0, `Lücke ${luecke}: Summe`);
    assert.equal(t.bezahltMin, t.einsatzMin + t.anfahrtMin);
    // Zwischenzeilen schließen lückenlos an: Ende Einsatz 1 -> (Pause) -> Anfahrt -> Beginn Einsatz 2
    const zw = t.zeilen.filter((z) => z.art !== 'einsatz');
    if (luecke > 30) {
      assert.equal(zw.at(-1).art, 'anfahrt', `Lücke ${luecke}: Anfahrt direkt vor dem Einsatz`);
      assert.equal(zw.at(-1).bis, t.zeilen.at(-1).istVon);
      assert.equal(zw[0].von, '08:30');
      if (zw.length === 2) assert.equal(zw[0].bis, zw[1].von);
    }
    assert.ok(zw.every((z) => z.art !== 'pause' || z.min > 0), `Lücke ${luecke}: keine 0:00-Pause`);
  }
});

test('Nur Vergangenes zählt: morgen und heute noch laufend/geplant fehlen - auch in der Liste "nicht bestätigt"', () => {
  const r = berechneZeitnachweis([
    b('2026-10-23', '08:00', '09:00'),     // heute, vorbei (jetzt 14:00)
    b('2026-10-23', '13:30', '14:00'),     // heute, endet genau jetzt -> vorbei
    b('2026-10-23', '13:45', '14:15'),     // heute, läuft noch
    b('2026-10-24', '08:00', '09:00'),     // morgen, trotz (zu früh) erfasster Ist-Zeit
    offen('2026-10-23', '10:00', '10:30'), // heute, vorbei, nicht bestätigt -> Liste
    offen('2026-10-23', '15:00', '15:30'), // heute, noch nicht dran -> weder Summe noch Liste
  ], { jetzt: ZEIT });
  assert.equal(r.summen.einsaetze, 2);
  assert.equal(r.ausgelassen.zukunft, 3);
  assert.equal(hm(r.summen.einsatzMin), '1:30');
  assert.equal(hm(r.summen.bezahltMin), '2:00'); // + 0:30 Anfahrt (Lücke 09:00-13:30, Rest Pause)
  assert.deepEqual(r.nichtBestaetigt.map((t) => t.von), ['10:00']);
});

test('Abgesagte Termine zählen nie - weder bestätigt noch in der Liste "nicht bestätigt"', () => {
  const r = berechneZeitnachweis([
    b('2026-10-20', '08:00', '09:00', { Status: 'Abgesagt', Dauer_Ist: 3600 }),
    b('2026-10-20', '09:15', '10:00'),
    offen('2026-10-20', '10:30', '11:00', { Status: 'Abgesagt' }),
  ], { jetzt: ZEIT });
  assert.equal(r.summen.einsaetze, 1);
  assert.equal(r.ausgelassen.abgesagt, 2);
  assert.equal(r.tage[0].zeilen.length, 1); // keine Anfahrt zu einem abgesagten Termin
  assert.deepEqual(r.nichtBestaetigt, []);
});

test('Termin dauert länger: Anfahrt wird nicht doppelt bezahlt, Folgetermin verschiebt sich', () => {
  const r = berechneZeitnachweis([
    b('2026-10-20', '08:00', '08:30', { Dauer_Ist: 60 * 60 }), // 1:00 statt 0:30 -> Ende 09:00
    b('2026-10-20', '08:45', '09:15'),                         // beginnt erst 09:00 -> Ende 09:30
    b('2026-10-20', '09:45', '10:00'),                         // Lücke 15 Min
  ], { jetzt: ZEIT });
  assert.deepEqual(kurz(r.tage[0]), [
    'einsatz:08:00-08:30=1:00', 'einsatz:08:45-09:15=0:30', 'anfahrt:09:30-09:45=0:15', 'einsatz:09:45-10:00=0:15',
  ]);
  assert.equal(hm(r.summen.bezahltMin), '2:00'); // = 08:00 bis 10:00 durchgehend
  // Zeitraum laut Ist: länger (gleicher Beginn), verschoben, wie geplant
  const e = r.tage[0].zeilen.filter((z) => z.art === 'einsatz');
  assert.deepEqual(e.map((z) => [z.istVon, z.istBis, z.zeitAbweichend]), [
    ['08:00', '09:00', true], ['09:00', '09:30', true], ['09:45', '10:00', false],
  ]);
});

test('Termin kürzer als geplant: längere Lücke = 30 Min Anfahrt + Rest Pause', () => {
  const r = berechneZeitnachweis([
    b('2026-10-20', '08:00', '09:00', { Dauer_Ist: 15 * 60 }), // fertig 08:15
    b('2026-10-20', '09:00', '09:30'),
  ], { jetzt: ZEIT });
  assert.deepEqual(kurz(r.tage[0]), [
    'einsatz:08:00-09:00=0:15', 'pause:08:15-08:30=0:15', 'anfahrt:08:30-09:00=0:30', 'einsatz:09:00-09:30=0:30',
  ]);
  assert.equal(hm(r.summen.bezahltMin), '1:15');
});

test('Lücke knapp über 30 Min: nach dem Runden ohne Pause -> Anfahrt deckt die ganze Lücke', () => {
  const r = berechneZeitnachweis([
    b('2026-10-20', '08:00', '08:30'),
    b('2026-10-20', '09:05', '09:35'), // Lücke 35 Min -> 0:30 Anfahrt, keine Pause
    b('2026-10-20', '10:15', '10:30'), // Lücke 40 Min -> 0:15 Pause + 0:30 Anfahrt
  ], { jetzt: ZEIT });
  assert.deepEqual(kurz(r.tage[0]).filter((s) => !s.startsWith('einsatz')), [
    'anfahrt:08:30-09:05=0:30', 'pause:09:35-09:45=0:15', 'anfahrt:09:45-10:15=0:30',
  ]);
});

test('15-Minuten-Takt wie Ist_Stunden_Monat (ROUND(Sekunden/900)*900)', () => {
  assert.equal(takt(80), 75);   // 1:20 -> 1:15
  assert.equal(takt(82), 75);   // 1:22 -> 1:15
  assert.equal(takt(83), 90);   // 1:23 -> 1:30
  assert.equal(takt(7.5), 15);  // halbe Viertelstunde rundet auf
  const r = berechneZeitnachweis([b('2026-10-20', '08:00', '09:30', { Dauer_Ist: 4800 })], { jetzt: ZEIT });
  assert.equal(hm(r.summen.bezahltMin), '1:15');
  // Summe ist exakte Addition der Zeilen (alles im Raster)
  assert.equal(r.summen.bezahltMin % 15, 0);
});

test('Erfasste 0 Minuten (nicht angetroffen) ist eine Bestätigung: zählt 0, Anfahrt dorthin zählt, nicht in der Liste', () => {
  const einzeln = berechneZeitnachweis([b('2026-10-20', '08:00', '09:00', { Dauer_Ist: 0 })], { jetzt: ZEIT });
  assert.equal(einzeln.summen.bezahltMin, 0);
  assert.equal(einzeln.tage[0].zeilen[0].quelle, 'ist');
  assert.equal(einzeln.summen.ohneIst, 0);
  assert.deepEqual(einzeln.nichtBestaetigt, []);
  const r = berechneZeitnachweis([
    b('2026-10-20', '08:00', '08:30'),
    b('2026-10-20', '08:45', '09:30', { Dauer_Ist: 0 }),
  ], { jetzt: ZEIT });
  assert.deepEqual(kurz(r.tage[0]), ['einsatz:08:00-08:30=0:30', 'anfahrt:08:30-08:45=0:15', 'einsatz:08:45-09:30=0:00']);
  assert.equal(hm(r.summen.bezahltMin), '0:45');
});

test('Mehrere Tage: getrennt, sortiert, Anfahrt nie über Tagesgrenzen', () => {
  const r = berechneZeitnachweis([
    b('2026-10-21', '09:00', '10:00'),
    b('2026-10-20', '17:00', '17:30'),
    b('2026-10-21', '08:00', '08:45'),
  ], { jetzt: ZEIT });
  assert.deepEqual(r.tage.map((t) => t.datum), ['2026-10-20', '2026-10-21']);
  assert.deepEqual(kurz(r.tage[1]), ['einsatz:08:00-08:45=0:45', 'anfahrt:08:45-09:00=0:15', 'einsatz:09:00-10:00=1:00']);
  assert.equal(r.tage[0].zeilen.length, 1);
});

test('Liste "nicht bestätigt": über Tage sortiert, Altdaten ohne Von/Bis mit Uhrzeit aus dem Zeitstempel', () => {
  const k = (name) => ({ Patient_Name: [name] });
  const r = berechneZeitnachweis([
    offen('2026-10-21', '09:00', '09:30', k('Klient D')),
    offen('2026-10-20', '17:00', '17:45', k('Klient B')),
    { id: 'recAltdaten000001', fields: { Uhrzeit: '2026-10-19T06:00:00.000Z', Dauer_Soll: 2700, Status: 'Geplant' } },
    offen('2026-10-21', '08:00', '08:15', k('Klient C')),
  ], { jetzt: ZEIT });
  assert.deepEqual(r.nichtBestaetigt.map((t) => [t.datum, t.von, t.bis, t.sollMin, t.klient]), [
    ['2026-10-19', '08:00', '08:45', 45, ''],  // 06:00 UTC = 08:00 Berlin; Dauer aus Dauer_Soll
    ['2026-10-20', '17:00', '17:45', 45, 'Klient B'],
    ['2026-10-21', '08:00', '08:15', 15, 'Klient C'],
    ['2026-10-21', '09:00', '09:30', 30, 'Klient D'],
  ]);
  assert.equal(hm(r.summen.ohneIstSollMin), '2:15');
});

test('Altdaten ohne Von/Bis: Beginn aus Uhrzeit (Berlin), Dauer aus Dauer_Soll', () => {
  const t = termin({ Uhrzeit: '2026-10-20T06:00:00.000Z', Dauer_Soll: 2700, Status: 'Geplant' });
  assert.equal(t.datum, '2026-10-20');
  assert.equal(t.start, 8 * 60);   // 06:00 UTC = 08:00 Berlin (Sommerzeit)
  assert.equal(t.planMin, 45);
  const w = termin({ Uhrzeit: '2026-12-01T07:00:00.000Z', Dauer_Soll: 1800 });
  assert.equal(w.start, 8 * 60);   // Winterzeit: 07:00 UTC = 08:00 Berlin
});

test('Zeitfenster ist führend: veraltetes Dauer_Soll wird ignoriert', () => {
  const t = termin({ Datum: '2026-10-22', Von: '06:45', Bis: '07:00', Dauer_Soll: 5400 });
  assert.equal(t.planMin, 15);
});

test('"Jetzt" wird in Berliner Zeit bewertet (auch über Mitternacht UTC)', () => {
  assert.deepEqual(berlin('2026-10-21T22:30:00Z'), { datum: '2026-10-22', min: 30 });
  const t = termin({ Datum: '2026-10-21', Von: '22:00', Bis: '22:15' });
  assert.equal(vorbei(t, berlin('2026-10-21T20:10:00Z')), false); // 22:10 Berlin
  assert.equal(vorbei(t, berlin('2026-10-21T20:15:00Z')), true);  // 22:15 Berlin
});

test('Sommer-/Winterzeit-Wechsel (25.10.2026) verschiebt keine Zeitfenster', () => {
  const r = berechneZeitnachweis([
    b('2026-10-25', '02:00', '02:30'),
    b('2026-10-25', '03:00', '03:30'),
  ], { jetzt: '2026-10-26T12:00:00Z' });
  assert.deepEqual(kurz(r.tage[0]), ['einsatz:02:00-02:30=0:30', 'anfahrt:02:30-03:00=0:30', 'einsatz:03:00-03:30=0:30']);
});

test('Klientenname aus Lookup, fehlender Name bleibt leer (Tage und Liste "nicht bestätigt")', () => {
  const r = berechneZeitnachweis([
    { id: 'recA', fields: { Datum: '2026-10-20', Von: '08:00', Bis: '08:30', Dauer_Ist: 1800, Patient_Name: ['Erika Musterfrau'] } },
    { id: 'recB', fields: { Datum: '2026-10-20', Von: '08:30', Bis: '09:00', Dauer_Ist: 1800 } },
    { id: 'recC', fields: { Datum: '2026-10-20', Von: '10:00', Bis: '10:30', Patient_Name: ['Max Mustermann'] } },
    { id: 'recD', fields: { Datum: '2026-10-20', Von: '11:00', Bis: '11:30' } },
  ], { jetzt: ZEIT });
  assert.equal(r.tage[0].zeilen[0].klient, 'Erika Musterfrau');
  assert.equal(r.tage[0].zeilen[1].klient, '');
  assert.deepEqual(r.nichtBestaetigt.map((t) => t.klient), ['Max Mustermann', '']);
});

test('Leere Eingabe -> leerer Nachweis ohne Fehler', () => {
  const r = berechneZeitnachweis([], { jetzt: ZEIT });
  assert.deepEqual(r.tage, []);
  assert.deepEqual(r.nichtBestaetigt, []);
  assert.equal(r.summen.bezahltMin, 0);
  assert.equal(r.summen.ohneIst, 0);
  assert.equal(r.summen.ohneIstSollMin, 0);
  assert.deepEqual(berechneZeitnachweis(undefined, { jetzt: ZEIT }).nichtBestaetigt, []);
});

test('Soll und Ist je Einsatz getrennt; Soll-Summe nur über berechnete (bestätigte) Einsätze', () => {
  const r = berechneZeitnachweis([
    b('2026-10-20', '08:00', '08:30', { Dauer_Ist: 60 * 60 }), // Ist 1:00 statt Soll 0:30
    offen('2026-10-20', '09:00', '09:45'),                     // nicht bestätigt -> nicht berechnet
    b('2026-10-20', '10:00', '10:45', { Dauer_Ist: 0 }),       // bestätigt 0 (nicht angetroffen)
    b('2026-10-20', '11:00', '12:00', { Status: 'Abgesagt' }), // zählt nicht, auch nicht im Soll
    b('2026-10-24', '08:00', '09:00'),                         // Zukunft, zählt nicht
  ], { jetzt: ZEIT });
  const e = r.tage[0].zeilen.filter((z) => z.art === 'einsatz');
  assert.deepEqual(e.map((z) => [z.sollMin, z.istMin, z.min, z.quelle]), [
    [30, 60, 60, 'ist'], [45, 0, 0, 'ist'],
  ]);
  assert.equal(hm(r.tage[0].sollMin), '1:15');
  assert.equal(hm(r.summen.sollMin), '1:15');
  assert.equal(hm(r.summen.einsatzMin), '1:00'); // 1:00 + 0:00
  assert.equal(r.summen.ohneIst, 1);
  assert.equal(hm(r.summen.ohneIstSollMin), '0:45');
});
