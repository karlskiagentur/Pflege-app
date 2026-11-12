// Wochendienstplan aller Mitarbeiter als PDF: Fachregeln (bestätigt/offen/abgesagt, Urlaub,
// Krank, Sa/So), Seitenumbruch, Wochen-/Jahreswechsel, Auth und Fehlerpfad.
// Alle Testdaten sind frei erfunden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airtableAttrappe, antwort, antwortObjekt, pdfTexte } from './_hilfen.mjs';

process.env.STUNDENZETTEL_SECRET = 'test-secret-1234567890';
process.env.AIRTABLE_TOKEN = 'test-key';

const { baueWoche, erstelleWochenuebersichtPdf, stundenDe, summen, klientName, mitarbeiterName } =
  await import('../api/_wochenuebersicht.js');
const { wocheZuDatum } = await import('../api/_dienstplan.js');

// Woche Mo 09.11.2026 – So 15.11.2026 (KW 46)
const BEREICH = wocheZuDatum('2026-11-09');
const JETZT = Date.parse('2026-11-16T08:00:00+01:00'); // Montag danach: ganze Woche ist vorbei

const ma = (id, name, aktiv = true) => ({ id, fields: { Name: name, Aktiv: aktiv } });
const PERSONAL = [ma('recMA00000000001', 'Anna B.'), ma('recMA00000000002', 'Carl D.')];

const besuch = (id, felder) => ({ id, fields: { Pfleger_ID: ['recMA00000000001'], ...felder } });

test('Bereich stimmt: KW 46/2026, Mo–So', () => {
  assert.equal(BEREICH.kw, 46);
  assert.equal(BEREICH.jahr, 2026);
  assert.equal(BEREICH.tage[0], '2026-11-09');
  assert.equal(BEREICH.tage[6], '2026-11-15');
});

test('bestätigt: Ist-Zeit zählt; offen: vorbei ohne Ist; abgesagt: durchgestrichen', () => {
  const besuche = [
    besuch('rec1', { Datum: '2026-11-09', Von: '08:00', Bis: '09:30', Patient_Name: 'Erika Muster', Dauer_Ist: 5400 }),
    besuch('rec2', { Datum: '2026-11-10', Von: '08:00', Bis: '09:00', Patient_Name: 'Otto Beispiel' }), // keine Ist -> offen
    besuch('rec3', { Datum: '2026-11-11', Von: '08:00', Bis: '09:00', Patient_Name: 'Lina Probe', Status: 'Abgesagt' }),
  ];
  const d = baueWoche(besuche, PERSONAL, BEREICH, JETZT);
  const sp = d.mitarbeiter[0];
  assert.equal(sp.tage['2026-11-09'][0].status, 'bestaetigt');
  assert.equal(sp.tage['2026-11-09'][0].istMin, 90);
  assert.equal(sp.tage['2026-11-10'][0].status, 'offen');
  assert.equal(sp.tage['2026-11-11'][0].status, 'abgesagt');
  // Summe = nur bestätigte Minuten, offene werden gezählt
  assert.deepEqual(summen(sp), { min: 90, offen: 1 });
});

test('Urlaub mit Stunden zählt als Abwesenheit mit stundenMin; Krank ohne Stunden', () => {
  const besuche = [
    besuch('rec4', { Datum: '2026-11-09', 'Abwesend/Urlaub': 'Urlaub', 'Stunden Urlaub/Gleitzeit': 28800 }), // 8 Std.
    besuch('rec5', { Datum: '2026-11-10', 'Abwesend/Urlaub': 'Krank', 'Stunden Urlaub/Gleitzeit': 28800 }),  // zählt nie
  ];
  const d = baueWoche(besuche, PERSONAL, BEREICH, JETZT);
  const sp = d.mitarbeiter[0];
  const urlaub = sp.tage['2026-11-09'][0];
  assert.equal(urlaub.art, 'abwesenheit');
  assert.equal(urlaub.grund, 'Urlaub');
  assert.equal(urlaub.stundenMin, 480);
  const krank = sp.tage['2026-11-10'][0];
  assert.equal(krank.grund, 'Krank');
  assert.equal(krank.stundenMin, null, 'Krank hat nie Stunden');
  // Abwesenheit zählt nicht in die Stundensumme des Blatts
  assert.equal(summen(sp).min, 0);
});

