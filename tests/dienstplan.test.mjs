// Tests für den Wochendienstplan (api/_dienstplan.js + /api/dienstplan-pdf) - mit
// Airtable-Attrappe, ohne Netz. Alle Testdaten sind frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { airtableAttrappe, antwort, antwortObjekt, pdfTexte } from './_hilfen.mjs';
import handler from '../api/dienstplan-pdf.js';
import {
  wochenBereich, dienstplanFormel, wochenplan, erstelleDienstplanPdf, dateiname, PERSONAL_FELDER as PF,
  BESUCHE_FELDER, DRUCK_SKRIPT, datumGueltig, wocheZuDatum, DATUM_MAX_TAGE, LEGENDE, abwesenheitNotiz,
} from '../api/_dienstplan.js';
import { ohneDruckLinks, istDruckFeld } from '../api/_lib.js';

const PERSONAL = 'tbl3pMfhOLYPsQ5jF';
const BESUCHE = 'tblXJOSz4LaJCG10M';
const MA = 'recMaPlanTest0001';
const SCHLUESSEL = 'AbCdEfGhIjKlMnOpQrStUvWxYz012_-9';

const ruhig = async (fn) => {
  const e = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = e; }
};
const anfrage = (query, method = 'GET') => ({ method, headers: {}, query });
const besuch = (id, fields) => ({ id, fields: { Status: 'Bestätigt', Patient_Name: ['Erika Musterfrau'], ...fields } });

