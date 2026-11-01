// Push-Abo gehört immer nur dem zuletzt angemeldeten Konto (Vorfall 01.11.2026: Einsatz-Pushs
// eines Mitarbeiters kamen auf einem Gerät an, auf dem inzwischen ein Klient angemeldet war).
// Server: api/save-subscription.js, api/abo-pfleger.js, api/_abo.js. App: src/push.ts, App.tsx.
// Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { airtableAttrappe, antwort, antwortObjekt } from './_hilfen.mjs';
import saveSubscription from '../api/save-subscription.js';
import aboPfleger from '../api/abo-pfleger.js';
import { aboEndpoint, endpointGueltig } from '../api/_abo.js';

const PAT = 'tbl5uUUSgC9p10BHQ', PER = 'tbl3pMfhOLYPsQ5jF';
const geraet = (n) => `https://web.push.apple.com/QGeraet${n}xxxxxxxxxx`;
const abo = (n, auth = 'a') => ({ endpoint: geraet(n), expirationTime: null, keys: { p256dh: 'p', auth } });
const token = (n) => `tok${n}`.padEnd(24, 'x');
const ruhig = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

// Kleine Airtable-Attrappe mit zwei Tabellen; protokolliert Suchen und Schreibzugriffe.
function datenbank({ patienten = [], personal = [], patchFehler = false } = {}) {
  const tabellen = {
    [PAT]: patienten.map((r) => ({ id: r.id, fields: { ...r.fields } })),
    [PER]: personal.map((r) => ({ id: r.id, fields: { Aktiv: true, ...r.fields } })),
  };
  const log = { patches: [], suchen: [], abrufe: 0 };
  airtableAttrappe(async (a) => {
    log.abrufe += 1;
    const liste = tabellen[a.tabelle] || [];
    if (a.methode === 'PATCH') {
      if (patchFehler) return antwort(422, { error: { type: 'INVALID' } });
      const id = a.url.pathname.split('/')[4];
      log.patches.push({ tabelle: a.tabelle, id, fields: a.body.fields });
      const rec = liste.find((r) => r.id === id);
      Object.assign(rec.fields, a.body.fields);
      return antwort(200, rec);
    }
    const tok = /^\{Session_Token\} = '(.*)'$/.exec(a.formel);
    if (tok) return antwort(200, { records: liste.filter((r) => r.fields.Session_Token === tok[1]).slice(0, 1) });
    const find = /^FIND\('(.*)', \{Push_Subscription\}\)$/.exec(a.formel);
    if (find) {
      log.suchen.push({ tabelle: a.tabelle, felder: a.url.searchParams.getAll('fields[]'), max: a.url.searchParams.get('maxRecords') });
      return antwort(200, { records: liste.filter((r) => String(r.fields.Push_Subscription || '').includes(find[1])) });
    }
    return antwort(404, {});
  });
  const feld = (tabelle, id) => tabellen[tabelle].find((r) => r.id === id).fields.Push_Subscription || '';
  return { log, feld };
}
const post = (body, headers = {}) => ({ method: 'POST', headers, body });

test('Vorfall 01.11.: Klient speichert Abo -> dasselbe Gerät verschwindet bei allen anderen Konten', async () => {
  const { log, feld } = datenbank({
    patienten: [
      { id: 'recKlient0000001', fields: { Session_Token: token(1) } },
      { id: 'recKlient0000002', fields: { Push_Subscription: JSON.stringify(abo(1)) } },
    ],
    personal: [
      { id: 'recPfleger000001', fields: { Push_Subscription: JSON.stringify(abo(1)) } }, // z. B. Huong
      { id: 'recPfleger000002', fields: { Push_Subscription: JSON.stringify(abo(2)) } }, // anderes Gerät
    ],
  });
  const res = antwortObjekt();
  await saveSubscription(post({ token: token(1), subscription: abo(1) }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: 'ok' });
  assert.equal(aboEndpoint(feld(PAT, 'recKlient0000001')), geraet(1));
  assert.equal(feld(PAT, 'recKlient0000002'), '');
  assert.equal(feld(PER, 'recPfleger000001'), '');                  // kein Einsatz-Push mehr aufs Gerät
  assert.equal(aboEndpoint(feld(PER, 'recPfleger000002')), geraet(2)); // fremdes Gerät bleibt
  assert.equal(log.patches.length, 3);
  // Gesucht wird in beiden Tabellen, nur das Abo-Feld, begrenzt
  assert.deepEqual(log.suchen.map((s) => s.tabelle).sort(), [PAT, PER].sort());
  assert.ok(log.suchen.every((s) => s.felder.join() === 'Push_Subscription' && s.max === '20'));
});

