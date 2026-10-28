// Pushs an Mitarbeiter und Klienten: Ziel in der App, verständliche Texte (deutsche Zeit),
// Sperren gegen wiederholtes Auslösen, Mitteilungen in beiden Apps.
// Airtable und Web-Push sind Attrappen; alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { airtableAttrappe, antwort, antwortObjekt, anfrage } from './_hilfen.mjs';
import { einsatzZeitText, pushNutzlast } from '../api/_push.js';
import { mitteilungText, mitteilungRelevant, mitteilungFuerApp, zielgruppeNormal } from '../api/_mitteilungen.js';
import maTermine from '../api/ma-termine.js';
import appData, { INTERNE_FELDER } from '../api/app-data.js';

const pushes = [];
const ablauf = []; // Reihenfolge von Airtable-Schreibzugriffen und Pushs
webpush.setVapidDetails = () => {};
webpush.sendNotification = async (sub, payload) => { ablauf.push('push'); pushes.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); return { statusCode: 201 }; };
const { default: pushEvent, mitarbeiterEinsatzText, ABSAGE_SPERRE_MS } = await import('../api/push-event.js');
const { default: sendPushPfleger } = await import('../api/send-push-pfleger.js');

const T = {
  PATIENTEN: 'tbl5uUUSgC9p10BHQ', PERSONAL: 'tbl3pMfhOLYPsQ5jF', BESUCHE: 'tblXJOSz4LaJCG10M',
  TERMINANFRAGEN: 'tblabkgCUxZmRzz6h', MITTEILUNGEN: 'tblQYvzkhvBnDyXdv', LOHN: 'tblMoak6mpdJtTM8S',
  AUFGABEN: 'tbllNVrLFPfjRltL4', DOKUMENTE: 'tblKoScXr5PeI8HKl', KONTAKTE: 'tbl0rLFTYlqNwDigk',
};
const abo = (n) => JSON.stringify({ endpoint: `https://push.example.invalid/${n}`, keys: { p256dh: 'p', auth: 'a' } });
const MA1 = 'recMaPushTest0001', MA2 = 'recMaPushTest0002', MA3 = 'recMaPushTest0003', PAT = 'recPatPushTest001';
const personal = {
  [MA1]: { id: MA1, fields: { Name: 'Anna B.', Aktiv: true, Rolle: 'Pflegekraft', Push_Subscription: abo('ma1') } },
  [MA2]: { id: MA2, fields: { Name: 'Bert C.', Aktiv: true, Rolle: 'Leitung', Push_Subscription: abo('ma2') } },
  [MA3]: { id: MA3, fields: { Name: 'Cora D.', Aktiv: false, Push_Subscription: abo('ma3') } },
};
const patient = { id: PAT, fields: { Name: 'Erika Musterfrau', Push_Subscription: abo('pat') } };
const recId = (a) => a.url.pathname.split('/')[4];

