// Tests für den Abrechnungszeitraum der Stundenzettel (api/_abrechnung.js): seit November 2026
// vom 27. des Vormonats bis zum 26., Übergang November 2026 = 01.11.–26.11., davor Kalendermonate.
// Reine Datumslogik, ohne Netz. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as abr from '../api/_abrechnung.js';

const {
  ERSTER_STICHTAG_MONAT, STICHTAG, monatPlus, abrechnungszeitraum, abrechnungsmonatFuer, imZeitraum, zeitraumText,
  ersterTagDesZeitraums, abgeschlossenerMonat,
} = abr;

// Alle Kalendertage von..bis (einschließlich) als 'YYYY-MM-DD'
function* tage(von, bis) {
  const d = new Date(`${von}T12:00:00Z`);
  for (;;) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > bis) return;
    yield iso;
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
const naechsterTag = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

test('Regel laut Vorgabe: bis Oktober 2026 Kalendermonat, November 2026 = 01.–26.11., danach 27. bis 26.', () => {
  assert.equal(ERSTER_STICHTAG_MONAT, '2026-11');
  assert.equal(STICHTAG, 26);
  assert.deepEqual(abrechnungszeitraum('2026-09'), { von: '2026-09-01', bis: '2026-09-30' });
  assert.deepEqual(abrechnungszeitraum('2026-10'), { von: '2026-10-01', bis: '2026-10-31' });
  assert.deepEqual(abrechnungszeitraum('2026-11'), { von: '2026-11-01', bis: '2026-11-26' });
  assert.deepEqual(abrechnungszeitraum('2026-12'), { von: '2026-11-27', bis: '2026-12-26' });
  assert.deepEqual(abrechnungszeitraum('2027-01'), { von: '2026-12-27', bis: '2027-01-26' });
  assert.deepEqual(abrechnungszeitraum('2027-03'), { von: '2027-02-27', bis: '2027-03-26' });
  assert.deepEqual(abrechnungszeitraum('2028-03'), { von: '2028-02-27', bis: '2028-03-26' });
  assert.throws(() => abrechnungszeitraum('2026-13'));
  assert.throws(() => abrechnungszeitraum('November 2026'));
  assert.throws(() => abrechnungszeitraum(undefined));
});

test('Zuordnung eines Datums zum Abrechnungsmonat (Grenzen)', () => {
  assert.equal(abrechnungsmonatFuer('2026-10-27'), '2026-10'); // vor der Umstellung: Kalendermonat
  assert.equal(abrechnungsmonatFuer('2026-10-31'), '2026-10');
  assert.equal(abrechnungsmonatFuer('2026-11-01'), '2026-11');
  assert.equal(abrechnungsmonatFuer('2026-11-26'), '2026-11');
  assert.equal(abrechnungsmonatFuer('2026-11-27'), '2026-12');
  assert.equal(abrechnungsmonatFuer('2026-12-26'), '2026-12');
  assert.equal(abrechnungsmonatFuer('2026-12-27'), '2027-01'); // Jahreswechsel
  assert.equal(abrechnungsmonatFuer('2026-12-31'), '2027-01');
  assert.equal(abrechnungsmonatFuer('2027-02-28'), '2027-03');
  for (const kaputt of ['', '2026-11', '27.11.2026', '2026-13-01', '2026-11-32', null, undefined, 20261127]) {
    assert.equal(abrechnungsmonatFuer(kaputt), '', String(kaputt));
  }
});

test('Lückenlos und ohne Überschneidung: jeder Tag 2026–2031 gehört zu genau einem Zeitraum', () => {
  for (const d of tage('2026-01-01', '2031-12-31')) {
    const ym = abrechnungsmonatFuer(d);
    const z = abrechnungszeitraum(ym);
    assert.ok(imZeitraum(d, z), `${d} nicht in ${ym}`);
    assert.ok(!imZeitraum(d, abrechnungszeitraum(monatPlus(ym, -1))), `${d} auch im Vormonat`);
    assert.ok(!imZeitraum(d, abrechnungszeitraum(monatPlus(ym, 1))), `${d} auch im Folgemonat`);
  }
  // aufeinanderfolgende Zeiträume schließen direkt aneinander an
  for (let ym = '2026-01'; ym < '2031-12'; ym = monatPlus(ym, 1)) {
    assert.equal(naechsterTag(abrechnungszeitraum(ym).bis), abrechnungszeitraum(monatPlus(ym, 1)).von, ym);
  }
});