test('Unverändertes Abo (stiller Abgleich bei jedem App-Start): kein Schreibzugriff, keine Suche', async () => {
  const { log } = datenbank({
    patienten: [{ id: 'recKlient0000001', fields: { Session_Token: token(1), Push_Subscription: JSON.stringify(abo(1)) } }],
  });
  const res = antwortObjekt();
  await saveSubscription(post({ token: token(1), subscription: abo(1) }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(log.patches.length, 0);
  assert.equal(log.suchen.length, 0);
  assert.equal(log.abrufe, 1); // nur die Anmeldeprüfung
});

test('Gleiches Gerät mit neuen Schlüsseln: nur das eigene Konto wird aktualisiert, keine Suche', async () => {
  const { log, feld } = datenbank({
    personal: [{ id: 'recPfleger000001', fields: { Session_Token: token(3), Push_Subscription: JSON.stringify(abo(1, 'alt')) } }],
  });
  const res = antwortObjekt();
  await saveSubscription(post({ token: token(3), subscription: abo(1, 'neu') }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(feld(PER, 'recPfleger000001')).keys.auth, 'neu');
  assert.equal(log.patches.length, 1);
  assert.equal(log.suchen.length, 0);
});

test('Nur exakt dasselbe Gerät wird entfernt (FIND trifft auch längere Endpoints)', async () => {
  const laenger = { ...abo(1), endpoint: `${geraet(1)}NOCHMEHR` };
  const { feld } = datenbank({
    patienten: [{ id: 'recKlient0000001', fields: { Session_Token: token(1) } }],
    personal: [{ id: 'recPfleger000003', fields: { Push_Subscription: JSON.stringify(laenger) } }],
  });
  await saveSubscription(post({ token: token(1), subscription: abo(1) }), antwortObjekt());
  assert.equal(aboEndpoint(feld(PER, 'recPfleger000003')), laenger.endpoint);
});

test('Mitarbeiter-App (abo-pfleger): Gerät gehört danach nur noch diesem Mitarbeiter', async () => {
  const { log, feld } = datenbank({
    patienten: [{ id: 'recKlient0000033', fields: { Push_Subscription: JSON.stringify(abo(5)) } }],
    personal: [
      { id: 'recPfleger000001', fields: { Session_Token: token(4) } },
      { id: 'recPfleger000002', fields: { Push_Subscription: JSON.stringify(abo(5)) } },
    ],
  });
  const res = antwortObjekt();
  await aboPfleger(post({ subscription: abo(5) }, { authorization: `Bearer ${token(4)}` }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(aboEndpoint(feld(PER, 'recPfleger000001')), geraet(5));
  assert.equal(feld(PAT, 'recKlient0000033'), '');
  assert.equal(feld(PER, 'recPfleger000002'), '');
  assert.equal(log.patches.length, 3);
});

test('Mitarbeiter-App: unverändertes Abo kostet keinen Schreibzugriff', async () => {
  const { log } = datenbank({
    personal: [{ id: 'recPfleger000001', fields: { Session_Token: token(4), Push_Subscription: JSON.stringify(abo(5)) } }],
  });
  const res = antwortObjekt();
  await aboPfleger(post({ subscription: abo(5) }, { authorization: `Bearer ${token(4)}` }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(log.patches.length, 0);
  assert.equal(log.suchen.length, 0);
});

test('Abmelden: Gerät wird vom eigenen Konto gelöst; ein anderes Gerät desselben Kontos bleibt', async () => {
  const { feld } = datenbank({
    personal: [{ id: 'recPfleger000001', fields: { Session_Token: token(6), Push_Subscription: JSON.stringify(abo(7)) } }],
  });
  const fremd = antwortObjekt();
  await saveSubscription(post({ token: token(6), abmelden: true, endpoint: geraet(8) }), fremd);
  assert.deepEqual(fremd.body, { status: 'ok', entfernt: false });
  assert.equal(aboEndpoint(feld(PER, 'recPfleger000001')), geraet(7));
  const eigen = antwortObjekt();
  await saveSubscription(post({ token: token(6), abmelden: true, endpoint: geraet(7) }), eigen);
  assert.deepEqual(eigen.body, { status: 'ok', entfernt: true });
  assert.equal(feld(PER, 'recPfleger000001'), '');
});

test('Abmelden als Klient funktioniert ebenso', async () => {
  const { feld } = datenbank({
    patienten: [{ id: 'recKlient0000001', fields: { Session_Token: token(9), Push_Subscription: JSON.stringify(abo(9)) } }],
  });
  const res = antwortObjekt();
  await saveSubscription(post({ token: token(9), abmelden: true, endpoint: geraet(9) }), res);
  assert.deepEqual(res.body, { status: 'ok', entfernt: true });
  assert.equal(feld(PAT, 'recKlient0000001'), '');
});

test('Ungültige Abos/Endpoints -> 400, ohne jeden Airtable-Zugriff (Formel-Schutz)', async () => {
  const schlecht = [
    { token: token(1), subscription: { ...abo(1), endpoint: "https://x.example/a',TRUE(),'" } },
    { token: token(1), subscription: { ...abo(1), endpoint: 'https://x.example/a\\b' } },
    { token: token(1), subscription: { ...abo(1), endpoint: 'http://unsicher.example/abcdefghij' } },
    { token: token(1), subscription: { ...abo(1), endpoint: 'https://x' } },
    { token: token(1), subscription: { keys: {} } },
    { token: token(1), subscription: JSON.stringify(abo(1)) },
    { token: token(1), subscription: { ...abo(1), keys: { p256dh: 'p'.repeat(5000), auth: 'a' } } },
    { token: token(1), abmelden: true, endpoint: "https://x.example/abc'def" },
    { token: token(1), abmelden: true },
  ];
  for (const body of schlecht) {
    const { log } = datenbank({ patienten: [{ id: 'recKlient0000001', fields: { Session_Token: token(1) } }] });
    const res = antwortObjekt();
    await saveSubscription(post(body), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(log.abrufe, 0);
  }
  const { log } = datenbank({ personal: [{ id: 'recPfleger000001', fields: { Session_Token: token(4) } }] });
  const res = antwortObjekt();
  await aboPfleger(post({ subscription: { ...abo(1), endpoint: "https://x.example/a'b" } }, { authorization: `Bearer ${token(4)}` }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(log.patches.length, 0);
});

test('Token ungültig oder unbekannt -> 401, nichts geschrieben', async () => {
  let { log } = datenbank({});
  let res = antwortObjekt();
  await saveSubscription(post({ token: "x' OR 1", subscription: abo(1) }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(log.abrufe, 0);
  ({ log } = datenbank({ patienten: [{ id: 'recKlient0000001', fields: { Session_Token: token(1) } }] }));
  res = antwortObjekt();
  await saveSubscription(post({ token: token(2), subscription: abo(1) }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(log.patches.length, 0);
  assert.equal(log.suchen.length, 0);
});

test('Airtable-Fehler beim Speichern -> 500 ohne Details', async () => {
  datenbank({ patienten: [{ id: 'recKlient0000001', fields: { Session_Token: token(1) } }], patchFehler: true });
  const res = antwortObjekt();
  await ruhig(() => saveSubscription(post({ token: token(1), subscription: abo(1) }), res));
  assert.equal(res.statusCode, 500);
  assert.ok(!/INVALID|422/.test(JSON.stringify(res.body)));
});

test('Endpoint-Prüfung: echte Push-Dienste erlaubt, Formel-Zeichen nicht', () => {
  for (const e of [
    'https://web.push.apple.com/QK0KmyC9i7xPpgCjFp3Xg6gn57LSZceEtePghNOogC_AO61iZPGGjjU24',
    'https://fcm.googleapis.com/fcm/send/fOoL2srFllI:APA91bGIdmNqsFMRwyl35t3x-fy9d4f3E8Brg',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk-abc_DEF',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD%2bX3kM%3d',
  ]) assert.ok(endpointGueltig(e), e);
  for (const e of ["https://a.example/x'y", 'https://a.example/x"y', 'https://a.example/x y', 'https://a.example/{Feld}',
    'https://a.example/x\\y', 'ftp://a.example/xyz', '', null, 42]) assert.equal(endpointGueltig(e), false, String(e));
  assert.equal(aboEndpoint('kein json'), '');
  assert.equal(aboEndpoint(JSON.stringify({ endpoint: 5 })), '');
});

// ---------- App-Seite: src/push.ts (TypeScript wird für den Test nur übersetzt) ----------
const quelle = readFileSync(new URL('../src/push.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(quelle, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

function browser({ abo: vorhanden = { endpoint: geraet(1) }, erlaubnis = 'granted', fetchHaengt = false, registrierungWirft = false } = {}) {
  const aufrufe = [];
  let neuAbonniert = 0;
  const sub = vorhanden && { endpoint: vorhanden.endpoint, toJSON: () => ({ ...abo(1), endpoint: vorhanden.endpoint }) };
  globalThis.window = { atob: (s) => Buffer.from(s, 'base64').toString('binary'), PushManager: function PushManager() {} };
  globalThis.Notification = { permission: erlaubnis };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: {
      serviceWorker: {
        getRegistration: async () => {
          if (registrierungWirft) throw new Error('kein Service Worker');
          return { pushManager: { getSubscription: async () => sub || null, subscribe: async () => { neuAbonniert += 1; return sub; } } };
        },
      },
    },
  });
  globalThis.fetch = (url, opts = {}) => {
    aufrufe.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
    return fetchHaengt ? new Promise(() => {}) : Promise.resolve({ ok: true, status: 200 });
  };
  return { aufrufe, neu: () => neuAbonniert };
}
const ladePush = async () => import(`data:text/javascript;base64,${Buffer.from(`${js}\n// ${Math.random()}`).toString('base64')}`);

test('App, Abmelden: Gerät wird vom Konto gelöst (keepalive), ohne Abo/Token passiert nichts', async () => {
  let b = browser();
  let P = await ladePush();
  await P.pushVomKontoLoesen(token(1));
  assert.equal(b.aufrufe.length, 1);
  assert.equal(b.aufrufe[0].url, '/api/save-subscription');
  assert.equal(b.aufrufe[0].opts.keepalive, true);
  assert.deepEqual(b.aufrufe[0].body, { token: token(1), abmelden: true, endpoint: geraet(1) });

  b = browser();
  await P.pushVomKontoLoesen(null);
  assert.equal(b.aufrufe.length, 0);

  b = browser({ abo: null });
  P = await ladePush();
  await P.pushVomKontoLoesen(token(1));
  assert.equal(b.aufrufe.length, 0);
});

test('App, Abmelden hängt nie: höchstens ~1,5 s, Fehler werden geschluckt', { timeout: 5000 }, async () => {
  browser({ fetchHaengt: true });
  let P = await ladePush();
  const start = Date.now();
  await P.pushVomKontoLoesen(token(1));
  const dauer = Date.now() - start;
  assert.ok(dauer >= 1400 && dauer < 2500, `Dauer ${dauer} ms`);
  browser({ registrierungWirft: true });
  P = await ladePush();
  await P.pushVomKontoLoesen(token(1)); // wirft nicht
});

test('App, Klient angemeldet: vorhandenes Abo wird still übernommen - nie neu angelegt, nie gefragt', async () => {
  let b = browser();
  let P = await ladePush();
  assert.equal(await P.pushAboUebernehmen(token(2)), true);
  assert.equal(b.aufrufe.length, 1);
  assert.deepEqual(b.aufrufe[0].body, { token: token(2), subscription: { ...abo(1), endpoint: geraet(1) } });

  for (const fall of [{ erlaubnis: 'default' }, { erlaubnis: 'denied' }, { abo: null }]) {
    b = browser(fall);
    P = await ladePush();
    assert.equal(await P.pushAboUebernehmen(token(2)), false, JSON.stringify(fall));
    assert.equal(b.aufrufe.length, 0);
    assert.equal(b.neu(), 0); // kein neues Abo ohne Zutun des Nutzers
  }
  b = browser();
  P = await ladePush();
  assert.equal(await P.pushAboUebernehmen(''), false);
  assert.equal(b.aufrufe.length, 0);
});

test('App.tsx: beide Abmelde-Knöpfe lösen erst das Gerät, Klienten übernehmen ein vorhandenes Abo', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const zeile = (merkmal) => app.split('\n').find((z) => z.includes(merkmal)) || '';
  const ma = zeile("localStorage.removeItem('active_mitarbeiter_id'); localStorage.removeItem('active_mitarbeiter_name')");
  const kl = zeile('localStorage.clear(); setPatientId(null); setToken(null); window.location.reload();');
  for (const [name, z] of [['Mitarbeiter', ma], ['Klient', kl]]) {
    const loesen = z.indexOf('await pushVomKontoLoesen(');
    assert.ok(loesen > 0, `${name}: Abmelden löst das Gerät nicht vom Konto`);
    assert.ok(loesen < z.indexOf('localStorage.'), `${name}: Token wird vor dem Lösen gelöscht`);
    assert.ok(loesen < z.indexOf('window.location.reload()'), `${name}: Neustart vor dem Lösen`);
  }
  assert.match(ma, /pushVomKontoLoesen\(mitarbeiterToken \|\| localStorage\.getItem\('active_mitarbeiter_token'\)\)/);
  assert.match(kl, /pushVomKontoLoesen\(token \|\| localStorage\.getItem\('active_token'\)\)/);
  assert.match(app, /if \(aktiv\) pushAboUebernehmen\(token \|\| localStorage\.getItem\('active_token'\)\);/);
});
