// Tests für /api/app-data (Startdaten der Klienten-App) - mit Airtable-Attrappe, ohne Netz.
// Aufruf: npm test   (alle Testdaten frei erfunden)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { airtableAttrappe, antwort, anfrage, antwortObjekt, kurzWarten } from './_hilfen.mjs';
import handler, { INTERNE_FELDER } from '../api/app-data.js';

const T = {
  PATIENTEN: 'tbl5uUUSgC9p10BHQ', BESUCHE: 'tblXJOSz4LaJCG10M', AUFGABEN: 'tbllNVrLFPfjRltL4',
  DOKUMENTE: 'tblKoScXr5PeI8HKl', KONTAKTE: 'tbl0rLFTYlqNwDigk',
};
const TOKEN = 'TestToken_abcdefghijklmnopqrstuvwxyz012345';
const PID = 'recPatTest0000001';

function patient(zuletztAktiv) {
  return {
    id: PID, createdTime: '2026-01-01T00:00:00.000Z',
    fields: {
      Name: 'Erika Musterfrau', Pflegegrad: '2', Geburtsdatum: '1940-05-01', Versicherung: 'Musterkasse',
      Anschrift: 'Musterweg 1, 12345 Musterstadt', Anmelde_ID: '10001', Kunden_Nr: 'L99999',
      Session_Token: TOKEN, Login_Code: 1234, Failed_Attempts: 0, Locked_Until: '2026-01-01T00:00:00.000Z',
      Push_Subscription: '{"endpoint":"https://push.example.invalid/abc"}',
      invite_qr: [{ url: 'https://example.invalid/qr.png' }], invite_requested: true,
      Geo_Lat: 50.1, Geo_Lng: 8.6, Geo_Adresse: 'Musterweg 1, 12345 Musterstadt',
      ...(zuletztAktiv ? { Zuletzt_aktiv: zuletztAktiv } : {}),
    },
  };
}
const BESUCH = {
  id: 'recBesTest0000001', createdTime: '2026-10-01T00:00:00.000Z',
  fields: {
    'Tätigkeit': 'Grundpflege', Uhrzeit: '2026-10-20T06:00:00.000Z', Datum: '2026-10-20', Von: '08:00', Bis: '08:30',
    Status: 'Geplant', Notiz_Patient: 'Bitte klingeln', Pfleger_Name: ['Anna Beispiel'], Pfleger_Ersatz_Name: ['Bert Beispiel'],
    Patient_Name: ['Erika Musterfrau'], Adresse_Klient: ['Musterweg 1'], Dauer_Soll: 1800, Dauer_Ist: 1800,
    Erledigt_Am: '2026-10-20T07:00:00.000Z', Monat: '2026-10', Ende: '2026-10-20T06:30:00.000Z', PatientID_live: [PID],
    Pfleger: ['recPflTest0000001'], Pfleger_ID: ['recPflTest0000001'], Pfleger_Ersatz: ['recPflTest0000002'],
    Notiz_Intern: 'interne Dienstplan-Notiz', Hervorhebung: 'Neu', Plan_Tag_Key: 'recPlan|2026-10-20',
    Abweichung_Min: 0, Ist_Stunden_Monat: 1800, Dauer_Ist_alt_ungenutzt: 30, Push_senden: 'Gesendet',
    Meldungen: ['recMelTest0000001'],
  },
};
const DOKUMENT = {
  id: 'recDokTest0000001', createdTime: '2026-10-01T00:00:00.000Z',
  fields: {
    Typ: 'Rechnung', Datei: [{ url: 'https://example.invalid/r.pdf', filename: 'Rechnung.pdf' }], Dateiname: 'Rechnung Oktober',
    Status: 'Neu', Erstellt: '2026-10-01T00:00:00.000Z', Richtung: 'Vom Pflegedienst', Vom_Patienten_Gesehen: true,
    Vom_Patienten_Bestätigt_Am: '2026-10-02', Bezahlt: true, PatientID_live: [PID],
    Drive_Link: 'https://drive.example.invalid/x', Push_Gesendet: true, Push_senden: 'Gesendet',
  },
};
const AUFGABE = { id: 'recAufTest0000001', createdTime: '2026-10-01T00:00:00.000Z', fields: { Aufgabentext: 'Versichertenkarte einreichen', Status: 'Offen', PatientID_live: [PID] } };
const KONTAKT = { id: 'recKonTest0000001', createdTime: '2026-10-01T00:00:00.000Z', fields: { Name: 'Sabine Beispiel', 'Rolle/Funktion': 'Hausarzt', Telefon: '0123 456789', PatientID_live: [PID] } };