// Attrappe: Einzel-Records nach Tabelle, Listen für Personal/Patienten, Protokoll aller PATCHs.
function welt({ besuch, mitteilung, anfrage: terminanfrage, patchFehler } = {}) {
  const log = { patches: [] };
  ablauf.length = 0;
  const protokoll = airtableAttrappe(async (a) => {
    const id = recId(a);
    if (a.methode === 'PATCH') {
      if (patchFehler && patchFehler(a)) return antwort(422, { error: { type: 'UNKNOWN_FIELD_NAME' } });
      log.patches.push({ tabelle: a.tabelle, id, fields: a.body.fields });
      ablauf.push(`patch:${a.tabelle}`);
      return antwort(200, { id, fields: a.body.fields });
    }
    if (a.tabelle === T.BESUCHE && besuch) return antwort(200, besuch);
    if (a.tabelle === T.MITTEILUNGEN && mitteilung) return antwort(200, mitteilung);
    if (a.tabelle === T.TERMINANFRAGEN && terminanfrage) return antwort(200, terminanfrage);
    if (a.tabelle === T.PERSONAL) return id ? (personal[id] ? antwort(200, personal[id]) : antwort(404, {})) : antwort(200, { records: Object.values(personal) });
    if (a.tabelle === T.PATIENTEN) return id ? (id === PAT ? antwort(200, patient) : antwort(404, {})) : antwort(200, { records: [patient] });
    return antwort(404, {});
  });
  log.protokoll = protokoll;
  return log;
}
const senden = async (type, recordId) => {
  const res = antwortObjekt();
  await pushEvent({ method: 'POST', headers: {}, body: { type, recordId } }, res);
  return res;
};
const einsatz = (felder = {}) => ({
  id: 'recBesPushTest001',
  fields: {
    'Tätigkeit': 'Grundpflege', Patient: [PAT], Patient_Name: ['Erika Musterfrau'], Pfleger: [MA1],
    Uhrzeit: '2026-11-03T07:00:00.000Z', Datum: '2026-11-03', Von: '08:00', Status: 'Geplant', ...felder,
  },
});

// --- Zeitangaben und Push-Inhalt ---------------------------------------------------------
test('Einsatz-Zeit: immer deutsche Zeit (Winter UTC+1, Sommer UTC+2) mit Wochentag und Datum', () => {
  assert.equal(einsatzZeitText({ Uhrzeit: '2026-11-03T07:00:00.000Z' }), 'am Di, 03.11. um 08:00 Uhr');
  assert.equal(einsatzZeitText({ Uhrzeit: '2026-07-01T06:30:00.000Z' }), 'am Mi, 01.07. um 08:30 Uhr');
  assert.equal(einsatzZeitText({ Uhrzeit: '2026-11-09T23:15:00.000Z' }), 'am Di, 10.11. um 00:15 Uhr'); // Tageswechsel
  assert.equal(einsatzZeitText({ Uhrzeit: '2026-10-25T00:30:00.000Z' }), 'am So, 25.10. um 02:30 Uhr'); // noch Sommerzeit
  assert.equal(einsatzZeitText({ Uhrzeit: '2026-10-25T01:30:00.000Z' }), 'am So, 25.10. um 02:30 Uhr'); // schon Winterzeit
  assert.equal(einsatzZeitText({ Datum: '2026-11-04', Von: '09:15' }), 'am Mi, 04.11. um 09:15 Uhr');
  assert.equal(einsatzZeitText({ Datum: ['2026-11-04'] }), 'am Mi, 04.11.');
  assert.equal(einsatzZeitText({}), '');
  assert.equal(einsatzZeitText({ Uhrzeit: 'kaputt', Datum: 'auch kaputt' }), '');
});

test('Push-Inhalt: Ziel nur aus der festen Liste', () => {
  assert.deepEqual(JSON.parse(pushNutzlast('T', 'X', 'plan')), { title: 'T', body: 'X', ziel: 'plan' });
  assert.deepEqual(JSON.parse(pushNutzlast('T', 'X', 'javascript:alert(1)')), { title: 'T', body: 'X' });
  assert.deepEqual(JSON.parse(pushNutzlast('', '')), { title: 'Wunschlos Pflege', body: '' });
});

test('Mitarbeiter-Texte: Einsatz, Klient, Datum und Uhrzeit', () => {
  const f = einsatz().fields;
  assert.deepEqual(mitarbeiterEinsatzText('Abgesagt', f), { titel: 'Einsatz abgesagt', text: 'Grundpflege bei Erika Musterfrau am Di, 03.11. um 08:00 Uhr wurde abgesagt.' });
  assert.deepEqual(mitarbeiterEinsatzText('Geändert', f), { titel: 'Einsatz geändert', text: 'Grundpflege bei Erika Musterfrau ist jetzt am Di, 03.11. um 08:00 Uhr.' });
  assert.deepEqual(mitarbeiterEinsatzText('Neu', f), { titel: 'Neuer Einsatz', text: 'Grundpflege bei Erika Musterfrau am Di, 03.11. um 08:00 Uhr.' });
  assert.deepEqual(mitarbeiterEinsatzText('Neu', {}), { titel: 'Neuer Einsatz', text: 'Einsatz.' });
});

