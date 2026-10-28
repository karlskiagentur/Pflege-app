// NEU-Markierungen der Apps (src/neuigkeiten.ts): was seit dem letzten Blick neu ist.
// Die TypeScript-Datei wird hier mit dem TypeScript-Compiler übersetzt (läuft so mit
// jeder Node-22-Version). Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const quelle = readFileSync(new URL('../src/neuigkeiten.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(quelle, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const N = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const HEUTE = Date.parse('2026-11-03T00:00:00');
const einsatz = (id, felder = {}) => ({
  id,
  fields: {
    Status: 'Geplant', Uhrzeit: '2026-11-03T07:00:00.000Z', Datum: '2026-11-03', Von: '08:00', Bis: '08:30',
    'Tätigkeit': 'Grundpflege', Patient_Name: ['Erika Musterfrau'], Adresse_Klient: ['Musterweg 1'], ...felder,
  },
});

test('Ziel aus der Adresse: nur bekannte Ziele', () => {
  assert.equal(N.zielAusAdresse('?ziel=plan'), 'plan');
  assert.equal(N.zielAusAdresse('?x=1&ziel=lohn'), 'lohn');
  assert.equal(N.zielAusAdresse('?ziel=javascript:alert(1)'), null);
  assert.equal(N.zielAusAdresse(''), null);
  assert.equal(N.istPushZiel('dokumente'), true);
  assert.equal(N.istPushZiel(42), false);
});

test('Fingerabdruck: Status + Prüfwert - keine Namen oder Adressen im Speicher', () => {
  const sig = N.einsatzSignatur(einsatz('recA'));
  assert.match(sig, /^Geplant\|[0-9a-z]+$/);
  assert.ok(!/Erika|Musterweg|Grundpflege/.test(sig));
  assert.notEqual(N.einsatzSignatur(einsatz('recA', { Von: '09:00' })), sig);
  // eigene Zeiterfassung des Mitarbeiters ist keine Änderung des Büros
  assert.equal(N.einsatzSignatur(einsatz('recA', { Dauer_Ist: 1800, Erledigt_Am: '2026-11-03T08:00:00.000Z' })), sig);
});

test('Markierungen: erste Nutzung ohne Markierung, danach neu / geändert / abgesagt', () => {
  const liste = [einsatz('recA'), einsatz('recB'), einsatz('recAlt', { Uhrzeit: '2026-11-01T07:00:00.000Z', Datum: '2026-11-01' })];
  assert.deepEqual(N.einsatzMarken(liste, null, HEUTE), {});
  const stand = N.einsatzStand(liste, HEUTE);
  assert.deepEqual(Object.keys(stand).sort(), ['recA', 'recB']); // Vergangenes wird nicht gemerkt
  assert.deepEqual(N.einsatzMarken(liste, stand, HEUTE), {});
  const neu = [
    einsatz('recA', { Uhrzeit: '2026-11-03T08:00:00.000Z', Von: '09:00' }),
    einsatz('recB', { Status: 'Abgesagt' }),
    einsatz('recC'),
    einsatz('recAlt', { Uhrzeit: '2026-11-01T07:00:00.000Z', Datum: '2026-11-01', Status: 'Abgesagt' }),
  ];
  assert.deepEqual(N.einsatzMarken(neu, stand, HEUTE), { recA: 'geaendert', recB: 'abgesagt', recC: 'neu' });
  // schon abgesagt gesehen, danach nur Uhrzeit geändert -> "geändert", nicht erneut "abgesagt"
  const standAbgesagt = N.einsatzStand([einsatz('recB', { Status: 'Abgesagt' })], HEUTE);
  assert.deepEqual(N.einsatzMarken([einsatz('recB', { Status: 'Abgesagt', Von: '10:00' })], standAbgesagt, HEUTE), { recB: 'geaendert' });
});

test('Listen (Mitteilungen/Lohn): erste Nutzung nur frische, danach alle ungesehenen', () => {
  const liste = [{ k: 'a', frisch: true }, { k: 'b', frisch: false }, { k: 'c', frisch: false }];
  const key = (x) => x.k, frisch = (x) => x.frisch;
  assert.deepEqual([...N.neueSchluessel(liste, key, null, frisch)], ['a']);
  assert.deepEqual([...N.neueSchluessel(liste, key, ['b'], frisch)], ['a', 'c']);
  assert.deepEqual([...N.neueSchluessel(liste, key, ['a', 'b', 'c'], frisch)], []);
  assert.deepEqual(N.gesehenErgaenzen(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.equal(N.gesehenErgaenzen(Array.from({ length: 400 }, (_, i) => `k${i}`), ['neu']).length, 300);
  assert.equal(N.gesehenErgaenzen(null, ['x'])[0], 'x');
});

test('Datum: "dd.mm.yyyy" und ISO, Unsinn -> 0', () => {
  assert.equal(new Date(N.datumMs('22.10.2026')).getDate(), 22);
  assert.equal(N.datumMs('2026-10-22T08:00:00.000Z'), Date.parse('2026-10-22T08:00:00.000Z'));
  assert.equal(N.datumMs('kaputt'), 0);
  assert.equal(N.anzeigeZeit('kaputt'), '');
});

test('Speicher: kaputte oder gesperrte Werte führen nie zum Absturz', () => {
  const daten = new Map([['kaputt', '{nicht json']]);
  globalThis.localStorage = { getItem: (k) => daten.get(k) ?? null, setItem: (k, v) => { if (k === 'voll') throw new Error('QuotaExceeded'); daten.set(k, v); } };
  assert.deepEqual(N.ladeJson('kaputt', []), []);
  assert.equal(N.ladeJson('fehlt', null), null);
  N.speichereJson('ok', { a: 1 });
  assert.deepEqual(N.ladeJson('ok', null), { a: 1 });
  assert.doesNotThrow(() => N.speichereJson('voll', { a: 1 }));
  globalThis.localStorage = { getItem: () => { throw new Error('gesperrt'); }, setItem: () => { throw new Error('gesperrt'); } };
  assert.deepEqual(N.ladeJson('x', { leer: true }), { leer: true });
  delete globalThis.localStorage;
});