// Standard-Attrappe: Token-Lookup, PATCH und die vier Datenabfragen (je 30 ms Laufzeit).
function standard(p, { patchStatus = 200, tabelleFehler } = {}) {
  return airtableAttrappe(async (a) => {
    await kurzWarten(30);
    if (a.tabelle === T.PATIENTEN && a.methode === 'GET') {
      return antwort(200, { records: a.formel.includes(TOKEN) ? [p] : [] });
    }
    if (a.tabelle === T.PATIENTEN && a.methode === 'PATCH') return antwort(patchStatus, { id: PID });
    if (tabelleFehler && a.tabelle === tabelleFehler) return antwort(500, { error: 'SERVER_ERROR' });
    const daten = { [T.BESUCHE]: [BESUCH], [T.DOKUMENTE]: [DOKUMENT], [T.AUFGABEN]: [AUFGABE], [T.KONTAKTE]: [KONTAKT] };
    if (daten[a.tabelle]) return antwort(200, { records: daten[a.tabelle] });
    return antwort(404, { error: 'NOT_FOUND' });
  });
}

const veraltet = () => new Date(Date.now() - 60 * 60 * 1000).toISOString(); // vor 1 Std.
const frisch = () => new Date(Date.now() - 60 * 1000).toISOString();         // vor 1 Min.