// ---------------------------------------------------------------- Woche
test('Woche: Sonntag gehört zur laufenden Woche (Mo–So), KW nach ISO', () => {
  const w = wochenBereich(Date.parse('2026-10-25T11:00:00Z'));
  assert.equal(w.montag, '2026-10-19');
  assert.equal(w.sonntag, '2026-10-25');
  assert.deepEqual(w.tage, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(w.kw, 43);
  assert.equal(w.jahr, 2026);
});

test('Woche: maßgeblich ist das Berliner Datum (Montag 00:30 Uhr ist schon die neue Woche)', () => {
  const w = wochenBereich(Date.parse('2026-10-25T23:30:00Z')); // = Mo 26.10. 00:30 MEZ
  assert.equal(w.montag, '2026-10-26');
  assert.equal(w.kw, 44);
});

test('Woche: woche=1 ist die Folgewoche', () => {
  const w = wochenBereich(Date.parse('2026-10-25T11:00:00Z'), 1);
  assert.equal(w.montag, '2026-10-26');
  assert.equal(w.sonntag, '2026-11-01');
  assert.equal(w.kw, 44);
});

test('Woche: Jahreswechsel und Zeitumstellung', () => {
  assert.deepEqual(
    (({ montag, kw, jahr }) => ({ montag, kw, jahr }))(wochenBereich(Date.parse('2026-12-31T10:00:00Z'))),
    { montag: '2026-12-28', kw: 53, jahr: 2026 },
  );
  assert.equal(wochenBereich(Date.parse('2027-01-03T10:00:00Z')).kw, 53); // Sonntag der KW 53
  const neu = wochenBereich(Date.parse('2027-01-04T10:00:00Z'));
  assert.equal(neu.kw, 1);
  assert.equal(neu.jahr, 2027);
  assert.equal(wochenBereich(Date.parse('2026-03-29T10:00:00Z')).montag, '2026-03-23'); // Sommerzeit-Beginn
  assert.equal(wochenBereich(Date.parse('2026-10-25T01:30:00Z')).montag, '2026-10-19'); // Winterzeit-Beginn
});

// ---------------------------------------------------------------- Formel
test('Formel: nur Einsätze dieses Mitarbeiters, Woche mit Puffer, Injection-sicher', () => {
  const w = wochenBereich(Date.parse('2026-10-28T10:00:00Z'));
  const f = dienstplanFormel(MA, w);
  assert.ok(f.startsWith(`AND(FIND('${MA}', ARRAYJOIN({Pfleger_ID})), `));
  assert.ok(f.includes("DATETIME_PARSE('2026-10-24', 'YYYY-MM-DD')"));
  assert.ok(f.includes("DATETIME_PARSE('2026-11-03', 'YYYY-MM-DD')"));
  assert.ok(f.includes('IF({Datum}, AND(IS_AFTER({Datum}'));
  assert.ok(f.includes('IF({Uhrzeit}, AND(IS_AFTER({Uhrzeit}'));
  assert.equal((f.match(/\(/g) || []).length, (f.match(/\)/g) || []).length);
  assert.ok(dienstplanFormel("rec'x", w).includes("rec\\'x"));
});

// ---------------------------------------------------------------- Wochenplan
test('Wochenplan: Zuordnung zum Tag, Sortierung, Zeiten, Pufferränder fallen weg', () => {
  const w = wochenBereich(Date.parse('2026-10-28T10:00:00Z')); // KW 44: 26.10.–01.11.
  const plan = wochenplan([
    besuch('rec0000000000003', { Datum: '2026-10-26', Von: '09:00', Bis: '09:30', 'Tätigkeit': 'Einkaufen' }),
    besuch('rec0000000000001', { Datum: '2026-10-26', Von: '07:00', Bis: '07:45', 'Tätigkeit': 'Morgenpflege', Adresse_Klient: ['Lindenweg 4\n01234 Musterstadt'] }),
    besuch('rec0000000000002', { Datum: '2026-10-26' }),                       // ohne Uhrzeit -> ans Ende
    besuch('rec0000000000004', { Datum: '2026-10-25', Von: '08:00', Bis: '09:00' }), // Vorwoche (Puffer)
    besuch('rec0000000000005', { Datum: '2026-11-02', Von: '08:00', Bis: '09:00' }), // Folgewoche (Puffer)
    besuch('rec0000000000006', { Uhrzeit: '2026-10-26T23:30:00.000Z', Dauer_Soll: 1800 }), // ohne Datum: Di 00:30 Berlin
  ], w);
  const mo = plan.tage[0];
  assert.equal(mo.wochentag, 'Montag');
  assert.deepEqual(mo.eintraege.map((e) => e.id), ['rec0000000000001', 'rec0000000000003', 'rec0000000000002']);
  assert.equal(mo.eintraege[0].zeit, '07:00 – 07:45');
  assert.equal(mo.eintraege[0].adresse, 'Lindenweg 4, 01234 Musterstadt');
  assert.equal(mo.eintraege[2].zeit, 'ohne Uhrzeit');
  assert.equal(mo.eintraege[2].taetigkeit, 'Unterstützung');
  assert.equal(mo.einsaetze, 3);
  assert.equal(mo.planMin, 75);
  const di = plan.tage[1];
  assert.deepEqual(di.eintraege.map((e) => e.zeit), ['00:30 – 01:00']);
  assert.equal(plan.summen.einsaetze, 4);
  assert.equal(plan.summen.ohneDauer, 1);
  assert.equal(plan.tage[6].eintraege.length, 0);
});

test('Wochenplan: Abgesagtes bleibt sichtbar, zählt aber nicht; Hinweise wie im Büro markiert', () => {
  const w = wochenBereich(Date.parse('2026-10-28T10:00:00Z'));
  const plan = wochenplan([
    besuch('rec0000000000011', { Datum: '2026-10-27', Von: '08:00', Bis: '09:00', Status: 'Abgesagt', Pfleger_Ersatz_Name: ['Lea V.'] }),
    besuch('rec0000000000012', { Datum: '2026-10-27', Von: '10:00', Bis: '10:30', Hervorhebung: 'Storniert' }),
    besuch('rec0000000000013', { Datum: '2026-10-27', Von: '11:00', Bis: '11:30', Hervorhebung: 'Neu', Status: 'Änderungswunsch' }),
    besuch('rec0000000000014', { Datum: '2026-10-27', Von: '12:00', Bis: '12:30', Hervorhebung: { name: 'Zusatz' }, Status: 'Anfrage', Pfleger_Ersatz_Name: ['Lea V.', 'Tom K.'] }),
    besuch('rec0000000000015', { Datum: '2026-10-27', Von: '13:00', Bis: '13:30', Hervorhebung: 'Änderung' }),
  ], w);
  const [a, b, c, d, e] = plan.tage[1].eintraege;
  assert.equal(a.abgesagt, true);
  assert.deepEqual(a.hinweise.map((h) => h.text), ['Abgesagt']); // keine Vertretung bei Abgesagtem
  assert.equal(b.abgesagt, true);
  assert.deepEqual(c.hinweise.map((h) => h.text), ['Neu', 'Änderungswunsch']);
  assert.deepEqual(d.hinweise.map((h) => h.text), ['Zusatz', 'Anfrage', 'Vertretung: Lea V., Tom K.']);
  assert.deepEqual(e.hinweise.map((h) => h.text), ['Geändert']);
  assert.equal(plan.tage[1].einsaetze, 3);
  assert.equal(plan.tage[1].planMin, 90);
  assert.equal(plan.summen.abgesagt, 2);
});

test('Dateiname: nur ASCII, Umlaute umschrieben, KW zweistellig', () => {
  const w = wochenBereich(Date.parse('2027-01-06T10:00:00Z'));
  assert.equal(dateiname('Jürgen Ö.', w), 'Dienstplan_KW01-2027_Juergen_Oe.pdf');
  assert.equal(dateiname('Łukasz Ğ. 李', w), 'Dienstplan_KW01-2027_Lukasz_G.pdf');
  assert.equal(dateiname('', w), 'Dienstplan_KW01-2027_Mitarbeiter.pdf');
});

// ---------------------------------------------------------------- PDF
test('PDF: gültig, Druckdialog beim Öffnen, Titel, mehrseitig mit vielen Einsätzen', async () => {
  const jetzt = Date.parse('2026-10-28T13:47:00Z');
  const w = wochenBereich(jetzt);
  const viele = Array.from({ length: 40 }, (_, i) => besuch(`rec${String(i).padStart(14, '0')}`, {
    Datum: w.tage[i % 7], Von: '08:00', Bis: '08:30', Patient_Name: [`Klient ${i} Muster`],
    Adresse_Klient: ['Musterallee 1, 01234 Musterstadt'], 'Tätigkeit': 'Grundpflege und Medikamente',
  }));
  viele.push(besuch('rec99999999999999'.slice(0, 17), { Datum: w.tage[2], Von: '09:00', Bis: '09:15', Patient_Name: ['Łukasz Ğüneş 李'] }));
  const bytes = await erstelleDienstplanPdf({ maName: 'Anna B.', bereich: w, plan: wochenplan(viele, w), jetzt });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
  assert.equal(doc.getTitle(), 'Dienstplan KW 44/2026 – Anna B.');
  const aktion = doc.catalog.lookup(PDFName.of('OpenAction'));
  assert.ok(aktion, 'OpenAction fehlt');
  assert.equal(aktion.get(PDFName.of('S')).toString(), '/JavaScript');
  assert.ok(aktion.get(PDFName.of('JS')).decodeText().includes('this.print('));
  assert.equal(DRUCK_SKRIPT.includes('bUI: true'), true);
});

test('PDF: ohne Druckdialog möglich, leere Woche ergibt eine Seite', async () => {
  const jetzt = Date.parse('2026-10-28T13:47:00Z');
  const w = wochenBereich(jetzt);
  const bytes = await erstelleDienstplanPdf({ maName: 'Anna B.', bereich: w, plan: wochenplan([], w), jetzt, drucken: false });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.catalog.lookup(PDFName.of('OpenAction')), undefined);
});