// --- Absage an den Mitarbeiter -------------------------------------------------------------
test('Absage: Push an den eingeplanten Mitarbeiter (deutsche Zeit, Ziel Tagesplan), Sperre zuerst', async () => {
  pushes.length = 0;
  const log = welt({ besuch: einsatz({ Status: 'Abgesagt' }) });
  const res = await senden('absage', 'recBesPushTest001');
  assert.equal(res.body.status, 'ok');
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].endpoint, 'https://push.example.invalid/ma1');
  assert.equal(pushes[0].title, 'Einsatz abgesagt');
  assert.equal(pushes[0].body, 'Grundpflege bei Erika Musterfrau am Di, 03.11. um 08:00 Uhr wurde abgesagt.');
  assert.equal(pushes[0].ziel, 'plan');
  assert.deepEqual(log.patches.map((p) => Object.keys(p.fields)), [['Push_Absage_MA_Am']]);
  assert.deepEqual(ablauf, [`patch:${T.BESUCHE}`, 'push']); // Sperre vor dem Push
});

test('Absage: zweiter Aufruf innerhalb von 10 Minuten verschickt nichts; nicht abgesagt -> nichts', async () => {
  pushes.length = 0;
  welt({ besuch: einsatz({ Status: 'Abgesagt', Push_Absage_MA_Am: new Date(Date.now() - 60_000).toISOString() }) });
  assert.equal((await senden('absage', 'recBesPushTest001')).body.grund, 'Bereits benachrichtigt');
  welt({ besuch: einsatz({ Status: 'Abgesagt', Push_Absage_MA_Am: new Date(Date.now() - ABSAGE_SPERRE_MS - 1000).toISOString() }) });
  assert.equal((await senden('absage', 'recBesPushTest001')).body.status, 'ok');
  welt({ besuch: einsatz({ Status: 'Geplant' }) });
  assert.equal((await senden('absage', 'recBesPushTest001')).body.grund, 'Termin nicht abgesagt');
  assert.equal(pushes.length, 1);
});

test('Absage: deaktivierte Mitarbeiter bekommen nichts; fehlendes Sperrfeld verhindert den Push nicht', async () => {
  pushes.length = 0;
  welt({ besuch: einsatz({ Status: 'Abgesagt', Pfleger: [MA3] }) });
  assert.equal((await senden('absage', 'recBesPushTest001')).body.status, 'skipped');
  welt({ besuch: einsatz({ Status: 'Abgesagt' }), patchFehler: (a) => a.tabelle === T.BESUCHE });
  assert.equal((await senden('absage', 'recBesPushTest001')).body.status, 'ok');
  assert.equal(pushes.length, 1);
});

// --- Termin-Freigabe (Push_senden) ----------------------------------------------------------
test('Termin-Freigabe: Klient bekommt seinen Text, der Mitarbeiter einen eigenen (mit Datum)', async () => {
  pushes.length = 0;
  const log = welt({ besuch: einsatz({ Push_senden: 'Senden', Hervorhebung: 'Änderung' }) });
  const res = await senden('besuch', 'recBesPushTest001');
  assert.equal(res.body.status, 'ok');
  const kl = pushes.find((p) => p.endpoint.endsWith('/pat'));
  const ma = pushes.find((p) => p.endpoint.endsWith('/ma1'));
  assert.equal(kl.body, 'Ihr Termin "Grundpflege" wurde geändert - neuer Termin: 03.11.2026, 08:00.');
  assert.equal(kl.ziel, 'termine');
  assert.equal(ma.title, 'Einsatz geändert');
  assert.equal(ma.body, 'Grundpflege bei Erika Musterfrau ist jetzt am Di, 03.11. um 08:00 Uhr.');
  assert.equal(ma.ziel, 'plan');
  assert.deepEqual(log.patches.map((p) => p.fields), [{ Push_senden: 'Gesendet' }]);
});

