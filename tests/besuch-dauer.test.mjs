// Tests für /api/besuch-dauer (Ist-Zeit erfassen) - mit Airtable-Attrappe, ohne Netz.
// Aufruf: npm test   (alle Testdaten frei erfunden)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airtableAttrappe, antwort, anfrage, antwortObjekt } from './_hilfen.mjs';
import handler from '../api/besuch-dauer.js';

const PERSONAL = 'tbl3pMfhOLYPsQ5jF';
const BESUCHE = 'tblXJOSz4LaJCG10M';
const TOKEN = 'MaToken_abcdefghijklmnopqrstuvwxyz012345';
const MA_ID = 'recPflTest0000001';
const ANDERE = 'recPflTest0000002';
const BESUCH_ID = 'recBesTest0000001';

// Besuch mit den angegebenen Feldern; protokolliert Schreibzugriffe.
function attrappe(felder) {
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
const erfassen = async (minuten = 45) => {
  const res = antwortObjekt();
  await handler(anfrage({ method: 'POST', token: TOKEN, body: { besuchId: BESUCH_ID, minuten } }), res);
  return res;
};
const EINSATZ = { Datum: '2026-11-09', Von: '08:00', Bis: '08:45', Pfleger: [MA_ID], Patient: ['recPatTest0000001'], Patient_Name: ['Erika Musterfrau'] };

test('eigener Einsatz: Ist-Zeit wird in Sekunden gespeichert, mit Zeitpunkt', async () => {
  const log = attrappe(EINSATZ);
  const res = await erfassen(45);
  assert.equal(res.statusCode, 200);
  assert.equal(log.patches.length, 1);
  assert.equal(log.patches[0].Dauer_Ist, 2700);
  assert.match(log.patches[0].Erledigt_Am, /^\d{4}-\d{2}-\d{2}T/);
});

test('Urlaub/Abwesenheit (eigene Zeile ohne Klient): keine Zeiterfassung, nichts wird geschrieben', async () => {
  for (const art of ['Urlaub', 'Abwesend', { id: 'selTest', name: 'Urlaub' }]) {
    const log = attrappe({ Datum: '2026-11-09', Pfleger: [MA_ID], 'Abwesend/Urlaub': art });
    const res = await erfassen(360);
    assert.equal(res.statusCode, 409, JSON.stringify(art));
    assert.equal(res.body.error, 'abwesenheit');
    assert.equal(log.patches.length, 0);
  }
});

test('Auswahl an einem Einsatz MIT Klient: bleibt bestätigbar (z. B. durch die Vertretung)', async () => {
  const log = attrappe({ ...EINSATZ, Pfleger: [ANDERE], Pfleger_Ersatz: [MA_ID], 'Abwesend/Urlaub': 'Urlaub' });
  const res = await erfassen(30);
  assert.equal(res.statusCode, 200);
  assert.equal(log.patches[0].Dauer_Ist, 1800);
});

test('fremde Abwesenheit: 403 vor jeder inhaltlichen Auskunft', async () => {
  const log = attrappe({ Datum: '2026-11-09', Pfleger: [ANDERE], 'Abwesend/Urlaub': 'Urlaub' });
  const res = await erfassen(30);
  assert.equal(res.statusCode, 403);
  assert.equal(log.patches.length, 0);
});

test('bereits bestätigt bleibt gesperrt; Eingaben werden geprüft; ohne Token 401', async () => {
  attrappe({ ...EINSATZ, Dauer_Ist: 2700, Erledigt_Am: '2026-11-09T08:00:00.000Z' });
  assert.equal((await erfassen(30)).statusCode, 409);
  attrappe(EINSATZ);
  assert.equal((await erfassen(-5)).statusCode, 400);
  assert.equal((await erfassen(2000)).statusCode, 400);
  const res = antwortObjekt();
  await handler(anfrage({ method: 'POST', body: { besuchId: BESUCH_ID, minuten: 30 } }), res);
  assert.equal(res.statusCode, 401);
  const get = antwortObjekt();
  await handler(anfrage({ method: 'GET', token: TOKEN }), get);
  assert.equal(get.statusCode, 405);
});