// ---------------------------------------------------------------- Endpoint
function szenario({ personal, besuche = [], besucheStatus = 200, personalStatus = 200 } = {}) {
  const log = { patches: [], besucheAbfragen: [], personalAbfragen: [] };
  airtableAttrappe(async (a) => {
    if (a.tabelle === PERSONAL && a.methode === 'PATCH') { log.patches.push(a); return antwort(200, { id: MA }); }
    if (a.tabelle === PERSONAL) {
      log.personalAbfragen.push(a);
      if (personalStatus !== 200) return antwort(personalStatus, { error: 'x' });
      return antwort(200, { records: personal ? [{ id: MA, fields: personal }] : [] });
    }
    if (a.tabelle === BESUCHE) {
      log.besucheAbfragen.push(a);
      return besucheStatus === 200 ? antwort(200, { records: besuche }) : antwort(besucheStatus, { error: 'x' });
    }
    return antwort(404, {});
  });
  return log;
}
const aktiv = (extra = {}) => ({ [PF.NAME]: 'Anna B.', [PF.AKTIV]: true, ...extra });

test('Endpoint: nur GET', async () => {
  const log = szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }) });
  const res = antwortObjekt();
  await handler(anfrage({ ma: MA, t: SCHLUESSEL }, 'POST'), res);
  assert.equal(res.statusCode, 405);
  assert.equal(log.personalAbfragen.length, 0);
});