test('Sommerzeit: Klient und Mitarbeiter bekommen die deutsche Uhrzeit (UTC+2), auch bei der Absage', async () => {
  pushes.length = 0;
  const sommer = { Uhrzeit: '2026-07-01T06:30:00.000Z', Datum: '2026-07-01', Von: '08:30' };
  welt({ besuch: einsatz({ ...sommer, Push_senden: 'Senden' }) });
  await senden('besuch', 'recBesPushTest001');
  assert.equal(pushes.find((p) => p.endpoint.endsWith('/pat')).body, 'Neuer Termin: "Grundpflege" am 01.07.2026, 08:30');
  assert.equal(pushes.find((p) => p.endpoint.endsWith('/ma1')).body, 'Grundpflege bei Erika Musterfrau am Mi, 01.07. um 08:30 Uhr.');
  pushes.length = 0;
  welt({ besuch: einsatz({ ...sommer, Status: 'Abgesagt' }) });
  await senden('absage', 'recBesPushTest001');
  assert.equal(pushes[0].body, 'Grundpflege bei Erika Musterfrau am Mi, 01.07. um 08:30 Uhr wurde abgesagt.');
});

test('Termin-Freigabe bei bereits abgesagtem Termin: nur der Klient (Mitarbeiter hat die Absage schon)', async () => {
  pushes.length = 0;
  welt({ besuch: einsatz({ Push_senden: 'Senden', Status: 'Abgesagt' }) });
  await senden('besuch', 'recBesPushTest001');
  assert.deepEqual(pushes.map((p) => p.endpoint.split('/').pop()), ['pat']);
});

// --- Klienten-Anfragen: E-Mail ans Büro (eigene Automation), Push nur bei Änderungswunsch ----
test('Änderungswunsch: Push an den Mitarbeiter des Termins (deutsche Zeit, Ziel Tagesplan), Sperre zuerst', async () => {
  pushes.length = 0;
  const log = welt({
    anfrage: { id: 'recAnfPushTest001', fields: { Art: 'Terminänderung', Betroffener_Termin: ['recBesPushTest001'] } },
    besuch: einsatz({ Status: 'Änderungswunsch' }),
  });
  const res = await senden('terminanfrage', 'recAnfPushTest001');
  assert.equal(res.body.status, 'ok');
  assert.deepEqual(pushes.map((p) => p.endpoint.split('/').pop()), ['ma1']); // nur der Mitarbeiter des Termins
  assert.equal(pushes[0].title, 'Änderungswunsch');
  assert.equal(pushes[0].body, 'Grundpflege bei Erika Musterfrau am Di, 03.11. um 08:00 Uhr: Der Klient wünscht eine Änderung. Das Büro klärt den neuen Termin.');
  assert.equal(pushes[0].ziel, 'plan');
  assert.deepEqual(log.patches.map((p) => p.fields), [{ Buero_benachrichtigt: true }]);
  assert.deepEqual(ablauf, [`patch:${T.TERMINANFRAGEN}`, 'push']);
});

test('Neue Terminanfrage: kein Push (nur E-Mail ans Büro); bereits gemeldet -> nichts; ohne Termin -> nichts', async () => {
  pushes.length = 0;
  let log = welt({ anfrage: { id: 'recAnfPushTest001', fields: { Art: 'Neue Anfrage' } } });
  assert.equal((await senden('terminanfrage', 'recAnfPushTest001')).body.grund, 'Neue Terminanfrage: nur E-Mail ans Büro');
  assert.deepEqual(log.patches.map((p) => p.fields), [{ Buero_benachrichtigt: true }]);
  log = welt({ anfrage: { id: 'recAnfPushTest001', fields: { Art: 'Terminänderung', Betroffener_Termin: ['recBesPushTest001'], Buero_benachrichtigt: true } }, besuch: einsatz() });
  assert.equal((await senden('terminanfrage', 'recAnfPushTest001')).body.grund, 'Bereits benachrichtigt');
  assert.equal(log.patches.length, 0);
  welt({ anfrage: { id: 'recAnfPushTest001', fields: { Art: 'Terminänderung' } } });
  assert.equal((await senden('terminanfrage', 'recAnfPushTest001')).body.grund, 'Kein betroffener Termin');
  assert.equal(pushes.length, 0);
});