test('markiert: Hervorhebung Neu/Geändert/Zusatz -> gelb; Storniert -> abgesagt', () => {
  const besuche = [
    besuch('rec6', { Datum: '2026-11-09', Von: '08:00', Bis: '09:00', Patient_Name: 'A B', Dauer_Ist: 3600, Hervorhebung: 'Zusatz' }),
    besuch('rec7', { Datum: '2026-11-10', Von: '08:00', Bis: '09:00', Patient_Name: 'C D', Dauer_Ist: 3600, Hervorhebung: 'Storniert' }),
  ];
  const sp = baueWoche(besuche, PERSONAL, BEREICH, JETZT).mitarbeiter[0];
  assert.equal(sp.tage['2026-11-09'][0].markiert, true);
  assert.equal(sp.tage['2026-11-10'][0].status, 'abgesagt');
});

test('Sa/So-Zeile: beide Tage landen in einer Zeile, mit Präfix Sa/So', async () => {
  const besuche = [
    besuch('rec8', { Datum: '2026-11-14', Von: '09:00', Bis: '10:00', Patient_Name: 'Sam Stag', Dauer_Ist: 3600 }),
    besuch('rec9', { Datum: '2026-11-15', Von: '09:00', Bis: '10:00', Patient_Name: 'Sonja Tag', Dauer_Ist: 3600 }),
  ];
  const d = baueWoche(besuche, PERSONAL, BEREICH, JETZT);
  assert.ok(d.mitarbeiter[0].tage['2026-11-14'], 'Samstag vorhanden');
  assert.ok(d.mitarbeiter[0].tage['2026-11-15'], 'Sonntag vorhanden');
  const texte = pdfTexte(await erstelleWochenuebersichtPdf({ ...d, stand: '16.11.2026, 08:00' }));
  assert.ok(texte.some((t) => t.includes('SA/SO')), 'Sa/So-Zeile im PDF');
  assert.ok(texte.some((t) => t.startsWith('Sa ')), 'Samstag-Eintrag mit Präfix');
  assert.ok(texte.some((t) => t.startsWith('So ')), 'Sonntag-Eintrag mit Präfix');
});

test('nur aktive Mitarbeiter mit Zeile in der Woche, nach Name sortiert', () => {
  const personal = [
    ma('recMA00000000003', 'Zoe Z.'),
    ma('recMA00000000001', 'Anna B.'),
    ma('recMA00000000004', 'Tom T.', false), // inaktiv -> nie eine Spalte
  ];
  const besuche = [
    { id: 'r1', fields: { Pfleger_ID: ['recMA00000000003'], Datum: '2026-11-09', Patient_Name: 'X', Dauer_Ist: 3600 } },
    { id: 'r2', fields: { Pfleger_ID: ['recMA00000000001'], Datum: '2026-11-09', Patient_Name: 'Y', Dauer_Ist: 3600 } },
    { id: 'r3', fields: { Pfleger_ID: ['recMA00000000004'], Datum: '2026-11-09', Patient_Name: 'Z', Dauer_Ist: 3600 } },
  ];
  const d = baueWoche(besuche, personal, BEREICH, JETZT);
  assert.deepEqual(d.mitarbeiter.map((m) => m.name), ['Anna B.', 'Zoe Z.'], 'sortiert, ohne Inaktive');
});

test('Klientenname: wie im Dienstplan (Patient_Name)', () => {
  assert.equal(klientName({ Patient_Name: 'Erika Muster' }), 'Erika Muster');
  assert.equal(klientName({ Patient_Name: ['Erika Muster'] }), 'Erika Muster', 'Lookup-Array');
  assert.equal(klientName({}), '');
});

test('Mitarbeitername: voller Name aus Name_Vollständig, sonst Kurzform', () => {
  assert.equal(mitarbeiterName({ Name: 'Erika M.', 'Name_Vollständig': 'Erika Mustermann' }), 'Erika Mustermann');
  assert.equal(mitarbeiterName({ Name: 'Erika M.' }), 'Erika M.', 'ohne Eintrag: Kurzform');
  assert.equal(mitarbeiterName({ Name: 'Erika M.', 'Name_Vollständig': '  ' }), 'Erika M.');
  const d = baueWoche(
    [{ id: 'recB1', fields: { Datum: '2026-11-09', Von: '08:00', Bis: '09:00', Patient_Name: 'Max Muster', Pfleger_ID: ['recMA000000000001'] } }],
    [{ id: 'recMA000000000001', fields: { Name: 'Erika M.', 'Name_Vollständig': 'Erika Mustermann', Aktiv: true } }],
    BEREICH, JETZT,
  );
  assert.deepEqual(d.mitarbeiter.map((m) => m.name), ['Erika Mustermann'], 'Spaltenkopf = voller Name');
});