test('Endpoint: ungültige Parameter -> 400 ohne Datenbankzugriff', async () => {
  for (const q of [{ ma: 'x', t: SCHLUESSEL }, { ma: MA, t: 'kurz' }, { ma: MA, t: SCHLUESSEL, woche: '2' }, {}]) {
    const log = szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }) });
    const res = antwortObjekt();
    await handler(anfrage(q), res);
    assert.equal(res.statusCode, 400, JSON.stringify(q));
    assert.equal(log.personalAbfragen.length, 0);
    assert.match(res.headers['Content-Type'], /text\/html/);
  }
});

test('Endpoint: unbekannter oder deaktivierter Mitarbeiter bekommt nichts', async () => {
  let log = szenario({ personal: null });
  let res = antwortObjekt();
  await handler(anfrage({ ma: MA, t: SCHLUESSEL }), res);
  assert.equal(res.statusCode, 404);
  log = szenario({ personal: { [PF.NAME]: 'Anna B.', [PF.SCHLUESSEL]: SCHLUESSEL } });
  res = antwortObjekt();
  await handler(anfrage({ ma: MA, t: SCHLUESSEL }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(log.besucheAbfragen.length, 0);
});

test('Endpoint: falscher Schlüssel -> 403, keine Einsätze geladen', async () => {
  const log = szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }) });
  const res = antwortObjekt();
  await handler(anfrage({ ma: MA, t: SCHLUESSEL.replace('A', 'B') }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(log.besucheAbfragen.length, 0);
  assert.equal(log.patches.length, 0);
});

