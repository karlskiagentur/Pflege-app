// Tests für die Lohnabrechnungen der Mitarbeiter: Fristen (3 Monate, Erinnerung 7 Tage
// vorher), App-Liste, geschützter Download, Push beim Hochladen und täglicher Lauf.
// Airtable und Web-Push sind Attrappen; alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { airtableAttrappe, antwort, antwortObjekt, anfrage } from './_hilfen.mjs';
import {
  berlinDatum, plusMonate, plusTage, tageZwischen, monatName, monatDesEintrags, lohnZustand, lohnFuerApp, lohnAufbewahrung,
} from '../api/_lohn.js';
import listeHandler from '../api/lohn-liste.js';
import downloadHandler from '../api/lohn-download.js';
import aufbewahrungHandler from '../api/lohn-aufbewahrung.js';

// Web-Push-Attrappe (vor dem Laden von push-event, das beim Import konfiguriert)
const pushes = [];
webpush.setVapidDetails = () => {};
webpush.sendNotification = async (sub, payload) => {
  pushes.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
  if (String(sub.endpoint).endsWith('/abgelaufen')) { const e = new Error('Gone'); e.statusCode = 410; throw e; }
  return { statusCode: 201 };
};
const { default: pushEvent } = await import('../api/push-event.js');

process.env.CRON_SECRET = 'cron-secret-lohn-test';
const LOHN = 'tblMoak6mpdJtTM8S', PERSONAL = 'tbl3pMfhOLYPsQ5jF', PATIENTEN = 'tbl5uUUSgC9p10BHQ';
const MA = 'recMaLohnTest0001', MA2 = 'recMaLohnTest0002';
const TOKEN = 'tokenMitarbeiterLohn1234567890';
const DATEI_URL = 'https://v5.airtableusercontent.com/v3/u/test/abrechnung';

const datei = (filename = 'Abrechnung Oktober.pdf') => ({ id: 'attTest', url: DATEI_URL, filename, type: 'application/pdf' });
const lohn = (id, felder = {}) => ({
  id,
  createdTime: '2026-10-22T08:00:00.000Z',
  fields: { Mitarbeiter: [MA], Zeitraum: '2026-10-01', Datei: [datei()], Hochgeladen_Am: '2026-10-22T08:00:00.000Z', ...felder },
});
const abo = (endpoint = 'https://push.example.invalid/geraet1') => JSON.stringify({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
const personal = (id = MA, felder = {}) => ({ id, fields: { Name: 'Anna Beispiel', Aktiv: true, Push_Subscription: abo(), ...felder } });
const recId = (a) => a.url.pathname.split('/')[4];
const dateiAntwort = () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('%PDF-Test').buffer });

// --- Fristen ------------------------------------------------------------------------

test('Datum: Berliner Kalendertag, Monatsende, Schaltjahr, Zeitumstellung', () => {
  assert.equal(berlinDatum('2026-10-21T22:30:00Z'), '2026-10-22'); // 00:30 Sommerzeit
  assert.equal(berlinDatum('2026-12-31T23:30:00Z'), '2027-01-01'); // 00:30 Winterzeit
  assert.equal(berlinDatum('2026-10-22T21:59:00Z'), '2026-10-22');
  assert.equal(plusMonate('2026-10-22', 3), '2027-01-22');
  assert.equal(plusMonate('2026-11-30', 3), '2027-02-28');
  assert.equal(plusMonate('2027-11-30', 3), '2028-02-29');
  assert.equal(plusMonate('2026-08-31', 3), '2026-11-30');
  assert.equal(plusMonate('2026-12-15', 3), '2027-03-15');
  assert.equal(plusTage('2027-03-01', -7), '2027-02-22');
  assert.equal(tageZwischen('2027-01-15', '2027-01-22'), 7);
  assert.equal(tageZwischen('2027-03-27', '2027-03-29'), 2); // über die Zeitumstellung
  assert.equal(monatName('2026-10-31'), 'Oktober 2026');
  assert.equal(monatName('2026-03-01'), 'März 2026');
  assert.equal(monatName(''), '');
});

