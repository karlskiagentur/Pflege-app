// Tests für /api/ma-termine (Einsätze der Mitarbeiter-App) - mit Airtable-Attrappe, ohne Netz.
// Aufruf: npm test   (alle Testdaten frei erfunden)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airtableAttrappe, antwort, anfrage, antwortObjekt } from './_hilfen.mjs';
import handler, { fensterFormel, FENSTER_TAGE } from '../api/ma-termine.js';

const PERSONAL = 'tbl3pMfhOLYPsQ5jF';
const BESUCHE = 'tblXJOSz4LaJCG10M';
const TOKEN = 'MaToken_abcdefghijklmnopqrstuvwxyz012345';
const MA_ID = 'recPflTest0000001';
const NEU = { id: 'recBesTest0000001', fields: { Datum: '2026-10-20', Pfleger_ID: [MA_ID] } };
const ALT = { id: 'recBesTest0000002', fields: { Datum: '2025-01-10', Pfleger_ID: [MA_ID] } };

function attrappe({ aktiv = true, fenster } = {}) {
  return airtableAttrappe(async (a) => {
    if (a.tabelle === PERSONAL) {
      return antwort(200, { records: a.formel.includes(TOKEN) ? [{ id: MA_ID, fields: { Name: 'Anna Beispiel', ...(aktiv ? { Aktiv: true } : {}) } }] : [] });
    }
    if (a.tabelle === BESUCHE) {
      const mitFenster = a.formel.includes('DATEADD(TODAY()');
      if (mitFenster) return fenster ? fenster() : antwort(200, { records: [NEU] });
      return antwort(200, { records: [NEU, ALT] });
    }
    return antwort(404, {});
  });
}

const ruhig = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('Fensterformel: eigener Mitarbeiter, 70 Tage zurück, Einsätze ohne Datum immer dabei', () => {
  const f = fensterFormel(MA_ID);
  assert.equal(FENSTER_TAGE, 70);
  assert.ok(FENSTER_TAGE >= 62 + 3, 'Vormonat muss immer vollständig abgedeckt sein');
  assert.ok(f.startsWith(`AND(FIND('${MA_ID}', ARRAYJOIN({Pfleger_ID})), OR(`));
  assert.ok(f.includes(`IF({Datum}, IS_AFTER({Datum}, DATEADD(TODAY(), -70, 'days')), 1)`));
  assert.ok(f.includes(`IF({Uhrzeit}, IS_AFTER({Uhrzeit}, DATEADD(TODAY(), -70, 'days')), 0)`));
  // Klammern ausgeglichen
  assert.equal((f.match(/\(/g) || []).length, (f.match(/\)/g) || []).length);
  // Anführungszeichen werden escaped (Formel-Injection)
  assert.ok(fensterFormel("rec'x").includes("rec\\'x"));
});

test('ohne Token -> 401', async () => {
  attrappe();
  const res = antwortObjekt();
  await handler(anfrage({ method: 'POST' }), res);
  assert.equal(res.statusCode, 401);
});

test('deaktivierter Mitarbeiter -> 401', async () => {
  attrappe({ aktiv: false });
  const res = antwortObjekt();
  await handler(anfrage({ method: 'POST', token: TOKEN }), res);
  assert.equal(res.statusCode, 401);
});

test('liefert die Einsätze im Zeitfenster mit EINER Abfrage', async () => {
  const p = attrappe();
  const res = antwortObjekt();
  await handler(anfrage({ method: 'POST', token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [NEU]);
  const besuche = p.aufrufe.filter((a) => a.tabelle === BESUCHE);
  assert.equal(besuche.length, 1);
  assert.equal(besuche[0].formel, fensterFormel(MA_ID));
});

test('lehnt Airtable die Fensterformel ab (422) -> bisherige Abfrage, App läuft weiter', async () => {
  const p = attrappe({ fenster: () => antwort(422, { error: { type: 'INVALID_FILTER_BY_FORMULA' } }) });
  const res = antwortObjekt();
  await ruhig(() => handler(anfrage({ method: 'POST', token: TOKEN }), res));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [NEU, ALT]);
  assert.equal(p.aufrufe.filter((a) => a.tabelle === BESUCHE).length, 2);
});

test('leeres Fenster -> zur Sicherheit bisherige Abfrage', async () => {
  attrappe({ fenster: () => antwort(200, { records: [] }) });
  const res = antwortObjekt();
  await handler(anfrage({ method: 'POST', token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [NEU, ALT]);
});

test('Rate-Limit (429) -> 503 „Bitte kurz erneut versuchen"', async () => {
  attrappe({ fenster: () => antwort(429, { error: 'RATE_LIMIT' }) });
  const res = antwortObjekt();
  await ruhig(() => handler(anfrage({ method: 'POST', token: TOKEN }), res));
  assert.equal(res.statusCode, 503);
});

test('nur POST erlaubt', async () => {
  attrappe();
  const res = antwortObjekt();
  await handler(anfrage({ method: 'GET', token: TOKEN }), res);
  assert.equal(res.statusCode, 405);
});