test('Seitenumbruch: 4 Mitarbeiter je Seite -> Seitenzahl = ceil(n/4)', async () => {
  for (const [n, seiten] of [[1, 1], [4, 1], [5, 2], [9, 3]]) {
    const mitarbeiter = Array.from({ length: n }, (_, i) => ({
      id: `rec${i}`, name: `Person ${i}`,
      tage: { '2026-11-09': [{ art: 'einsatz', klient: 'A', von: '08:00', bis: '09:00', istMin: 60, status: 'bestaetigt' }] },
    }));
    const bytes = await erstelleWochenuebersichtPdf({ kw: 46, jahr: 2026, tage: BEREICH.tage, stand: 'x', mitarbeiter });
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), seiten, `${n} Mitarbeiter -> ${seiten} Seite(n)`);
  }
});

test('leere Woche: ein Blatt, kein Absturz', async () => {
  const bytes = await erstelleWochenuebersichtPdf({ kw: 46, jahr: 2026, tage: BEREICH.tage, stand: 'x', mitarbeiter: [] });
  const { PDFDocument } = await import('pdf-lib');
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test('Jahreswechsel: KW 53/2026 und KW 1/2027 werden richtig bestimmt', () => {
  const kw53 = wocheZuDatum('2026-12-31'); // Do 31.12.2026 -> KW 53/2026
  assert.equal(kw53.kw, 53);
  assert.equal(kw53.jahr, 2026);
  const kw1 = wocheZuDatum('2027-01-07');  // Do 07.01.2027 -> KW 1/2027
  assert.equal(kw1.kw, 1);
  assert.equal(kw1.jahr, 2027);
});

test('stundenDe: Dezimalstunden wie in der Word-Tabelle', () => {
  assert.equal(stundenDe(90), '1,5');
  assert.equal(stundenDe(75), '1,25');
  assert.equal(stundenDe(120), '2');
  assert.equal(stundenDe(0), '0');
});

test('PDF-Rauchtest: Kopf, Summenzeile und Legende stehen drauf', async () => {
  const besuche = [besuch('rec10', { Datum: '2026-11-09', Von: '08:00', Bis: '09:30', Patient_Name: 'Erika Muster', Dauer_Ist: 5400 })];
  const d = baueWoche(besuche, PERSONAL, BEREICH, JETZT);
  const texte = pdfTexte(await erstelleWochenuebersichtPdf({ ...d, stand: '16.11.2026, 08:00' }));
  const alles = texte.join(' ');
  assert.ok(alles.includes('Wochendienstplan KW 46 / 2026'));
  assert.ok(alles.includes('KW 46'));
  assert.ok(alles.includes('Summe'));
  assert.ok(alles.includes('1,5 Std. bestätigt'), 'Summe in Dezimalstunden');
  assert.ok(alles.includes('Vertraulich'), 'Vertraulichkeitshinweis');
  assert.ok(!alles.includes('Erika Muster') || alles.includes('Erika'), 'Klient steht als Name auf dem Blatt');
});

// --- Endpoint ----------------------------------------------------------------------------
const { default: handler, dateiname, wochenFormel, hookErlaubt } = await import('../api/wochenuebersicht.js');
const REC = 'recWP0000000000001';
const req = (secret = process.env.STUNDENZETTEL_SECRET) => ({
  method: 'POST', headers: { 'x-hook-secret': secret }, body: { recordId: REC }, query: {},
});

test('Auth: ohne/mit falschem Secret -> 401, keine Airtable-Zugriffe', async () => {
  const protokoll = airtableAttrappe(() => antwort(200, {}));
  for (const s of [undefined, '', 'falsch', 'test-secret-1234567891']) {
    const res = antwortObjekt();
    await handler({ ...req(s), headers: s === undefined ? {} : { 'x-hook-secret': s } }, res);
    assert.equal(res.statusCode, 401, `Secret ${JSON.stringify(s)} -> 401`);
  }
  assert.equal(protokoll.aufrufe.length, 0, 'kein Airtable-Zugriff ohne gültiges Secret');
});

test('Auth: zeitkonstanter Vergleich akzeptiert nur das exakte Secret', () => {
  assert.equal(hookErlaubt({ headers: { 'x-hook-secret': process.env.STUNDENZETTEL_SECRET } }), true);
  assert.equal(hookErlaubt({ headers: { 'x-hook-secret': 'zu-kurz' } }), false);
  assert.equal(hookErlaubt({ headers: {} }), false);
});

test('nur POST', async () => {
  const res = antwortObjekt();
  await handler({ ...req(), method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('ungültige recordId -> 400', async () => {
  const res = antwortObjekt();
  await handler({ ...req(), body: { recordId: 'kaputt' } }, res);
  assert.equal(res.statusCode, 400);
});

test('Erfolgsfall: PDF wird angehängt, Titel/Stand/Status gesetzt, keine Daten in der Antwort', async () => {
  const protokoll = airtableAttrappe((a) => {
    // uploadAttachment hängt die neue Fassung HINTEN an (att1 = frühere Fassung)
    if (a.host === 'content.airtable.com') return antwort(200, { fields: { Datei: [{ id: 'att1' }, { id: 'att2' }] } });
    if (a.tabelle === 'Wochendienstplan' && a.methode === 'GET') {
      return antwort(200, { id: REC, fields: { Woche: '2026-11-09', Datei: [{ id: 'att1' }] } });
    }
    if (a.tabelle === 'Wochendienstplan') return antwort(200, {});
    if (a.tabelle === 'tblXJOSz4LaJCG10M') {
      return antwort(200, { records: [besuch('rec11', { Datum: '2026-11-09', Von: '08:00', Bis: '09:30', Patient_Name: 'Erika Muster', Dauer_Ist: 5400 })] });
    }
    if (a.tabelle === 'tbl3pMfhOLYPsQ5jF') return antwort(200, { records: PERSONAL });
    return antwort(200, {});
  });
  const res = antwortObjekt();
  await handler(req(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'success');
  assert.equal(res.body.kw, 46);
  assert.equal(res.body.seiten, 1);
  assert.ok(!JSON.stringify(res.body).includes('Erika'), 'keine Plandaten in der Antwort');

  const upload = protokoll.aufrufe.find((a) => a.host === 'content.airtable.com');
  assert.ok(upload, 'PDF hochgeladen');
  assert.equal(upload.body.filename, 'Wochendienstplan_2026-KW46.pdf');
  assert.equal(upload.body.contentType, 'application/pdf');

  const patch = protokoll.aufrufe.find((a) => a.tabelle === 'Wochendienstplan' && a.methode === 'PATCH');
  assert.equal(patch.body.fields.Titel, 'Wochendienstplan KW 46/2026');
  assert.equal(patch.body.fields.Status, 'Erstellt');
  assert.ok(patch.body.fields.Stand, 'Stand gesetzt');
  assert.deepEqual(patch.body.fields.Datei, [{ id: 'att2' }, { id: 'att1' }], 'neue Fassung vorne, alte bleibt');
});

test('Fehlerpfad: Status -> Fehler, keine Airtable-Details an den Aufrufer', async () => {
  const protokoll = airtableAttrappe((a) => {
    if (a.tabelle === 'Wochendienstplan' && a.methode === 'GET') return antwort(500, { error: 'geheim' });
    return antwort(200, {});
  });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes('geheim'), 'keine Airtable-Details nach außen');
  const patch = protokoll.aufrufe.find((a) => a.tabelle === 'Wochendienstplan' && a.methode === 'PATCH');
  assert.equal(patch.body.fields.Status, 'Fehler');
});

test('Airtable-Überlast (429) -> 503', async () => {
  airtableAttrappe((a) => {
    if (a.tabelle === 'Wochendienstplan' && a.methode === 'GET') return antwort(429, {});
    return antwort(200, {});
  });
  const res = antwortObjekt();
  await handler(req(), res);
  assert.equal(res.statusCode, 503);
});

test('Dateiname und Wochenformel', () => {
  assert.equal(dateiname({ jahr: 2026, kw: 46 }), 'Wochendienstplan_2026-KW46.pdf');
  assert.equal(dateiname({ jahr: 2027, kw: 1 }), 'Wochendienstplan_2027-KW01.pdf');
  const f = wochenFormel(BEREICH);
  assert.ok(f.includes('2026-11-09') && f.includes('2026-11-15'), 'Woche steht in der Formel');
});