test('Endpoint: Einrichten erzeugt einen Schlüssel, liefert ihn aber nie aus', async () => {
  const log = szenario({ personal: aktiv() });
  const res = antwortObjekt();
  await handler(anfrage({ ma: MA, einrichten: '1' }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.equal(log.patches.length, 1);
  const neu = log.patches[0].body.fields[PF.SCHLUESSEL];
  assert.match(neu, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(!String(res.body).includes(neu), 'Schlüssel darf nicht in der Antwort stehen');
  assert.equal(log.besucheAbfragen.length, 0);
});

test('Endpoint: vorhandener Schlüssel wird nie überschrieben, fremder nie übernommen', async () => {
  let log = szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }) });
  let res = antwortObjekt();
  await handler(anfrage({ ma: MA, einrichten: '1' }), res); // veraltete Seite
  assert.equal(res.statusCode, 403);
  assert.equal(log.patches.length, 0);
  log = szenario({ personal: aktiv() });
  res = antwortObjekt();
  await handler(anfrage({ ma: MA, t: SCHLUESSEL }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(log.patches.length, 0);
});

test('Endpoint: richtiger Schlüssel -> PDF der aktuellen Woche, Datenminimierung, kein Cache', async () => {
  const w = wochenBereich(Date.now());
  const log = szenario({
    personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }),
    besuche: [besuch('rec0000000000021', { Datum: w.tage[1], Von: '08:00', Bis: '08:45', 'Tätigkeit': 'Morgenpflege' })],
  });
  const res = antwortObjekt();
  await handler(anfrage({ ma: MA, t: SCHLUESSEL }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.headers['Content-Disposition'], `inline; filename="${dateiname('Anna B.', w)}"`);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.ok(Buffer.isBuffer(res.body));
  assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
  // Personal: nur drei Felder über ihre IDs, genau dieser Datensatz
  const p = log.personalAbfragen[0].url;
  assert.equal(p.searchParams.get('returnFieldsByFieldId'), 'true');
  assert.deepEqual(p.searchParams.getAll('fields[]').sort(), [PF.AKTIV, PF.NAME, PF.SCHLUESSEL].sort());
  assert.equal(p.searchParams.get('filterByFormula'), `RECORD_ID() = '${MA}'`);
  // Besuche: nur die nötigen Felder, nur dieser Mitarbeiter, diese Woche
  const b = log.besucheAbfragen[0];
  assert.deepEqual(b.url.searchParams.getAll('fields[]'), BESUCHE_FELDER);
  assert.ok(!BESUCHE_FELDER.includes('Notiz_Intern'));
  assert.equal(b.formel, dienstplanFormel(MA, w));
});

test('Endpoint: woche=1 lädt die Folgewoche', async () => {
  const log = szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }) });
  const res = antwortObjekt();
  await handler(anfrage({ ma: MA, t: SCHLUESSEL, woche: '1' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(log.besucheAbfragen[0].formel, dienstplanFormel(MA, wochenBereich(Date.now(), 1)));
});

test('Endpoint: Airtable-Fehler -> Hinweisseite ohne Daten, Alarm; Überlast -> 503', async () => {
  szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }), besucheStatus: 500 });
  const meldungen = [];
  const e = console.error;
  console.error = (...a) => meldungen.push(a.join(' '));
  let res;
  try {
    res = antwortObjekt();
    await handler(anfrage({ ma: MA, t: SCHLUESSEL }), res);
  } finally { console.error = e; }
  assert.equal(res.statusCode, 500);
  assert.ok(!String(res.body).includes('Anna'));
  assert.ok(!String(res.body).includes(SCHLUESSEL));
  assert.ok(meldungen.some((m) => m.includes('[ALERT]') && m.includes('api/dienstplan-pdf')), 'Alarm fehlt');

  szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }), personalStatus: 429 });
  res = antwortObjekt();
  await ruhig(() => handler(anfrage({ ma: MA, t: SCHLUESSEL }), res));
  assert.equal(res.statusCode, 503);
});

// ---------------------------------------------------------------- Woche zu einem Datum (Dienstplan-Zeile)
const isoIn = (tage) => new Date(Date.now() + tage * 86400000).toISOString().slice(0, 10);

test('Datum: nur echte Kalendertage im erlaubten Abstand', () => {
  const jetzt = Date.parse('2026-10-25T11:00:00Z');
  assert.equal(datumGueltig('2026-11-05', jetzt), true);
  assert.equal(datumGueltig('2026-02-28', jetzt), true);
  assert.equal(datumGueltig('2026-02-30', jetzt), false);
  assert.equal(datumGueltig('2026-1-5', jetzt), false);
  assert.equal(datumGueltig('heute', jetzt), false);
  assert.equal(datumGueltig('', jetzt), false);
  assert.equal(datumGueltig('2020-01-01', jetzt), false); // zu weit weg
  assert.ok(DATUM_MAX_TAGE >= 366);
  const w = wocheZuDatum('2026-11-05');
  assert.equal(w.montag, '2026-11-02');
  assert.equal(w.sonntag, '2026-11-08');
  assert.equal(w.kw, 45);
});

