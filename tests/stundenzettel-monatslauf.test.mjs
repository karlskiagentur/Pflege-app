// Tests für den Monatsabschluss /api/stundenzettel-monatslauf (Airtable-Attrappe, ohne Netz).
// Alle Daten frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airtableAttrappe, antwort, antwortObjekt } from './_hilfen.mjs';
import handler from '../api/stundenzettel-monatslauf.js';
import { berlin } from '../api/_zeitkonto.js';

process.env.CRON_SECRET = 'cron-secret-test-123';
const ZETTEL = 'tblmlg9ZNrtwRxmXx', PERSONAL = 'tbl3pMfhOLYPsQ5jF', BESUCHE = 'tblXJOSz4LaJCG10M';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Vormonat relativ zu heute (Berlin)
const heute = berlin(Date.now()).datum;
const vm = new Date(`${heute.slice(0, 7)}-01T12:00:00Z`); vm.setUTCDate(0);
const VORMONAT = vm.toISOString().slice(0, 7);
const VORMONAT_NAME = `${MONATE[Number(VORMONAT.slice(5, 7)) - 1]} ${VORMONAT.slice(0, 4)}`;

function szenario({ zettel = [] } = {}) {
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
    if (a.tabelle === BESUCHE) {
      return antwort(200, { records: [
        { id: 'recB1', fields: { Pfleger_ID: ['recMaAktivMitEins1'] } },
        { id: 'recB2', fields: { Pfleger_ID: ['recMaAktivMitEins2'] } },
        { id: 'recB3', fields: { Pfleger_ID: ['recMaInaktivMitEi4'] } },
      ] });
    }
    if (a.tabelle === ZETTEL && a.methode === 'GET') return antwort(200, { records: zettel });
    if (a.tabelle === ZETTEL && a.methode === 'POST') { log.erstellt.push(a.body.fields); return antwort(200, { id: 'recNeu' }); }
    if (a.tabelle === ZETTEL && a.methode === 'PATCH') { log.gepatcht.push({ id: a.url.pathname.split('/')[4], fields: a.body.fields }); return antwort(200, {}); }
    return antwort(404, {});
  });
  return { p, log };
}
const req = (query = { force: '1' }, auth = `Bearer ${process.env.CRON_SECRET}`) => ({ method: 'GET', headers: { authorization: auth }, query });

test('ohne gültiges Cron-Secret -> 401', async () => {
  const { p } = szenario();
  const res = antwortObjekt();
  await handler(req({}, 'Bearer falsch'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(p.aufrufe.length, 0);
});

test('außerhalb des 1. ohne force: nichts passiert', async () => {
  const { p } = szenario();
  const res = antwortObjekt();
  await handler(req({}), res);
  if (heute.slice(8, 10) === '01') {
    assert.equal(res.body.status, 'ok');
  } else {
    assert.equal(res.body.status, 'skipped');
    assert.equal(p.aufrufe.length, 0);
  }
});

test('Monatsabschluss: Zettel für den VORMONAT, nur aktive Mitarbeiter mit Einsätzen', async () => {
  const { p, log } = szenario();
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.monat, VORMONAT_NAME);
  assert.deepEqual(log.erstellt.map((f) => f.Mitarbeiter[0]).sort(), ['recMaAktivMitEins1', 'recMaAktivMitEins2']);
  assert.ok(log.erstellt.every((f) => f.Monat_Auswahl === VORMONAT_NAME && f.Status === 'Erstellen'));
  const besuchAbfrage = p.aufrufe.find((a) => a.tabelle === BESUCHE);
  assert.ok(besuchAbfrage.formel.includes(`{Monat} = '${VORMONAT}'`));
});

test('vorhandene Zeilen: vorläufige/fehlerhafte/alte Fassung neu erzeugen, finale und laufende in Ruhe lassen', async () => {
  const final = `Stundenzettel_${VORMONAT}_final.pdf`;
  const alt = `Stundenzettel_${VORMONAT}.pdf`; // Vorversion (auch mitten im Monat erzeugt) -> nicht final
  const vorl = `Stundenzettel_${VORMONAT}_vorlaeufig_${VORMONAT}-20.pdf`;
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
