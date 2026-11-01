// Tests für den Monatsabschluss /api/stundenzettel-monatslauf (Airtable-Attrappe, ohne Netz).
// Abrechnungszeitraum seit November 2026: 27. bis 26. – der Lauf schließt am 27. den Zeitraum ab,
// der am 26. endete (Übergang: am 27.11.2026 „November 2026“ = 01.11.–26.11.). Die Tests laufen zu
// festen Uhrzeiten (t.mock.timers), unabhängig vom Testtag. Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airtableAttrappe, antwort, antwortObjekt } from './_hilfen.mjs';
import handler from '../api/stundenzettel-monatslauf.js';

process.env.CRON_SECRET = 'cron-secret-test-123';
const ZETTEL = 'tblmlg9ZNrtwRxmXx', PERSONAL = 'tbl3pMfhOLYPsQ5jF', BESUCHE = 'tblXJOSz4LaJCG10M';

// Feste Uhrzeit; der Vercel-Cron läuft täglich um 03:00 UTC (= 04:00 bzw. 05:00 Uhr deutscher Zeit).
const zeit = (t, iso) => { t.mock.timers.reset(); t.mock.timers.enable({ apis: ['Date'], now: new Date(iso) }); };
const AM_27_12 = '2026-12-27T03:00:00Z';

// Einsätze rund um den Zeitraum „Dezember 2026“ (27.11.–26.12.2026)
const BESUCHE_DEZ = [
  { id: 'recB1', fields: { Pfleger_ID: ['recMaAktivMitEins1'], Datum: '2026-12-10' } },
  { id: 'recB2', fields: { Pfleger_ID: ['recMaAktivMitEins2'], Datum: '2026-11-27' } }, // erster Tag des Zeitraums
  { id: 'recB3', fields: { Pfleger_ID: ['recMaInaktivMitEi4'], Datum: '2026-12-01' } }, // inaktiv -> kein Zettel
  { id: 'recB4', fields: { Pfleger_ID: ['recMaAktivOhneEin3'], Datum: '2026-12-27' } }, // gehört zu Januar 2027
  { id: 'recB5', fields: { Pfleger_ID: ['recMaAktivOhneEin3'], Datum: '2026-11-26' } }, // gehört zu November 2026
  { id: 'recB6', fields: { Pfleger_ID: ['recMaAktivOhneEin3'] } },                      // ohne Datum -> nie
];

function szenario({ zettel = [], besuche = BESUCHE_DEZ } = {}) {
  const log = { erstellt: [], gepatcht: [] };
  const p = airtableAttrappe(async (a) => {
    if (a.tabelle === PERSONAL) {
      return antwort(200, { records: [
        { id: 'recMaAktivMitEins1', fields: { Aktiv: true } },
        { id: 'recMaAktivMitEins2', fields: { Aktiv: true } },
        { id: 'recMaAktivOhneEin3', fields: { Aktiv: true } },
        { id: 'recMaInaktivMitEi4', fields: {} },
      ] });
    }
    if (a.tabelle === BESUCHE) return antwort(200, { records: besuche });
    if (a.tabelle === ZETTEL && a.methode === 'GET') return antwort(200, { records: zettel });
    if (a.tabelle === ZETTEL && a.methode === 'POST') { log.erstellt.push(a.body.fields); return antwort(200, { id: 'recNeu' }); }
    if (a.tabelle === ZETTEL && a.methode === 'PATCH') { log.gepatcht.push({ id: a.url.pathname.split('/')[4], fields: a.body.fields }); return antwort(200, {}); }
    return antwort(404, {});
  });
  return { p, log };
}
const req = (query = {}, auth = `Bearer ${process.env.CRON_SECRET}`) => ({ method: 'GET', headers: { authorization: auth }, query });