// --- Mitteilungen --------------------------------------------------------------------------
const mitteilung = (felder) => ({ id: 'recMitPushTest001', createdTime: '2026-10-20T08:00:00.000Z', fields: { Status: 'Senden', ...felder } });

test('Mitteilung: nur auf "Senden"; Entwurf/Gesendet lösen nichts aus', async () => {
  pushes.length = 0;
  for (const Status of ['Entwurf', 'Gesendet', '']) {
    const log = welt({ mitteilung: mitteilung({ Status, Zielgruppe: 'Alle Mitarbeiter', Nachricht: 'Hallo' }) });
    const res = await senden('mitteilung', 'recMitPushTest001');
    assert.equal(res.body.grund, 'Nicht zum Senden freigegeben');
    assert.equal(log.patches.length, 0);
  }
  assert.equal(pushes.length, 0);
});

test('Mitteilung: erst als gesendet ablegen (Text + Zeitpunkt), dann pushen; Ziel Nachrichten, Titel als Überschrift', async () => {
  pushes.length = 0;
  const log = welt({ mitteilung: mitteilung({ Titel: 'Teamtreffen', Zielgruppe: 'Alle Mitarbeiter', Nachricht: 'Freitag 14 Uhr im Büro.' }) });
  const res = await senden('mitteilung', 'recMitPushTest001');
  assert.equal(res.body.status, 'ok');
  assert.equal(log.patches.length, 1);
  const f = log.patches[0].fields;
  assert.equal(f.Status, 'Gesendet');
  assert.equal(f.Gesendeter_Text, 'Freitag 14 Uhr im Büro.');
  assert.ok(Date.now() - Date.parse(f.Gesendet_Am) < 5000);
  // nur aktive Mitarbeiter (MA3 ist deaktiviert), Klienten nicht
  assert.deepEqual(pushes.map((p) => p.endpoint.split('/').pop()).sort(), ['ma1', 'ma2']);
  for (const p of pushes) assert.deepEqual([p.title, p.body, p.ziel], ['Teamtreffen', 'Freitag 14 Uhr im Büro.', 'nachrichten']);
  assert.deepEqual(ablauf, [`patch:${T.MITTEILUNGEN}`, 'push', 'push']); // erst ablegen, dann pushen
});

test('Mitteilung: niemand mit Push-Abo -> trotzdem "Gesendet" (steht in der App); ohne Publikum bleibt sie stehen', async () => {
  pushes.length = 0;
  const ohneAbo = Object.fromEntries(Object.entries(personal).map(([k, v]) => [k, { ...v, fields: { ...v.fields, Push_Subscription: '' } }]));
  const gesichert = { ...personal };
  Object.assign(personal, ohneAbo);
  try {
    const log = welt({ mitteilung: mitteilung({ Zielgruppe: 'Alle Mitarbeiter', Nachricht: 'Info' }) });
    const res = await senden('mitteilung', 'recMitPushTest001');
    assert.equal(res.body.status, 'skipped');
    assert.equal(log.patches[0].fields.Status, 'Gesendet');
  } finally {
    Object.assign(personal, gesichert);
  }
  const log2 = welt({ mitteilung: mitteilung({ Nachricht: 'An niemanden' }) });
  assert.equal((await senden('mitteilung', 'recMitPushTest001')).body.grund, 'Keine Empfänger');
  assert.equal(log2.patches.length, 0);
  assert.equal(pushes.length, 0);
});