test('Monat: Auswahl „Oktober 2026“ hat Vorrang, Datum „Zeitraum“ ist der Rückfall', () => {
  assert.deepEqual(monatDesEintrags({ Monat: 'März 2027' }), { name: 'März 2027', ym: '2027-03' });
  assert.deepEqual(monatDesEintrags({ Monat: { name: 'Oktober 2026' }, Zeitraum: '2026-09-30' }), { name: 'Oktober 2026', ym: '2026-10' });
  assert.deepEqual(monatDesEintrags({ Zeitraum: '2026-09-30' }), { name: 'September 2026', ym: '2026-09' });
  assert.deepEqual(monatDesEintrags({ Monat: 'Unsinn', Zeitraum: '' }), { name: '', ym: '' });
  assert.deepEqual(monatDesEintrags({}), { name: '', ym: '' });
  const e = lohnFuerApp(lohn('recLohnTest000001', { Zeitraum: undefined, Monat: 'September 2026' }), '2026-10-23T10:00:00Z');
  assert.equal(e.titel, 'Lohnabrechnung September 2026');
  assert.equal(e.monat, 'September 2026');
});

test('Löschtermin: 3 Monate ab Hochladen, nie früher als 7 Tage nach der Erinnerung', () => {
  const normal = lohnZustand(lohn('recLohnTest000001'), '2026-10-23T10:00:00Z');
  assert.equal(normal.hochgeladen, '2026-10-22');
  assert.equal(normal.loeschung, '2027-01-22');
  const puenktlich = lohnZustand(lohn('recLohnTest000001', { Erinnerung_Gesendet_Am: '2027-01-15T07:40:00Z' }), '2027-01-16T10:00:00Z');
  assert.equal(puenktlich.loeschung, '2027-01-22');
  const verspaetet = lohnZustand(lohn('recLohnTest000001', { Erinnerung_Gesendet_Am: '2027-01-20T07:40:00Z' }), '2027-01-21T10:00:00Z');
  assert.equal(verspaetet.loeschung, '2027-01-27');
  // ohne Hochgeladen_Am zählt der Anlagezeitpunkt (Berliner Tag)
  const ohne = lohnZustand({ id: 'recLohnTest000009', createdTime: '2026-10-21T22:30:00Z', fields: { Datei: [datei()] } }, '2026-10-22T10:00:00Z');
  assert.equal(ohne.hochgeladen, '2026-10-22');
});

test('Datei ersetzt: ältere Erinnerung und älterer Push gelten nicht für die neue Datei', () => {
  // Push (15.10.) und Erinnerung (08.01.) gehören zur alten Datei; neue Datei am 10.01.
  const z = lohnZustand(lohn('recLohnTest000001', {
    Hochgeladen_Am: '2027-01-10T09:00:00Z', Push_Gesendet_Am: '2026-10-15T08:05:00Z', Erinnerung_Gesendet_Am: '2027-01-08T07:40:00Z',
  }), '2027-01-11T10:00:00Z');
  assert.equal(z.geplant, '2027-04-10');
  assert.equal(z.erinnert, null);
  assert.equal(z.loeschung, '2027-04-10');
  assert.equal(z.pushGesendet, false);
  assert.equal(lohnFuerApp(lohn('recLohnTest000001', { Hochgeladen_Am: '2027-01-10T09:00:00Z', Erinnerung_Gesendet_Am: '2027-01-08T07:40:00Z' }), '2027-01-11T10:00:00Z').loeschungAm, '10.04.2027');
  // Push am Upload-Tag zählt, auch wenn sein Zeitstempel Sekunden früher liegt
  const gleich = lohnZustand(lohn('recLohnTest000001', { Hochgeladen_Am: '2026-10-22T08:00:30Z', Push_Gesendet_Am: '2026-10-22T08:00:00Z' }), '2026-10-23T10:00:00Z');
  assert.equal(gleich.pushGesendet, true);
});

