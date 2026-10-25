// Cron-Schutz (api/_lib.js cronErlaubt) für alle geplanten Läufe: falsches Secret -> 401,
// fehlendes CRON_SECRET in Vercel -> 500 + Alarm (einmal je Instanz), nie ein stiller Ausfall.
// Airtable ist eine Attrappe, alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airtableAttrappe, antwort, antwortObjekt } from './_hilfen.mjs';
import monatslauf from '../api/stundenzettel-monatslauf.js';
import lohnAufbewahrung from '../api/lohn-aufbewahrung.js';

const anfrage = (auth) => ({ method: 'GET', headers: auth ? { authorization: auth } : {}, query: {} });

async function mitKonsole(fn) {
  const meldungen = [];
  const { error, warn } = console;
  console.error = (...a) => meldungen.push(a.join(' '));
  console.warn = () => {};
  try { await fn(); } finally { console.error = error; console.warn = warn; }
  return meldungen;
}

test('Cron: fehlendes CRON_SECRET -> 500, Alarm genau einmal, kein Airtable-Zugriff', async () => {
  delete process.env.CRON_SECRET;
  const p = airtableAttrappe(async () => antwort(404, {}));
  const meldungen = await mitKonsole(async () => {
    for (const handler of [monatslauf, lohnAufbewahrung, monatslauf]) {
      const res = antwortObjekt();
      await handler(anfrage('Bearer irgendwas'), res);
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { status: 'error' });
    }
  });
  assert.equal(p.aufrufe.length, 0);
  assert.equal(meldungen.filter((m) => m.includes('[ALERT]') && m.includes('CRON_SECRET fehlt')).length, 1);
});

test('Cron: falsches oder fehlendes Authorization -> 401 ohne Alarm', async () => {
  process.env.CRON_SECRET = 'cron-secret-test-schutz';
  const p = airtableAttrappe(async () => antwort(404, {}));
  const meldungen = await mitKonsole(async () => {
    for (const handler of [monatslauf, lohnAufbewahrung]) {
      for (const auth of ['Bearer falsch', '', 'cron-secret-test-schutz', 'Bearer cron-secret-test-schutz ']) {
        const res = antwortObjekt();
        await handler(anfrage(auth), res);
        assert.equal(res.statusCode, 401, `${auth}`);
      }
    }
  });
  assert.equal(p.aufrufe.length, 0);
  assert.equal(meldungen.filter((m) => m.includes('[ALERT]')).length, 0);
});