test('Mitteilung: fehlen die neuen Felder, wird nur der Status gesetzt (Alarm) und trotzdem gepusht', async () => {
  pushes.length = 0;
  const log = welt({
    mitteilung: mitteilung({ Typ: 'Ausfall', Ausfall_Mitarbeiter: [MA1], Ersatz_Mitarbeiter: [MA2], Betroffener_Patient: [PAT] }),
    patchFehler: (a) => a.tabelle === T.MITTEILUNGEN && 'Gesendeter_Text' in a.body.fields,
  });
  const res = await senden('mitteilung', 'recMitPushTest001');
  assert.equal(res.body.status, 'ok');
  assert.deepEqual(log.patches.map((p) => p.fields), [{ Status: 'Gesendet' }]);
  assert.deepEqual(pushes.map((p) => p.endpoint.split('/').pop()).sort(), ['ma1', 'ma2', 'pat']);
  for (const p of pushes) assert.equal(p.body, 'Mitarbeiter/in Anna B. fällt aus, deshalb kommt Mitarbeiter/in Bert C.');
});

test('Mitteilungstext: Ausfall-Satz + zusätzliche Nachricht; Alt-Zielgruppen werden umgedeutet', () => {
  assert.equal(mitteilungText({ Typ: 'Ausfall', Nachricht: 'Bitte Schlüssel im Büro holen.' }, { ausfall: ['Anna B.'], ersatz: ['Bert C.'] }),
    'Mitarbeiter/in Anna B. fällt aus, deshalb kommt Mitarbeiter/in Bert C. Bitte Schlüssel im Büro holen.');
  assert.equal(mitteilungText({ Typ: 'Ausfall', Nachricht: 'Danke!' }, { ausfall: ['Anna'], ersatz: ['Bert'] }),
    'Mitarbeiter/in Anna fällt aus, deshalb kommt Mitarbeiter/in Bert. Danke!');
  assert.equal(mitteilungText({ Typ: 'Broadcast', Nachricht: ' Hallo ' }), 'Hallo');
  assert.equal(zielgruppeNormal('Mitarbeiter'), 'Alle Mitarbeiter');
  assert.equal(zielgruppeNormal({ name: 'Alle (Broadcast)' }), 'Alle gesamt');
});

test('Mitteilungen in der App: Wer sieht was (Zielgruppe, Ausfall/Ersatz, betroffener Klient)', () => {
  const r = (fields) => ({ id: 'recX', createdTime: '2026-10-20T08:00:00.000Z', fields });
  assert.equal(mitteilungRelevant(r({ Zielgruppe: 'Alle Mitarbeiter' }), 'mitarbeiter', MA1), true);
  assert.equal(mitteilungRelevant(r({ Zielgruppe: 'Alle Mitarbeiter' }), 'patient', PAT), false);
  assert.equal(mitteilungRelevant(r({ Zielgruppe: 'Alle Patienten' }), 'mitarbeiter', MA1), false);
  assert.equal(mitteilungRelevant(r({ Zielgruppe: 'Alle gesamt' }), 'patient', PAT), true);
  assert.equal(mitteilungRelevant(r({ Ersatz_Mitarbeiter: [MA2] }), 'mitarbeiter', MA2), true);
  assert.equal(mitteilungRelevant(r({ Ersatz_Mitarbeiter: [MA2] }), 'mitarbeiter', MA1), false);
  assert.equal(mitteilungRelevant(r({ Betroffener_Patient: [PAT] }), 'patient', PAT), true);
  assert.equal(mitteilungRelevant(r({ Betroffener_Patient: ['recAndererPat0001'] }), 'patient', PAT), false);
  assert.equal(mitteilungRelevant(r({ Zielgruppe: 'Alle gesamt' }), 'patient', ''), false);
  const m = mitteilungFuerApp(r({ Titel: 'Hinweis', Nachricht: 'alt', Gesendeter_Text: 'gesendet', Gesendet_Am: '2026-10-28T10:00:00.000Z', Ausfall_Mitarbeiter: [MA1] }));
  assert.deepEqual(m, { id: 'recX', key: 'recX|2026-10-28T10:00:00.000Z', titel: 'Hinweis', text: 'gesendet', datum: '2026-10-28T10:00:00.000Z' });
});