test('App-Eintrag: Titel, Fristen, Hervorhebung 7 Tage vorher, keine Datei-URLs', () => {
  const e = lohnFuerApp(lohn('recLohnTest000001'), '2026-10-23T10:00:00Z');
  assert.equal(e.titel, 'Lohnabrechnung Oktober 2026');
  assert.equal(e.bereitgestellt, '22.10.2026');
  assert.equal(e.loeschungAm, '22.01.2027');
  assert.equal(e.tageBisLoeschung, tageZwischen('2026-10-23', '2027-01-22'));
  assert.equal(e.bald, false);
  assert.deepEqual(e.dateien, [{ nr: 0, name: 'Abrechnung Oktober.pdf' }]);
  assert.ok(!JSON.stringify(e).includes('airtableusercontent'));
  assert.equal(lohnFuerApp(lohn('recLohnTest000001'), '2027-01-14T10:00:00Z').bald, false); // 8 Tage
  assert.equal(lohnFuerApp(lohn('recLohnTest000001'), '2027-01-15T10:00:00Z').bald, true);  // 7 Tage
  assert.equal(lohnFuerApp(lohn('recLohnTest000001', { Status: 'Archiviert' }), '2026-10-23T10:00:00Z'), null);
  assert.equal(lohnFuerApp(lohn('recLohnTest000001', { Datei: [] }), '2026-10-23T10:00:00Z'), null);
  assert.equal(lohnFuerApp(lohn('recLohnTest000001', { Zeitraum: '' }), '2026-10-23T10:00:00Z').titel, 'Lohnabrechnung vom 22.10.2026');
});

// --- App-Liste --------------------------------------------------------------------

