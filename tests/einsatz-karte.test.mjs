// Tests für /api/einsatz-karte (Tagesplan aller Mitarbeiter für die Büro-Karte) - mit
// Airtable-Attrappe, ohne Netz. Alle Testdaten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airtableAttrappe, antwort, antwortObjekt } from './_hilfen.mjs';
import handler from '../api/einsatz-karte.js';

process.env.KARTE_SECRET = 'karten-schluessel-1234567890';
const PATIENTEN = 'tbl5uUUSgC9p10BHQ', PERSONAL = 'tbl3pMfhOLYPsQ5jF', BESUCHE = 'tblXJOSz4LaJCG10M';
const MA = 'recMaKarteTest001', PAT = 'recPatKarteTest01';

function attrappe(besuche) {
  const log = { besucheFelder: [] };
  airtableAttrappe(async (a) => {
    if (a.tabelle === BESUCHE) { log.besucheFelder = a.url.searchParams.getAll('fields[]'); return antwort(200, { records: besuche }); }
    if (a.tabelle === PERSONAL) return antwort(200, { records: [{ id: MA, fields: { Name: 'Anna B.', Fahrzeug: 'Auto 1' } }] });
    if (a.tabelle === PATIENTEN) return antwort(200, { records: [{ id: PAT, fields: { Name: 'Erika Musterfrau', Anschrift: 'Musterweg 1', Geo_Lat: 50.1, Geo_Lng: 8.6 } }] });
    return antwort(404, {});
  });
  return log;
}
const abrufen = async () => {
  const res = antwortObjekt();
  await handler({ method: 'GET', headers: { 'x-karte-key': process.env.KARTE_SECRET }, query: { datum: '2026-11-11' } }, res);
  return res;
};

test('Urlaub/Abwesenheit mit Uhrzeit erscheint weder auf der Karte noch unter „ohne Standort“', async () => {
  const log = attrappe([
    { id: 'recKarteEinsatz01', fields: { Datum: '2026-11-11', Von: '08:00', Bis: '09:00', Status: 'Geplant', Patient: [PAT], Pfleger: [MA], 'Tätigkeit': 'Grundpflege' } },
    { id: 'recKarteUrlaub001', fields: { Datum: '2026-11-11', Von: '12:00', Bis: '16:00', Status: 'Geplant', Pfleger: [MA], 'Abwesend/Urlaub': 'Abwesend', 'Tätigkeit': 'Fortbildung' } },
  ]);
  const res = await abrufen();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.mitarbeiter.map((m) => m.einsaetze.map((e) => e.id)), [['recKarteEinsatz01']]);
  assert.deepEqual(res.body.ohneStandort, []);
  assert.ok(log.besucheFelder.includes('Abwesend/Urlaub'));
});

test('Auswahl an einem Einsatz MIT Klient: bleibt auf der Karte (der Einsatz findet statt)', async () => {
  attrappe([
    { id: 'recKarteEinsatz02', fields: { Datum: '2026-11-11', Von: '08:00', Bis: '09:00', Status: 'Geplant', Patient: [PAT], Pfleger: [MA], 'Abwesend/Urlaub': 'Urlaub' } },
  ]);
  const res = await abrufen();
  assert.deepEqual(res.body.mitarbeiter.map((m) => m.einsaetze.map((e) => e.id)), [['recKarteEinsatz02']]);
});

test('ohne gültigen Karten-Schlüssel -> 401', async () => {
  attrappe([]);
  const res = antwortObjekt();
  await handler({ method: 'GET', headers: { 'x-karte-key': 'falsch' }, query: {} }, res);
  assert.equal(res.statusCode, 401);
});