// --- Mitarbeiter-App: Einsätze + Neuigkeiten in einer Abfrage -------------------------------
const MA_TOKEN = 'tokenMitarbeiterPushSichtbar123';
function maWelt({ mitteilungenFehler = false } = {}) {
  return airtableAttrappe(async (a) => {
    if (a.tabelle === T.PERSONAL) return antwort(200, { records: [{ id: MA1, fields: { Aktiv: true, Name: 'Anna B.' } }] });
    if (a.tabelle === T.BESUCHE) return antwort(200, { records: [einsatz({ Dienstplan_Druck_Link: 'https://x.invalid/api/dienstplan-pdf?ma=1&t=geheim' })] });
    if (a.tabelle === T.MITTEILUNGEN) {
      if (mitteilungenFehler) return antwort(422, {});
      return antwort(200, { records: [
        { id: 'recMitA0000000001', createdTime: '2026-10-27T08:00:00.000Z', fields: { Zielgruppe: 'Alle Mitarbeiter', Gesendeter_Text: 'Für alle', Gesendet_Am: '2026-10-27T08:00:00.000Z' } },
        { id: 'recMitB0000000001', createdTime: '2026-10-27T09:00:00.000Z', fields: { Zielgruppe: 'Alle Patienten', Gesendeter_Text: 'Nur Klienten', Gesendet_Am: '2026-10-27T09:00:00.000Z' } },
        { id: 'recMitC0000000001', createdTime: '2026-10-28T09:00:00.000Z', fields: { Typ: 'Ausfall', Ersatz_Mitarbeiter: [MA1], Gesendeter_Text: 'Du übernimmst', Gesendet_Am: '2026-10-28T09:00:00.000Z' } },
      ] });
    }
    if (a.tabelle === T.LOHN) return antwort(200, { records: [] });
    return antwort(404, {});
  });
}
const maAbruf = async (body) => {
  const res = antwortObjekt();
  await maTermine(anfrage({ method: 'POST', token: MA_TOKEN, body }), res);
  return res;
};

test('ma-termine: ohne Format wie bisher ein Array (ältere App-Versionen), ohne Druck-Links', async () => {
  maWelt();
  const res = await maAbruf({});
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(JSON.stringify(res.body).includes('dienstplan-pdf'), false);
});