test('ungültiges Token -> unauthorized ohne Airtable-Zugriff', async () => {
  const p = standard(patient(veraltet()));
  const res = antwortObjekt();
  await handler(anfrage({ token: 'kurz' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: 'unauthorized' });
  assert.equal(p.aufrufe.length, 0);
});

test('unbekanntes Token -> unauthorized', async () => {
  standard(patient(veraltet()));
  const res = antwortObjekt();
  await handler(anfrage({ token: 'Unbekannt_abcdefghijklmnopqrstuvwxyz' }), res);
  assert.deepEqual(res.body, { status: 'unauthorized' });
});

test('Antwortformat bleibt gleich und enthält alle Daten', async () => {
  standard(patient(veraltet()));
  const res = antwortObjekt();
  await handler(anfrage({ token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  const d = res.body.data;
  assert.deepEqual(Object.keys(d).sort(), ['besuche', 'dokumente', 'kontakte', 'patienten_daten', 'tasks']);
  assert.equal(d.patienten_daten.id, PID);
  assert.equal(d.besuche.length, 1);
  assert.equal(d.dokumente.length, 1);
  assert.deepEqual(d.tasks, [AUFGABE]);
  assert.deepEqual(d.kontakte, [KONTAKT]);
});

test('interne Felder werden nicht an das Gerät übertragen', async () => {
  standard(patient(veraltet()));
  const res = antwortObjekt();
  await handler(anfrage({ token: TOKEN }), res);
  const d = res.body.data;
  for (const f of INTERNE_FELDER.patient) assert.ok(!(f in d.patienten_daten.fields), `Patient: ${f} darf nicht enthalten sein`);
  for (const f of INTERNE_FELDER.besuch) assert.ok(!(f in d.besuche[0].fields), `Besuch: ${f} darf nicht enthalten sein`);
  for (const f of INTERNE_FELDER.dokument) assert.ok(!(f in d.dokumente[0].fields), `Dokument: ${f} darf nicht enthalten sein`);
  // ausdrücklich: PIN und Sitzungs-Token
  assert.equal(JSON.stringify(res.body).includes(TOKEN), false, 'Session-Token darf nicht in der Antwort stehen');
  assert.equal('Login_Code' in d.patienten_daten.fields, false);
});

test('alle übrigen Felder bleiben unverändert erhalten', async () => {
  const p = patient(veraltet());
  standard(p);
  const res = antwortObjekt();
  await handler(anfrage({ token: TOKEN }), res);
  const d = res.body.data;
  const erwartet = (rec, gesperrt) => Object.fromEntries(Object.entries(rec.fields).filter(([k]) => !gesperrt.includes(k)));
  assert.deepEqual(d.patienten_daten.fields, erwartet(p, INTERNE_FELDER.patient));
  assert.deepEqual(d.besuche[0].fields, erwartet(BESUCH, INTERNE_FELDER.besuch));
  assert.deepEqual(d.dokumente[0].fields, erwartet(DOKUMENT, INTERNE_FELDER.dokument));
  assert.equal(d.besuche[0].id, BESUCH.id);
  assert.equal(d.besuche[0].createdTime, BESUCH.createdTime);
  // Original-Objekte (z. B. Airtable-Antwort) werden nicht verändert
  assert.ok('Notiz_Intern' in BESUCH.fields);
});

test('Sperrliste enthält kein Feld, das die App liest (Regressionsschutz)', () => {
  const quelltext = ['src/App.tsx', 'src/push.ts', 'src/report.ts', 'src/main.tsx', 'src/ErrorBoundary.tsx']
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const gelesen = (feld) => {
    const e = feld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`['"\`]${e}['"\`]`).test(quelltext) || new RegExp(`\\.${e}\\b`).test(quelltext);
  };
  // Plausibilität: die Suche erkennt tatsächlich gelesene Felder
  for (const f of ['Uhrzeit', 'Tätigkeit', 'Pfleger_Name', 'Dateiname', 'Bezahlt']) assert.ok(gelesen(f), `Suche findet ${f} nicht`);
  for (const [bereich, felder] of Object.entries(INTERNE_FELDER)) {
    for (const f of felder) {
      assert.equal(gelesen(f), false, `${bereich}.${f} wird von der App gelesen - aus INTERNE_FELDER entfernen!`);
    }
  }
});

test('„Zuletzt aktiv" läuft parallel zu den Datenabfragen (keine zusätzliche Wartezeit)', async () => {
  const p = standard(patient(veraltet()));
  const res = antwortObjekt();
  await handler(anfrage({ token: TOKEN }), res);
  const patch = p.aufrufe.filter((a) => a.methode === 'PATCH');
  assert.equal(patch.length, 1);
  assert.ok(patch[0].body.fields.Zuletzt_aktiv);
  // PATCH + 4 Abfragen gleichzeitig unterwegs (vorher: PATCH erst, dann die Abfragen)
  assert.ok(p.maxGleichzeitig >= 5, `maxGleichzeitig=${p.maxGleichzeitig}`);
  // Reihenfolge: Token-Lookup zuerst
  assert.equal(p.aufrufe[0].tabelle, T.PATIENTEN);
  assert.equal(p.aufrufe[0].methode, 'GET');
});

test('„Zuletzt aktiv" wird höchstens alle 10 Minuten geschrieben', async () => {
  const p = standard(patient(frisch()));
  const res = antwortObjekt();
  await handler(anfrage({ token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(p.aufrufe.filter((a) => a.methode === 'PATCH').length, 0);
});

test('Fehler beim Schreiben von „Zuletzt aktiv" stört das Laden nicht', async () => {
  standard(patient(veraltet()), { patchStatus: 422 });
  const res = antwortObjekt();
  await handler(anfrage({ token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.besuche.length, 1);
});

test('Fehler einer Datenabfrage -> 500 ohne interne Details', async () => {
  standard(patient(veraltet()), { tabelleFehler: T.DOKUMENTE });
  const res = antwortObjekt();
  const err = console.error; console.error = () => {};
  try { await handler(anfrage({ token: TOKEN }), res); } finally { console.error = err; }
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, 'error');
  assert.equal(JSON.stringify(res.body).includes('SERVER_ERROR'), false);
});

test('nur GET erlaubt', async () => {
  standard(patient(veraltet()));
  const res = antwortObjekt();
  await handler(anfrage({ method: 'POST', token: TOKEN }), res);
  assert.equal(res.statusCode, 405);
});