test('Stichtag des Monatslaufs: erster Tag eines Zeitraums, abgeschlossen ist der vorige', () => {
  assert.equal(ersterTagDesZeitraums('2026-11-01'), true);   // Übergangsmonat beginnt (Oktober wurde am 01.11. abgeschlossen)
  assert.equal(ersterTagDesZeitraums('2026-11-27'), true);
  assert.equal(ersterTagDesZeitraums('2026-12-01'), false);  // kein Lauf mehr am 1.
  assert.equal(ersterTagDesZeitraums('2026-12-27'), true);
  assert.equal(ersterTagDesZeitraums('2027-01-26'), false);
  assert.equal(ersterTagDesZeitraums('kaputt'), false);
  assert.equal(abgeschlossenerMonat('2026-11-01'), '2026-10');
  assert.equal(abgeschlossenerMonat('2026-11-27'), '2026-11');
  assert.equal(abgeschlossenerMonat('2026-12-05'), '2026-11');
  assert.equal(abgeschlossenerMonat('2026-12-27'), '2026-12');
  assert.equal(abgeschlossenerMonat('2027-01-27'), '2027-01');
  assert.throws(() => abgeschlossenerMonat('kaputt'));
  // genau ein Stichtag je Abrechnungsmonat: 01.11.2026 (Beginn Übergangsmonat), danach immer der 27.
  const stichtage = [...tage('2026-11-01', '2027-12-31')].filter(ersterTagDesZeitraums);
  assert.equal(stichtage.length, 15); // 01.11.2026, 27.11.2026, 27.12.2026, 12 × 2027
  assert.equal(stichtage[0], '2026-11-01');
  assert.ok(stichtage.slice(1).every((d) => d.endsWith('-27')));
});

test('Hilfen: Monat verschieben, Zeitraum-Text, im Zeitraum', () => {
  assert.equal(monatPlus('2026-12', 1), '2027-01');
  assert.equal(monatPlus('2027-01', -1), '2026-12');
  assert.equal(monatPlus('2026-11', -13), '2025-10');
  assert.equal(zeitraumText(abrechnungszeitraum('2026-11')), '01.11.–26.11.2026');
  assert.equal(zeitraumText(abrechnungszeitraum('2026-12')), '27.11.–26.12.2026');
  assert.equal(zeitraumText(abrechnungszeitraum('2027-01')), '27.12.2026–26.01.2027');
  const z = abrechnungszeitraum('2026-12');
  assert.equal(imZeitraum('2026-11-27', z), true);
  assert.equal(imZeitraum('2026-12-26', z), true);
  assert.equal(imZeitraum('2026-11-26', z), false);
  assert.equal(imZeitraum('2026-12-27', z), false);
  assert.equal(imZeitraum(undefined, z), false);
  assert.equal(imZeitraum('2026-12-01', null), false);
});

test('Modul ist frei von Abhängigkeiten (wird auch ins App-Bundle übernommen) und vollständig typisiert', () => {
  const quelle = readFileSync(new URL('../api/_abrechnung.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(quelle), 'api/_abrechnung.js darf nichts importieren');
  assert.ok(!/process\.env|require\(/.test(quelle));
  const typen = readFileSync(new URL('../api/_abrechnung.d.ts', import.meta.url), 'utf8');
  for (const name of Object.keys(abr)) assert.ok(new RegExp(`\\b${name}\\b`).test(typen), `${name} fehlt in _abrechnung.d.ts`);
});

test('Mitarbeiter-App rechnet „Lohn / Zeit“ im selben Zeitraum (statt Kalendermonat)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes("from '../api/_abrechnung'"));
  assert.ok(/const zeitAktuell = abrechnungsmonatFuer\(zeitHeute\)/.test(app));
  assert.ok(/imZeitraum\(String\(getValue\(t, 'Datum'\) \|\| ''\)\.slice\(0, 10\), zeitZeitraum\)/.test(app));
  assert.ok(!/slice\(0, 7\) === zeitYm/.test(app), 'alte Kalendermonats-Zuordnung noch vorhanden');
  assert.ok(app.includes('{zeitZeitraumLabel}'));
});

test('Mitarbeiter-App: Urlaub/Abwesenheit als eigene Karte, ohne Zeiterfassung, nie in „Lohn / Zeit“', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // gleiche Regel wie api/_zeitkonto.js: nur eine Zeile OHNE Klient ist eine Abwesenheit
  assert.ok(app.includes("getValue(t, 'Patient') || getValue(t, 'Patient_Name') ? '' : getValue(t, 'Abwesend/Urlaub').trim()"));
  // alle drei Listen (Übersicht, Tagesplan heute, Demnächst) zeigen die Karte vor allem anderen
  const karten = app.match(/if \(abwesenheitVon\(t\)\) return <AbwesenheitKarte /g) || [];
  assert.equal(karten.length, 3, 'Urlaubs-Karte fehlt in einer Liste');
  // die Karte hat weder Ist-Zeit-Eingabe noch „Problem melden“
  const karte = app.slice(app.indexOf('function AbwesenheitKarte'), app.indexOf('function AbwesenheitKarte') + 4000);
  const ende = karte.indexOf('\n}\n');
  const koerper = karte.slice(0, ende);
  assert.ok(ende > 0);
  assert.ok(!/Dauer_Ist|besuch-dauer|Problem melden|<input/.test(koerper));
  // Tageszuordnung ganztägiger Einträge über das Datum, Zähler nur für echte Einsätze
  assert.ok(app.includes('const d = zeitpunktMs(t);'));
  assert.ok(app.includes('const einsaetzeHeute = termineHeute.filter((t) => !abwesenheitVon(t));'));
  // „Lohn / Zeit“: Urlaub zählt nie als Arbeitszeit
  assert.ok(/const zeitEinsaetze = \(zeitTermine \|\| \[\]\)\s*\.filter\(\(t\) => !abwesenheitVon\(t\)\)/.test(app));
});