test('ma-termine Format 2 mit Neuigkeiten: Einsätze + eigene Mitteilungen + Lohn, parallel', async () => {
  const p = maWelt();
  const res = await maAbruf({ format: 2, neuigkeiten: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.termine.length, 1);
  assert.deepEqual(res.body.mitteilungen.map((m) => m.text), ['Du übernimmst', 'Für alle']);
  assert.deepEqual(res.body.lohn, []);
  assert.equal(JSON.stringify(res.body).includes('dienstplan-pdf'), false);
  assert.equal(JSON.stringify(res.body.mitteilungen).includes(MA1), false); // keine Verknüpfungen in der App
  assert.deepEqual(p.aufrufe.map((a) => a.tabelle).sort(), [T.BESUCHE, T.LOHN, T.MITTEILUNGEN, T.PERSONAL].sort());
  // Mitteilungen nur gesendete der letzten 30 Tage
  const f = p.aufrufe.find((a) => a.tabelle === T.MITTEILUNGEN).formel;
  assert.match(f, /\{Status\} = 'Gesendet'/);
  assert.match(f, /DATEADD\(NOW\(\), -30, 'days'\)/);
});

test('ma-termine Format 2: ohne Neuigkeiten keine Zusatzabfragen; Fehler bei Mitteilungen -> null, Einsätze kommen', async () => {
  let p = maWelt();
  let res = await maAbruf({ format: 2 });
  assert.deepEqual(Object.keys(res.body), ['termine']);
  assert.equal(p.aufrufe.length, 2);
  p = maWelt({ mitteilungenFehler: true });
  res = await maAbruf({ format: 2, neuigkeiten: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.termine.length, 1);
  assert.equal(res.body.mitteilungen, null);
  assert.deepEqual(res.body.lohn, []);
});

// --- Klienten-App: Mitteilungen auf Wunsch ---------------------------------------------------
const PAT_TOKEN = 'TestToken_pushsichtbar_abcdefghijkl';
function patWelt() {
  return airtableAttrappe(async (a) => {
    if (a.tabelle === T.PATIENTEN && a.methode === 'GET') return antwort(200, { records: [{ id: PAT, fields: { Name: 'Erika Musterfrau', Session_Token: PAT_TOKEN, Zuletzt_aktiv: new Date().toISOString() } }] });
    if (a.tabelle === T.BESUCHE) return antwort(200, { records: [einsatz({ Push_Absage_MA_Am: '2026-10-28T10:00:00.000Z' })] });
    if (a.tabelle === T.MITTEILUNGEN) {
      return antwort(200, { records: [
        { id: 'recMitP0000000001', createdTime: '2026-10-28T08:00:00.000Z', fields: { Typ: 'Ausfall', Betroffener_Patient: [PAT], Gesendeter_Text: 'Mitarbeiter/in Anna B. fällt aus, deshalb kommt Mitarbeiter/in Bert C.', Gesendet_Am: '2026-10-28T08:00:00.000Z' } },
        { id: 'recMitM0000000001', createdTime: '2026-10-28T08:00:00.000Z', fields: { Zielgruppe: 'Alle Mitarbeiter', Gesendeter_Text: 'Interna', Gesendet_Am: '2026-10-28T08:00:00.000Z' } },
      ] });
    }
    return antwort(200, { records: [] });
  });
}
const patAbruf = async (query) => {
  const res = antwortObjekt();
  const req = anfrage({ method: 'GET', token: PAT_TOKEN });
  req.query = query;
  await appData(req, res);
  return res;
};

test('app-data: Mitteilungen nur mit ?mitteilungen=1 und nur die eigenen; Push-Sperre nie an die App', async () => {
  let p = patWelt();
  let res = await patAbruf({});
  assert.equal('mitteilungen' in res.body.data, false);
  assert.equal(p.aufrufe.some((a) => a.tabelle === T.MITTEILUNGEN), false);
  assert.equal('Push_Absage_MA_Am' in res.body.data.besuche[0].fields, false);
  assert.ok(INTERNE_FELDER.besuch.includes('Push_Absage_MA_Am'));
  p = patWelt();
  res = await patAbruf({ mitteilungen: '1' });
  assert.deepEqual(res.body.data.mitteilungen.map((m) => m.titel), ['Personaländerung']);
  assert.equal(JSON.stringify(res.body.data.mitteilungen).includes('Interna'), false);
});

// --- Alt-Weg der Automationen ---------------------------------------------------------------
test('send-push-pfleger (Alt-Weg): Tipp auf den Push öffnet den Tagesplan', async () => {
  pushes.length = 0;
  globalThis.fetch = async () => antwort(200, { id: MA1, fields: { Push_Subscription: abo('alt') } });
  const res = antwortObjekt();
  await sendPushPfleger({ method: 'POST', headers: {}, body: { mitarbeiterId: MA1, titel: 'Termin abgesagt', nachricht: 'X wurde abgesagt.' } }, res);
  assert.equal(res.body.status, 'success');
  assert.deepEqual([pushes[0].title, pushes[0].body, pushes[0].ziel], ['Termin abgesagt', 'X wurde abgesagt.', 'plan']);
});