test('lohn-liste: nur eigene, sichtbare Einträge, neueste zuerst, Filter aus dem Token', async () => {
  const p = airtableAttrappe(async (a) => {
    if (a.tabelle === PERSONAL) return antwort(200, { records: [personal()] });
    if (a.tabelle === LOHN) {
      return antwort(200, { records: [
        lohn('recLohnTest000002', { Zeitraum: '2026-09-01', Hochgeladen_Am: '2026-10-05T08:00:00Z' }),
        lohn('recLohnTest000001'),
        lohn('recLohnTest000003', { Mitarbeiter: [MA2] }), // fremder Eintrag trotz Vorfilter
        lohn('recLohnTest000004', { Datei: [] }),          // Datei bereits gelöscht
        lohn('recLohnTest000006', { Zeitraum: undefined, Monat: 'November 2026' }), // Monat per Auswahl
      ] });
    }
    return antwort(404, {});
  });
  const res = antwortObjekt();
  await listeHandler(anfrage({ method: 'POST', token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.map((l) => l.id), ['recLohnTest000006', 'recLohnTest000001', 'recLohnTest000002']);
  assert.equal(res.body[0].titel, 'Lohnabrechnung November 2026');
  const formel = p.aufrufe.find((a) => a.tabelle === LOHN).formel;
  assert.ok(formel.includes(`FIND('${MA}', ARRAYJOIN({Mitarbeiter_ID}))`));
  assert.ok(formel.includes(`{Status} != 'Archiviert'`));
  assert.ok(!JSON.stringify(res.body).includes('airtableusercontent'));
  assert.ok(res.body.every((l) => !('sortierung' in l)));
});

test('lohn-liste: ohne gültige Sitzung 401, ohne Airtable-Zugriff auf Lohndaten', async () => {
  const p = airtableAttrappe(async (a) => (a.tabelle === PERSONAL ? antwort(200, { records: [] }) : antwort(404, {})));
  const res = antwortObjekt();
  await listeHandler(anfrage({ method: 'POST', token: TOKEN }), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!p.aufrufe.some((a) => a.tabelle === LOHN));
});

// --- Download ---------------------------------------------------------------------

function downloadSzenario(rec) {
  return airtableAttrappe(async (a) => {
    if (a.host === 'v5.airtableusercontent.com') return dateiAntwort();
    if (a.tabelle === PERSONAL) return antwort(200, { records: [personal()] });
    if (a.tabelle === PATIENTEN) return antwort(200, { records: [{ id: 'recPatientTest001', fields: {} }] });
    if (a.tabelle === LOHN) return rec ? antwort(200, rec) : antwort(404, { error: 'NOT_FOUND' });
    return antwort(404, {});
  });
}
const get = (query) => ({ method: 'GET', headers: {}, query });

test('lohn-download: eigene Lohnabrechnung als Datei, Vorschau inline, Name ohne Umlaute', async () => {
  downloadSzenario(lohn('recLohnTest000001', { Zeitraum: '2026-03-01' }));
  let res = antwortObjekt();
  await downloadHandler(get({ lohnId: 'recLohnTest000001', token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="Lohnabrechnung_Maerz_2026.pdf"');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(Buffer.from(res.body).toString(), '%PDF-Test');
  res = antwortObjekt();
  await downloadHandler(get({ lohnId: 'recLohnTest000001', token: TOKEN, ansicht: '1' }), res);
  assert.match(res.headers['Content-Disposition'], /^inline;/);
});

test('lohn-download: fremde, gelöschte, archivierte oder unbekannte Einträge gibt es nicht', async () => {
  const fall = async (rec, query, erwartet) => {
    const p = downloadSzenario(rec);
    const res = antwortObjekt();
    await downloadHandler(get({ token: TOKEN, ...query }), res);
    assert.equal(res.statusCode, erwartet, JSON.stringify(query));
    assert.ok(!p.aufrufe.some((a) => a.host === 'v5.airtableusercontent.com'), 'Datei darf nicht geladen werden');
  };
  await fall(lohn('recLohnTest000003', { Mitarbeiter: [MA2] }), { lohnId: 'recLohnTest000003' }, 404);
  await fall(lohn('recLohnTest000001', { Status: 'Archiviert' }), { lohnId: 'recLohnTest000001' }, 410);
  await fall(lohn('recLohnTest000001', { Datei: [] }), { lohnId: 'recLohnTest000001' }, 410);
  await fall(null, { lohnId: 'recLohnTest000005' }, 404);
  await fall(lohn('recLohnTest000001'), { lohnId: 'recLohnTest000001', nr: '3' }, 404);
  await fall(lohn('recLohnTest000001'), { lohnId: 'kaputt' }, 400);
  await fall(lohn('recLohnTest000001', { Datei: [{ ...datei(), url: 'https://evil.example.invalid/x' }] }), { lohnId: 'recLohnTest000001' }, 502);
  // ohne Token
  const p = downloadSzenario(lohn('recLohnTest000001'));
  const res = antwortObjekt();
  await downloadHandler(get({ lohnId: 'recLohnTest000001' }), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!p.aufrufe.some((a) => a.tabelle === LOHN));
});

test('lohn-download: bisheriger Weg für Rechnungen der Klienten unverändert', async () => {
  downloadSzenario(null);
  let res = antwortObjekt();
  await downloadHandler(get({ url: DATEI_URL, name: 'Rechnung Mai.pdf', token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="Rechnung Mai.pdf"');
  res = antwortObjekt();
  await downloadHandler(get({ url: 'https://evil.example.invalid/x', token: TOKEN }), res);
  assert.equal(res.statusCode, 400);
});

// --- Push beim Hochladen (api/push-event, type "lohnabrechnung") --------------------

function pushSzenario(rec, pers = personal()) {
  const log = { patches: [] };
  const p = airtableAttrappe(async (a) => {
    if (a.methode === 'PATCH') { log.patches.push({ tabelle: a.tabelle, id: recId(a), fields: a.body.fields }); return antwort(200, {}); }
    if (a.tabelle === LOHN) return rec ? antwort(200, rec) : antwort(404, {});
    if (a.tabelle === PERSONAL) return pers ? antwort(200, pers) : antwort(404, {});
    return antwort(404, {});
  });
  return { p, log };
}
const pushReq = (recordId) => ({ method: 'POST', headers: {}, body: { type: 'lohnabrechnung', recordId } });
const frisch = () => new Date(Date.now() - 3600e3).toISOString();

test('Push beim Hochladen: einmal, an den zugeordneten Mitarbeiter, mit Monat', async () => {
  pushes.length = 0;
  const { log } = pushSzenario(lohn('recLohnTest000001', { Hochgeladen_Am: frisch() }));
  const res = antwortObjekt();
  await pushEvent(pushReq('recLohnTest000001'), res);
  assert.deepEqual(res.body, { status: 'ok', gesendet: 1 });
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].body, /Neue Lohnabrechnung für Oktober 2026 verfügbar/);
  assert.equal(log.patches.length, 1);
  assert.equal(log.patches[0].tabelle, LOHN);
  assert.ok(log.patches[0].fields.Push_Gesendet_Am);
});

test('Push beim Hochladen: kein Push bei Wiederholung, altem Upload, Archiv, inaktivem Mitarbeiter', async () => {
  const fall = async (rec, grund, pers) => {
    pushes.length = 0;
    const { log } = pushSzenario(rec, pers);
    const res = antwortObjekt();
    await pushEvent(pushReq(rec ? rec.id : 'recLohnTest000009'), res);
    assert.equal(res.body.status, 'skipped');
    assert.equal(res.body.grund, grund);
    assert.equal(pushes.length, 0);
    return log;
  };
  let log = await fall(lohn('recLohnTest000001', { Hochgeladen_Am: frisch(), Push_Gesendet_Am: frisch() }), 'Bereits benachrichtigt');
  assert.equal(log.patches.length, 0);
  log = await fall(lohn('recLohnTest000001', { Hochgeladen_Am: new Date(Date.now() - 10 * 86400e3).toISOString() }), 'Upload zu alt');
  assert.equal(log.patches.length, 0);
  await fall(lohn('recLohnTest000001', { Hochgeladen_Am: frisch(), Status: 'Archiviert' }), 'Keine Datei oder archiviert');
  await fall(lohn('recLohnTest000001', { Hochgeladen_Am: frisch(), Mitarbeiter: [] }), 'Kein Mitarbeiter zugeordnet');
  await fall(null, 'Lohnabrechnung nicht gefunden');
  log = await fall(lohn('recLohnTest000001', { Hochgeladen_Am: frisch() }), 'Mitarbeiter nicht aktiv', personal(MA, { Aktiv: false }));
  assert.equal(log.patches.length, 1); // als erledigt vermerkt
  const res = antwortObjekt();
  await pushEvent({ method: 'POST', headers: {}, body: { type: 'lohnabrechnung', recordId: 'kaputt' } }, res);
  assert.equal(res.body.grund, 'Ungültige ID');
});

test('Push beim Hochladen: abgelaufenes Abo wird entfernt, kein technischer Fehler', async () => {
  pushes.length = 0;
  const { log } = pushSzenario(lohn('recLohnTest000001', { Hochgeladen_Am: frisch() }),
    personal(MA, { Push_Subscription: abo('https://push.example.invalid/abgelaufen') }));
  const res = antwortObjekt();
  await pushEvent(pushReq('recLohnTest000001'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.grund, 'Abo abgelaufen');
  assert.ok(log.patches.some((x) => x.tabelle === PERSONAL && x.fields.Push_Subscription === ''));
});

test('push-event: andere Typen unverändert (unbekannter Typ -> skipped)', async () => {
  airtableAttrappe(async () => antwort(404, {}));
  const res = antwortObjekt();
  await pushEvent({ method: 'POST', headers: {}, body: { type: 'unbekannt', recordId: 'recLohnTest000001' } }, res);
  assert.deepEqual(res.body, { status: 'skipped', grund: 'Unbekannter type' });
});

// --- Täglicher Lauf ---------------------------------------------------------------

function laufSzenario(records, { fehlerBei = [] } = {}) {
  const log = { patches: [], personalAbrufe: 0 };
  const p = airtableAttrappe(async (a) => {
    if (a.methode === 'PATCH') {
      if (fehlerBei.includes(recId(a))) return antwort(500, { error: 'SERVER' });
      log.patches.push({ tabelle: a.tabelle, id: recId(a), fields: a.body.fields });
      return antwort(200, {});
    }
    if (a.tabelle === LOHN) return antwort(200, { records });
    if (a.tabelle === PERSONAL) {
      log.personalAbrufe += 1;
      return antwort(200, recId(a) === MA2 ? personal(MA2, { Aktiv: false }) : personal());
    }
    return antwort(404, {});
  });
  return { p, log };
}

test('Tageslauf: Erinnerung 7 Tage vorher, Löschung, Archiv, Nachholen - und Fehler blockieren nichts', async () => {
  pushes.length = 0;
  const jetzt = '2027-01-15T07:30:00Z'; // Berlin 08:30
  const r = (id, felder) => lohn(id, felder);
  const { log } = laufSzenario([
    r('recLohnAuf0000001', { Push_Gesendet_Am: '2026-10-22T08:05:00Z' }),                                  // Erinnerung heute
    r('recLohnAuf0000002', { Hochgeladen_Am: '2026-10-15T08:00:00Z', Erinnerung_Gesendet_Am: '2027-01-08T07:40:00Z' }), // löschen
    r('recLohnAuf0000003', { Hochgeladen_Am: '2026-10-15T08:00:00Z', Push_Gesendet_Am: '2026-10-15T08:05:00Z' }),       // Erinnerung verpasst
    r('recLohnAuf0000004', { Hochgeladen_Am: '2026-10-14T08:00:00Z', Erinnerung_Gesendet_Am: '2027-01-12T07:40:00Z' }), // verspätet erinnert
    r('recLohnAuf0000005', { Status: 'Archiviert' }),                                                       // vom Büro archiviert
    r('recLohnAuf0000006', { Hochgeladen_Am: '2027-01-14T10:00:00Z', Zeitraum: '2026-12-01' }),             // Push nachholen
    r('recLohnAuf0000007', { Hochgeladen_Am: '2027-01-05T10:00:00Z' }),                                     // zu alt zum Nachholen
    r('recLohnAuf0000008', { Datei: [] }),                                                                  // schon gelöscht
    r('recLohnAuf0000009', { Hochgeladen_Am: '2026-12-01T10:00:00Z', Push_Gesendet_Am: '2026-12-01T10:05:00Z' }),
    r('recLohnAuf0000010', { Mitarbeiter: [MA2], Push_Gesendet_Am: '2026-10-22T08:05:00Z' }),             // inaktiv: nur vermerken
    r('recLohnAuf0000011', { Hochgeladen_Am: '2026-10-15T08:00:00Z', Erinnerung_Gesendet_Am: '2027-01-08T07:40:00Z' }), // PATCH scheitert
  ], { fehlerBei: ['recLohnAuf0000011'] });

  const e = await lohnAufbewahrung(jetzt);
  assert.equal(e.geprueft, 10);
  assert.equal(e.erinnert, 3);
  assert.equal(e.geloescht, 2);
  assert.equal(e.nachgeholt, 1);
  assert.deepEqual(e.fehler.map((f) => f.id), ['recLohnAuf0000011']);
  assert.deepEqual(e.zustellung.map((z) => [z.id, z.grund]), [['recLohnAuf0000010', 'Mitarbeiter nicht aktiv']]);

  const patchVon = (id) => log.patches.filter((x) => x.id === id).map((x) => x.fields);
  assert.deepEqual(Object.keys(patchVon('recLohnAuf0000001')[0]), ['Erinnerung_Gesendet_Am']);
  assert.deepEqual(patchVon('recLohnAuf0000002')[0].Datei, []);
  assert.equal(patchVon('recLohnAuf0000002')[0].Status, 'Archiviert');
  assert.ok(patchVon('recLohnAuf0000002')[0]['Datei_Gelöscht_Am']);
  assert.deepEqual(patchVon('recLohnAuf0000005')[0].Datei, []);
  assert.deepEqual(Object.keys(patchVon('recLohnAuf0000006')[0]), ['Push_Gesendet_Am']);
  for (const id of ['recLohnAuf0000004', 'recLohnAuf0000007', 'recLohnAuf0000008', 'recLohnAuf0000009']) {
    assert.equal(patchVon(id).length, 0, id);
  }
  assert.equal(patchVon('recLohnAuf0000010').length, 1);

  // Push-Texte: pünktliche und verspätete Erinnerung nennen das jeweils richtige Datum
  assert.equal(pushes.length, 3);
  assert.match(pushes[0].body, /Oktober 2026 wird am 22\.01\.2027 automatisch gelöscht/);
  assert.match(pushes[1].body, /wird am 22\.01\.2027 automatisch gelöscht/); // 15.01. geplant, Erinnerung erst heute -> +7
  assert.match(pushes[2].body, /Neue Lohnabrechnung für Dezember 2026/);
  assert.equal(log.personalAbrufe, 2); // je Mitarbeiter nur einmal geladen
});

test('Tageslauf: Monatsende - Upload am 30.11. wird am 28.02. gelöscht, Erinnerung am 21.02.', async () => {
  pushes.length = 0;
  const rec = lohn('recLohnAuf0000012', { Hochgeladen_Am: '2026-11-30T09:00:00Z', Push_Gesendet_Am: '2026-11-30T09:05:00Z' });
  laufSzenario([rec]);
  assert.equal((await lohnAufbewahrung('2027-02-20T07:30:00Z')).erinnert, 0);
  laufSzenario([rec]);
  assert.equal((await lohnAufbewahrung('2027-02-21T07:30:00Z')).erinnert, 1);
  assert.match(pushes[0].body, /28\.02\.2027/);
});

test('Tageslauf: Monat aus der Auswahl erscheint im Push (Feld wird mit abgefragt)', async () => {
  pushes.length = 0;
  const rec = lohn('recLohnAuf0000015', { Zeitraum: undefined, Monat: 'Dezember 2026', Hochgeladen_Am: '2027-01-14T10:00:00Z' });
  const { p } = laufSzenario([rec]);
  assert.equal((await lohnAufbewahrung('2027-01-15T07:30:00Z')).nachgeholt, 1);
  assert.match(pushes[0].body, /Neue Lohnabrechnung für Dezember 2026/);
  const abfrage = p.aufrufe.find((a) => a.tabelle === LOHN && a.methode === 'GET');
  assert.ok(abfrage.url.searchParams.getAll('fields[]').includes('Monat'));
});

test('Tageslauf: Datei nach der Erinnerung ersetzt - neuer Push, eigene Erinnerung, keine Löschung ohne Vorwarnung', async () => {
  pushes.length = 0;
  // Alte Datei: hochgeladen 15.10., Push 15.10., Erinnerung 08.01. Am 13.01. ersetzt das Büro sie.
  const basis = lohn('recLohnAuf0000014', {
    Hochgeladen_Am: '2027-01-13T09:00:00Z', Push_Gesendet_Am: '2026-10-15T08:05:00Z', Erinnerung_Gesendet_Am: '2027-01-08T07:40:00Z',
  });
  const mit = (felder) => ({ ...basis, fields: { ...basis.fields, ...felder } });
  const zaehler = (e) => [e.geloescht, e.erinnert, e.nachgeholt];

  // 14.01.: Upload-Push für die neue Datei wird nachgeholt
  laufSzenario([basis]);
  assert.deepEqual(zaehler(await lohnAufbewahrung('2027-01-14T07:30:00Z')), [0, 0, 1]);
  assert.match(pushes[0].body, /Neue Lohnabrechnung für Oktober 2026/);

  // 15.01. (Löschtag der alten Datei): nichts passiert
  let { log } = laufSzenario([mit({ Push_Gesendet_Am: '2027-01-14T07:30:00Z' })]);
  assert.deepEqual(zaehler(await lohnAufbewahrung('2027-01-15T07:30:00Z')), [0, 0, 0]);
  assert.equal(log.patches.length, 0);

  // 06.04. (7 Tage vor dem neuen Termin 13.04.): eigene Erinnerung für die neue Datei
  laufSzenario([mit({ Push_Gesendet_Am: '2027-01-14T07:30:00Z' })]);
  assert.deepEqual(zaehler(await lohnAufbewahrung('2027-04-06T07:30:00Z')), [0, 1, 0]);
  assert.match(pushes[1].body, /wird am 13\.04\.2027 automatisch gelöscht/);

  // 13.04.: erst jetzt wird gelöscht
  ({ log } = laufSzenario([mit({ Push_Gesendet_Am: '2027-01-14T07:30:00Z', Erinnerung_Gesendet_Am: '2027-04-06T07:30:00Z' })]));
  assert.deepEqual(zaehler(await lohnAufbewahrung('2027-04-12T07:30:00Z')), [0, 0, 0]);
  ({ log } = laufSzenario([mit({ Push_Gesendet_Am: '2027-01-14T07:30:00Z', Erinnerung_Gesendet_Am: '2027-04-06T07:30:00Z' })]));
  assert.deepEqual(zaehler(await lohnAufbewahrung('2027-04-13T07:30:00Z')), [1, 0, 0]);
  assert.deepEqual(log.patches[0].fields.Datei, []);
  assert.equal(pushes.length, 2);
});

test('lohn-aufbewahrung: nur mit Cron-Secret; Fehler einzelner Einträge -> 500 + Meldung', async () => {
  let p = laufSzenario([]).p;
  let res = antwortObjekt();
  await aufbewahrungHandler({ method: 'GET', headers: { authorization: 'Bearer falsch' }, query: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(p.aufrufe.length, 0);

  res = antwortObjekt();
  await aufbewahrungHandler({ method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');

  laufSzenario([lohn('recLohnAuf0000013', { Status: 'Archiviert' })], { fehlerBei: ['recLohnAuf0000013'] });
  res = antwortObjekt();
  const err = console.error; console.error = () => {};
  try {
    await aufbewahrungHandler({ method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} }, res);
  } finally { console.error = err; }
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body.fehler.map((f) => f.id), ['recLohnAuf0000013']);
});