test('ohne gültiges Cron-Secret -> 401', async () => {
  const { p } = szenario();
  const res = antwortObjekt();
  await handler(req({}, 'Bearer falsch'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(p.aufrufe.length, 0);
});

test('kein Stichtag ohne force: nichts passiert – auch nicht mehr am 1. eines Monats', async (t) => {
  for (const iso of ['2026-12-01T03:00:00Z', '2026-12-26T03:00:00Z', '2027-01-01T03:00:00Z']) {
    zeit(t, iso);
    const { p } = szenario();
    const res = antwortObjekt();
    await handler(req(), res);
    assert.equal(res.body.status, 'skipped', iso);
    assert.equal(p.aufrufe.length, 0, iso);
  }
});

test('Stichtag 27.12.: Zettel „Dezember 2026“ (27.11.–26.12.), nur aktive Mitarbeiter mit Einsätzen im Zeitraum', async (t) => {
  zeit(t, AM_27_12);
  const { p, log } = szenario();
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.monat, 'Dezember 2026');
  assert.equal(res.body.zeitraum, '27.11.–26.12.2026');
  assert.deepEqual(log.erstellt.map((f) => f.Mitarbeiter[0]).sort(), ['recMaAktivMitEins1', 'recMaAktivMitEins2']);
  assert.ok(log.erstellt.every((f) => f.Monat_Auswahl === 'Dezember 2026' && f.Status === 'Erstellen'));
  const besuchAbfrage = p.aufrufe.find((a) => a.tabelle === BESUCHE);
  assert.equal(besuchAbfrage.formel, "AND(OR({Monat} = '2026-11', {Monat} = '2026-12'), {Status} != 'Abgesagt')");
  assert.deepEqual(besuchAbfrage.url.searchParams.getAll('fields[]').sort(), ['Datum', 'Pfleger_ID']);
});

test('Übergang: am 27.11.2026 wird „November 2026“ (01.11.–26.11.) abgeschlossen', async (t) => {
  zeit(t, '2026-11-27T03:00:00Z');
  const { p, log } = szenario({ besuche: [
    { id: 'recN1', fields: { Pfleger_ID: ['recMaAktivMitEins1'], Datum: '2026-11-26' } },
    { id: 'recN2', fields: { Pfleger_ID: ['recMaAktivMitEins2'], Datum: '2026-11-27' } }, // gehört schon zu Dezember
  ] });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.body.monat, 'November 2026');
  assert.equal(res.body.zeitraum, '01.11.–26.11.2026');
  assert.deepEqual(log.erstellt.map((f) => f.Mitarbeiter[0]), ['recMaAktivMitEins1']);
  assert.equal(p.aufrufe.find((a) => a.tabelle === BESUCHE).formel, "AND(OR({Monat} = '2026-11'), {Status} != 'Abgesagt')");
});

test('Sommerzeit und Jahreswechsel: 27.01.2027 schließt „Januar 2027“ (27.12.2026–26.01.2027) ab', async (t) => {
  zeit(t, '2027-01-27T03:00:00Z');
  const { p } = szenario({ besuche: [] });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.body.monat, 'Januar 2027');
  assert.equal(res.body.zeitraum, '27.12.2026–26.01.2027');
  assert.ok(p.aufrufe.find((a) => a.tabelle === BESUCHE).formel.includes("{Monat} = '2026-12', {Monat} = '2027-01'"));
  zeit(t, '2027-06-27T03:00:00Z'); // 05:00 Uhr Sommerzeit – derselbe Kalendertag
  const s = szenario({ besuche: [] });
  const res2 = antwortObjekt();
  await handler(req(), res2);
  assert.equal(res2.body.monat, 'Juni 2027');
  assert.ok(s.p.aufrufe.length > 0);
});

test('force an einem anderen Tag: schließt den jüngsten abgeschlossenen Abrechnungsmonat ab', async (t) => {
  zeit(t, '2026-12-05T10:00:00Z');
  const { log } = szenario({ besuche: [{ id: 'recF1', fields: { Pfleger_ID: ['recMaAktivMitEins1'], Datum: '2026-11-10' } }] });
  const res = antwortObjekt();
  await handler(req({ force: '1' }), res);
  assert.equal(res.body.monat, 'November 2026');
  assert.deepEqual(log.erstellt.map((f) => f.Mitarbeiter[0]), ['recMaAktivMitEins1']);
});

test('vorhandene Zeilen: vorläufige/fehlerhafte/alte Fassung neu erzeugen, finale und laufende in Ruhe lassen', async (t) => {
  zeit(t, AM_27_12);
  const final = 'Stundenzettel_2026-12_final.pdf';
  const alt = 'Stundenzettel_2026-12.pdf'; // Vorversion (auch mitten im Monat erzeugt) -> nicht final
  const vorl = 'Stundenzettel_2026-12_vorlaeufig_2026-12-20.pdf';
  const { log } = szenario({ zettel: [
    { id: 'recZVorlaeufig001', fields: { Mitarbeiter_ID: ['recMaAktivMitEins1'], Status: 'Erstellt', Datei: [{ filename: vorl }] } },
    { id: 'recZFinal00000002', fields: { Mitarbeiter_ID: ['recMaAktivMitEins2'], Status: 'Erstellt', Datei: [{ filename: vorl }, { filename: final }] } },
    { id: 'recZFehler0000003', fields: { Mitarbeiter_ID: ['recMaAktivOhneEin3'], Status: 'Fehler' } },
    { id: 'recZLaeuft0000004', fields: { Mitarbeiter_ID: ['recMaInaktivMitEi4'], Status: 'Erstellen' } },
    { id: 'recZAltVersion005', fields: { Mitarbeiter_ID: ['recMaAktivMitEins1'], Status: 'Erstellt', Datei: [{ filename: alt }] } },
  ] });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(log.gepatcht.map((g) => g.id).sort(), ['recZAltVersion005', 'recZFehler0000003', 'recZVorlaeufig001']);
  assert.ok(log.gepatcht.every((g) => g.fields.Status === 'Erstellen'));
  assert.equal(log.erstellt.length, 0); // beide Mitarbeiter mit Einsätzen haben schon eine Zeile
  assert.equal(res.body.neuErzeugt, 3);
});