test('Endpoint: datum -> Woche dieses Datums', async () => {
  const datum = isoIn(10);
  const log = szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }) });
  const res = antwortObjekt();
  await handler(anfrage({ ma: MA, t: SCHLUESSEL, datum }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(log.besucheAbfragen[0].formel, dienstplanFormel(MA, wocheZuDatum(datum)));
  assert.equal(res.headers['Content-Disposition'], `inline; filename="${dateiname('Anna B.', wocheZuDatum(datum))}"`);
});

test('Endpoint: ungültiges Datum -> 400 ohne Datenbankzugriff; Einrichten mit Datum klappt', async () => {
  for (const datum of ['2026-02-30', 'morgen', '2020-01-01', isoIn(DATUM_MAX_TAGE + 5)]) {
    const log = szenario({ personal: aktiv({ [PF.SCHLUESSEL]: SCHLUESSEL }) });
    const res = antwortObjekt();
    await handler(anfrage({ ma: MA, t: SCHLUESSEL, datum }), res);
    assert.equal(res.statusCode, 400, datum);
    assert.equal(log.personalAbfragen.length, 0);
  }
  const log = szenario({ personal: aktiv() });
  const res = antwortObjekt();
  await handler(anfrage({ ma: MA, einrichten: '1', datum: isoIn(3) }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(log.patches.length, 1);
});

// ---------------------------------------------------------------- Druck-Links nie an Apps
test('Druck-Links: Felder mit Schlüssel oder Link werden entfernt, alles andere bleibt', () => {
  const link = `https://pflege-app.example/api/dienstplan-pdf?ma=${MA}&t=${SCHLUESSEL}&datum=2026-10-27`;
  const rec = {
    id: 'recBesuchTest0001', createdTime: '2026-10-01T00:00:00.000Z',
    fields: {
      'Tätigkeit': 'Grundpflege', Patient_Name: ['Erika Musterfrau'], Pfleger_Name: ['Anna B.'],
      Pfleger_Druck_Link: [link], Dienstplan_Druck_Link: link,
      'Dienstplan drucken': { label: 'Wochenplan (PDF)', url: link },
      'Dienstplan_Schlüssel (from Pfleger)': [SCHLUESSEL],
      'Umbenannt_irgendwas': [link],
      Notiz_Patient: 'Bitte klingeln',
    },
  };
  const ohne = ohneDruckLinks(rec);
  assert.deepEqual(Object.keys(ohne.fields).sort(), ['Notiz_Patient', 'Patient_Name', 'Pfleger_Name', 'Tätigkeit']);
  assert.equal(JSON.stringify(ohne).includes(SCHLUESSEL), false);
  assert.equal(ohne.id, rec.id);
  assert.ok('Pfleger_Druck_Link' in rec.fields, 'Original darf nicht verändert werden');
  for (const name of ['Tätigkeit', 'Uhrzeit', 'Pfleger_Name', 'Adresse_Klient', 'Notiz_Patient', 'Status', 'Push_senden', 'Dauer_Ist']) {
    assert.equal(istDruckFeld(name, 'x'), false, name);
  }
  assert.equal(ohneDruckLinks(null), null);
});

// ---------------------------------------------------------------- Urlaub / Abwesenheit (06.11.2026)
// Eigene Zeile OHNE Klient, Spalte „Abwesend/Urlaub“ (Uhrzeit trägt das Büro ggf. später ein).
const abwesend = (id, fields) => ({ id, fields: { Status: 'Geplant', ...fields } });

test('Wochenplan: Urlaub ohne Uhrzeit steht als „ganztägig“ zuerst und zählt nicht zur geplanten Zeit', () => {
  const w = wochenBereich(Date.parse('2026-11-11T10:00:00Z')); // KW 46: 09.11.–15.11.
  const plan = wochenplan([
    besuch('rec0000000000021', { Datum: '2026-11-09', Von: '08:00', Bis: '09:00' }),
    abwesend('rec0000000000022', { Datum: '2026-11-09', 'Abwesend/Urlaub': 'Urlaub', 'Tätigkeit': 'Urlaub' }),
    abwesend('rec0000000000023', { Datum: '2026-11-10', Von: '06:00', Bis: '12:00', 'Abwesend/Urlaub': 'Abwesend', 'Tätigkeit': 'Fortbildung' }),
    abwesend('rec0000000000024', { Datum: '2026-11-11', 'Abwesend/Urlaub': 'Urlaub', Status: 'Abgesagt', 'Stunden Urlaub/Gleitzeit': 8 * 3600 }),
    abwesend('rec0000000000025', { Datum: '2026-11-12', 'Abwesend/Urlaub': 'Gleitzeit', 'Stunden Urlaub/Gleitzeit': 7 * 3600 + 42 * 60 }),
    abwesend('rec0000000000026', { Datum: '2026-11-13', 'Abwesend/Urlaub': 'Krank', 'Stunden Urlaub/Gleitzeit': 8 * 3600 }), // Krank: nie Stunden
  ], w);
  const [mo, di, mi, don, fr] = plan.tage;
  assert.deepEqual(mo.eintraege.map((e) => [e.id, e.zeit, e.klient, e.taetigkeit, e.adresse, e.abwesenheit]), [
    ['rec0000000000022', 'ganztägig', 'Urlaub', '', '', 'Urlaub'],
    ['rec0000000000021', '08:00 – 09:00', 'Erika Musterfrau', 'Unterstützung', '', ''],
  ]);
  assert.equal(mo.einsaetze, 1);
  assert.equal(mo.planMin, 60);
  assert.deepEqual(mo.abwesenheiten, ['Urlaub']);
  assert.deepEqual(di.eintraege.map((e) => [e.zeit, e.klient, e.taetigkeit]), [['06:00 – 12:00', 'Abwesend', 'Fortbildung']]);
  assert.equal(di.einsaetze, 0);
  assert.equal(di.planMin, 0);
  // Seit 07.11.2026: Stunden nur aus „Stunden Urlaub/Gleitzeit“ (Von/Bis ist nur das Zeitfenster)
  assert.equal(di.abwesenheitMin, 0);
  assert.equal(don.einsaetze, 0);
  assert.equal(don.planMin, 0, 'eingetragene Gleitzeit zählt nie zur geplanten Zeit');
  assert.equal(don.abwesenheitMin, 462);
  assert.deepEqual(don.abwesenheiten, ['Gleitzeit']);
  assert.equal(fr.planMin, 0);
  assert.equal(fr.abwesenheitMin, 0, 'Krank hat nie Stunden – auch wenn versehentlich etwas eingetragen ist');
  assert.deepEqual(fr.abwesenheiten, ['Krank']);
  // vom Büro wieder abgesagter Urlaub: bleibt durchgestrichen sichtbar, zählt nicht
  assert.deepEqual(mi.eintraege.map((e) => [e.klient, e.abgesagt, e.hinweise.map((h) => h.text)]), [['Urlaub', true, ['Abgesagt']]]);
  assert.deepEqual(mi.abwesenheiten, []);
  assert.equal(mi.abwesenheitMin, 0, 'abgesagter Urlaub: auch seine Stunden zählen nicht');
  assert.equal(plan.summen.einsaetze, 1);
  assert.equal(plan.summen.planMin, 60);
  assert.equal(plan.summen.ohneDauer, 0, 'Urlaub ohne Uhrzeit ist kein „Einsatz ohne Dauer“');
  assert.deepEqual(plan.summen.abwesenheiten, [
    { datum: '2026-11-09', art: 'Urlaub', min: null },
    { datum: '2026-11-10', art: 'Abwesend', min: null },
    { datum: '2026-11-12', art: 'Gleitzeit', min: 462 },
    { datum: '2026-11-13', art: 'Krank', min: null },
  ]);
  assert.equal(abwesenheitNotiz(plan),
    'Abwesenheit: Mo 09.11. Urlaub, Di 10.11. Abwesend, Do 12.11. Gleitzeit (7:42 Std.), Fr 13.11. Krank – kein Einsatz, nicht in der geplanten Zeit (Stunden siehe Stundenzettel).');
  assert.equal(abwesenheitNotiz(wochenplan([], w)), '');
  assert.equal(abwesenheitNotiz(undefined), '');
});

test('Wochenplan: Auswahl an einem Einsatz MIT Klient bleibt ein Einsatz – mit Hinweis fürs Büro', () => {
  const w = wochenBereich(Date.parse('2026-11-11T10:00:00Z'));
  const plan = wochenplan([
    besuch('rec0000000000031', { Datum: '2026-11-12', Von: '08:00', Bis: '08:30', 'Abwesend/Urlaub': 'Urlaub', Pfleger_Ersatz_Name: ['Lea V.'] }),
  ], w);
  const [e] = plan.tage[3].eintraege;
  assert.equal(e.klient, 'Erika Musterfrau');
  assert.equal(e.abwesenheit, '');
  assert.deepEqual(e.hinweise.map((h) => h.text), ['Vertretung: Lea V.', 'Urlaub eingetragen']);
  assert.equal(plan.tage[3].einsaetze, 1);
  assert.equal(plan.summen.planMin, 30);
  assert.deepEqual(plan.summen.abwesenheiten, []);
});

test('PDF: Urlaub steht am Tag, im Tageskopf und unter der Wochensumme; Legende erklärt es', async () => {
  const jetzt = Date.parse('2026-11-06T13:47:00Z');
  const w = wochenBereich(Date.parse('2026-11-11T10:00:00Z'));
  const plan = wochenplan([
    abwesend('rec0000000000041', { Datum: '2026-11-09', 'Abwesend/Urlaub': 'Urlaub' }),
    besuch('rec0000000000042', { Datum: '2026-11-10', Von: '08:00', Bis: '09:00', 'Tätigkeit': 'Grundpflege' }),
    abwesend('rec0000000000043', { Datum: '2026-11-11', 'Abwesend/Urlaub': 'Urlaub', Status: 'Abgesagt' }),
  ], w);
  const bytes = await erstelleDienstplanPdf({ maName: 'Monika B.', bereich: w, plan, jetzt });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const texte = pdfTexte(bytes);
  const montag = texte.indexOf('Montag, 09.11.2026');
  assert.ok(montag >= 0, 'Tageskopf Montag fehlt');
  assert.deepEqual(texte.slice(montag + 1, montag + 4), ['Urlaub', 'ganztägig', 'Urlaub']); // Tageskopf, Zeit, Art
  assert.ok(!texte.slice(montag, montag + 6).includes('ohne Uhrzeit'));
  assert.ok(!texte.includes('Unterstützung'), 'Urlaub darf nicht als „Unterstützung“ erscheinen');
  const mittwoch = texte.indexOf('Mittwoch, 11.11.2026');
  assert.equal(texte[mittwoch + 1], 'frei', 'nur abgesagter Urlaub -> Tag frei');
  assert.ok(texte.includes('Woche gesamt: 1 Einsatz · geplante Zeit 1:00 Std.'));
  assert.ok(texte.includes('Abwesenheit: Mo 09.11. Urlaub – kein Einsatz, nicht in der geplanten Zeit.'));
  assert.equal(LEGENDE.length, 3);
  assert.ok(LEGENDE[2].startsWith('Urlaub/Gleitzeit/Krank/Abwesend: vom Büro eingetragen – kein Einsatz, zählt nie zur geplanten Zeit'));
  assert.match(LEGENDE[2], /eingetragene Stunden stehen nur auf dem Stundenzettel/);
});

test('Endpoint: liest die Spalten „Abwesend/Urlaub“, „Stunden Urlaub/Gleitzeit“ und den Klient-Link mit', () => {
  assert.ok(BESUCHE_FELDER.includes('Abwesend/Urlaub'));
  assert.ok(BESUCHE_FELDER.includes('Stunden Urlaub/Gleitzeit'));
  assert.ok(BESUCHE_FELDER.includes('Patient'));
});
