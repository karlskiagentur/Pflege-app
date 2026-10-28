// Mitarbeiternamen in Kurzform ("Vorname N."): Ausfall-Mitteilung nimmt die Namen aus den
// verknüpften Mitarbeitern, die Mitarbeiter-App erhält den aktuellen Anzeigenamen.
// Airtable und Web-Push sind Attrappen; alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { airtableAttrappe, antwort, antwortObjekt, anfrage } from './_hilfen.mjs';
import maTermine from '../api/ma-termine.js';

const pushes = [];
webpush.setVapidDetails = () => {};
webpush.sendNotification = async (sub, payload) => { pushes.push(JSON.parse(payload)); return { statusCode: 201 }; };
const { default: pushEvent } = await import('../api/push-event.js');

const MITTEILUNGEN = 'tblQYvzkhvBnDyXdv', PERSONAL = 'tbl3pMfhOLYPsQ5jF', BESUCHE = 'tblXJOSz4LaJCG10M';
const abo = (n) => JSON.stringify({ endpoint: `https://push.example.invalid/${n}`, keys: { p256dh: 'p', auth: 'a' } });
const personal = {
  recMaNamenTest001: { id: 'recMaNamenTest001', fields: { Name: 'Erika M.', Aktiv: true, Push_Subscription: abo(1) } },
  recMaNamenTest002: { id: 'recMaNamenTest002', fields: { Name: 'Jürgen Ö.', Aktiv: true, Push_Subscription: abo(2) } },
};

function mitteilung(fields) {
  airtableAttrappe(async (a) => {
    const id = a.url.pathname.split('/')[4];
    if (a.methode === 'PATCH') return antwort(200, {});
    // Versendet wird nur, was das Büro auf "Senden" gestellt hat (Status-Sperre)
    if (a.tabelle === MITTEILUNGEN) return antwort(200, { id, fields: { Status: 'Senden', ...fields } });
    if (a.tabelle === PERSONAL) return personal[id] ? antwort(200, personal[id]) : antwort(404, {});
    return antwort(404, {});
  });
}
const senden = async () => {
  const res = antwortObjekt();
  await pushEvent({ method: 'POST', headers: {}, body: { type: 'mitteilung', recordId: 'recMitteilung0001' } }, res);
  return res;
};

test('Ausfall-Mitteilung: Namen aus den verknüpften Mitarbeitern (Kurzform), nicht aus den alten Textfeldern', async () => {
  pushes.length = 0;
  mitteilung({
    Typ: 'Ausfall', Ausfall_Mitarbeiter: ['recMaNamenTest001'], Ersatz_Mitarbeiter: ['recMaNamenTest002'],
    Mitarbeiter_Ausfall: 'Erika Mustermann', Mitarbeiter_Ersatz: 'Jürgen Österreicher',
  });
  const res = await senden();
  assert.equal(res.body.status, 'ok');
  assert.equal(pushes.length, 2);
  for (const p of pushes) {
    assert.equal(p.body, 'Mitarbeiter/in Erika M. fällt aus, deshalb kommt Mitarbeiter/in Jürgen Ö.');
    assert.ok(!/Mustermann|Österreicher/.test(p.body));
  }
});

test('Ausfall-Mitteilung: ohne Verknüpfung Rückfall auf das Textfeld, ohne Ersatz kurzer Satz', async () => {
  pushes.length = 0;
  // Zielgruppe "Alle Mitarbeiter": Abos kommen aus der Personal-Liste
  airtableAttrappe(async (a) => {
    if (a.methode === 'PATCH') return antwort(200, {});
    if (a.tabelle === MITTEILUNGEN) return antwort(200, { id: 'recMitteilung0001', fields: { Status: 'Senden', Typ: 'Ausfall', Zielgruppe: 'Alle Mitarbeiter', Mitarbeiter_Ausfall: 'Erika M.' } });
    if (a.tabelle === PERSONAL) return antwort(200, { records: [personal.recMaNamenTest001] });
    return antwort(404, {});
  });
  const res = await senden();
  assert.equal(res.body.status, 'ok');
  assert.equal(pushes[0].body, 'Mitarbeiter/in Erika M. fällt aus.');
});

test('Mitarbeiter-App: aktueller Anzeigename kommt im Kopf X-Mitarbeiter-Name (kodiert)', async () => {
  airtableAttrappe(async (a) => {
    if (a.tabelle === PERSONAL) return antwort(200, { records: [{ id: 'recMaNamenTest002', fields: { Aktiv: true, Name: 'Jürgen Ö.' } }] });
    if (a.tabelle === BESUCHE) return antwort(200, { records: [] });
    return antwort(404, {});
  });
  const res = antwortObjekt();
  await maTermine(anfrage({ method: 'POST', token: 'tokenMitarbeiterNamen123456' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-Mitarbeiter-Name'], 'J%C3%BCrgen%20%C3%96.');
  assert.equal(decodeURIComponent(res.headers['X-Mitarbeiter-Name']), 'Jürgen Ö.');
});
