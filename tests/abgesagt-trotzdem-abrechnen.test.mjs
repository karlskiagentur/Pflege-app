// Abgesagt + „Abrechnen ohne Lohn“ (Hinweis Geschäftsleitung 24.11.2026): Das Büro überträgt vom
// Wochendienstplan aller Mitarbeiter die Stunden der Klienten in die Abrechnung. Ein abgesagter Einsatz
// mit Haken (z. B. kurzfristige Absage, die berechnet wird) bleibt für die Mitarbeiterin abgesagt,
// muss auf dem Blatt aber als „abrechnen“ erkennbar sein. Ohne Haken bleibt ein abgesagter Einsatz,
// wie er war. Alle Testdaten sind frei erfunden. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { airtableAttrappe, antwort, antwortObjekt, pdfTexte, pdfStreams } from './_hilfen.mjs';

process.env.STUNDENZETTEL_SECRET = 'test-secret-1234567890';
process.env.AIRTABLE_TOKEN = 'test-key';

const wu = await import('../api/_wochenuebersicht.js');
const dp = await import('../api/_dienstplan.js');
const { berechneZeitnachweis } = await import('../api/_zeitkonto.js');
const { default: wochenuebersichtHandler } = await import('../api/wochenuebersicht.js');

const FELD = 'Abrechnen ohne Lohn';
const BEREICH = dp.wocheZuDatum('2026-11-20'); // KW 47: Mo 16.11. – So 22.11.2026
const NACH_DER_WOCHE = Date.parse('2026-11-24T16:23:00+01:00');
const ma = (id, name) => ({ id, fields: { Name: name, Aktiv: true } });
const TEAM = [ma('recMA00000000001', 'Anna B.'), ma('recMA00000000002', 'Carl D.')];
const wb = (id, felder, maId = 'recMA00000000001') => ({ id, fields: { Pfleger_ID: [maId], Patient_Name: 'Erika Muster', ...felder } });

// Der Fall der Geschäftsleitung (Fr 20.11.): vier bestätigte Einsätze, der Einsatz 13:45–15:00 ist
// abgesagt UND zum Abrechnen markiert, der Einsatz 15:15–16:30 ist nur abgesagt.
const FREITAG = [
  wb('rec1', { Datum: '2026-11-20', Von: '08:00', Bis: '09:00', Dauer_Ist: 3600, Patient_Name: 'Erika Muster' }),
  wb('rec2', { Datum: '2026-11-20', Von: '09:15', Bis: '11:15', Dauer_Ist: 7200, Patient_Name: 'Otto Beispiel' }),
  wb('rec3', { Datum: '2026-11-20', Von: '11:30', Bis: '13:30', Dauer_Ist: 7200, Patient_Name: 'Hans Vorlage' }),
  wb('rec4', { Datum: '2026-11-20', Von: '13:30', Bis: '15:00', Dauer_Ist: 5400, Patient_Name: 'Lina Probe' }),
  wb('rec5', { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', Status: 'Abgesagt', [FELD]: true, Patient_Name: 'Theo Tester' }),
  wb('rec6', { Datum: '2026-11-20', Von: '15:15', Bis: '16:30', Status: 'Abgesagt', Patient_Name: 'Kurt Kunde' }),
];
const freitag = (besuche = FREITAG) => wu.baueWoche(besuche, TEAM, BEREICH, NACH_DER_WOCHE).mitarbeiter[0];

// Inhalt der Seiten (ein Eintrag je Seite, in Seitenreihenfolge) – für Linien und Maße.
const seitenInhalte = (bytes) => pdfStreams(bytes).filter((text) => / Tj/.test(text));
// Durchstreichungen einer Seite: Linien mit Strichstärke 0,6 (das Gitter hat 0,7).
function striche(seite) {
  const z = seite.split('\n').map((x) => x.trim());
  const liste = [];
  for (let i = 2; i < z.length; i++) {
    if (z[i] !== 'S') continue;
    const bis = /^([\d.-]+) ([\d.-]+) l$/.exec(z[i - 1]);
    const von = /^([\d.-]+) ([\d.-]+) m$/.exec(z[i - 2]);
    let staerke = null;
    let farbe = '';
    for (let k = i - 3; k >= 0 && z[k] !== 'q'; k--) {
      const w = /^([\d.]+) w$/.exec(z[k]);
      if (w) staerke = Number(w[1]);
      const rg = /^([\d.]+) ([\d.]+) ([\d.]+) RG$/.exec(z[k]);
      if (rg) farbe = rg.slice(1).map((x) => Number(x).toFixed(2)).join(' ');
    }
    if (von && bis && staerke === 0.6) liste.push({ farbe, laenge: Number(bis[1]) - Number(von[1]), y: Number(von[2]) });
  }
  return liste.sort((a, b) => b.y - a.y); // von oben nach unten
}
// Höhe der Summenzeile einer Seite: das letzte gefüllte Rechteck in der Breite der Tagesspalte (78).
function summenHoehe(seite) {
  const z = seite.split('\n').map((x) => x.trim());
  let hoehe = null;
  for (let i = 3; i < z.length; i++) {
    if (z[i] !== 'h' || z[i + 1] !== 'f') continue;
    const oben = /^0 ([\d.]+) l$/.exec(z[i - 3]);
    const rechts = /^([\d.]+) ([\d.]+) l$/.exec(z[i - 2]);
    if (oben && rechts && Number(rechts[1]) === 78 && rechts[2] === oben[1]) hoehe = Number(oben[1]);
  }
  return hoehe;
}
const GRAU = '0.50 0.50 0.50';
const VIOLETT = '0.42 0.25 0.63';
const SPALTE = (841.89 - 2 * 26 - 78) / 4 - 12; // nutzbare Breite einer Mitarbeiter-Spalte

// ================================================================ Daten (baueWoche)
test('Abgesagt + Haken: bleibt „abgesagt“ für die Mitarbeiterin, trägt aber die Markierung', () => {
  const sp = freitag();
  const liste = sp.tage['2026-11-20'];
  assert.deepEqual(liste.map((e) => e.status), ['bestaetigt', 'bestaetigt', 'bestaetigt', 'bestaetigt', 'abgesagt', 'abgesagt']);
  assert.equal(liste[4].ohneLohn, true, 'abgesagt + Haken');
  assert.equal(wu.istOhneLohn(liste[4]), true);
  // abgesagt OHNE Haken und alle normalen Einsätze: Aufbau wie bisher (kein zusätzliches Feld)
  for (const i of [0, 1, 2, 3, 5]) {
    assert.equal('ohneLohn' in liste[i], false, `Eintrag ${i}`);
    assert.equal(wu.istOhneLohn(liste[i]), false, `Eintrag ${i}`);
  }
  assert.deepEqual(Object.keys(liste[5]), ['art', 'klient', 'von', 'bis', 'istMin', 'planMin', 'status', 'markiert']);
  // Summe der Mitarbeiterin unverändert: 6,5 Std. bestätigt, nichts offen
  assert.deepEqual(wu.summen(sp), { min: 390, offen: 0 });
});

test('Hervorhebung „Storniert“ + Haken zählt genauso; Haken ohne Absage bleibt „ohneLohn“', () => {
  const sp = freitag([
    wb('rec1', { Datum: '2026-11-18', Von: '08:00', Bis: '09:30', Hervorhebung: 'Storniert', [FELD]: true }),
    wb('rec2', { Datum: '2026-11-19', Von: '10:00', Bis: '11:30', [FELD]: true }),
    wb('rec3', { Datum: '2026-11-19', Von: '12:00', Bis: '13:00', Dauer_Ist: 3600, [FELD]: true }),
  ]);
  assert.deepEqual(sp.tage['2026-11-18'].map((e) => [e.status, e.ohneLohn]), [['abgesagt', true]]);
  assert.deepEqual(sp.tage['2026-11-19'].map((e) => [e.status, e.ohneLohn]), [['ohneLohn', true], ['ohneLohn', true]]);
  assert.deepEqual(wu.summen(sp), { min: 0, offen: 0 });
  assert.deepEqual(wu.summeOhneLohn(sp), { min: 240, anzahl: 3 });
});

test('Haken an einer Zeile ohne Klient (Urlaub) hat weiter keine Bedeutung', () => {
  const urlaub = (status) => [{ id: 'recU', fields: { Pfleger_ID: ['recMA00000000001'], Datum: '2026-11-20', 'Abwesend/Urlaub': 'Urlaub', Status: status, [FELD]: true } }];
  const sp = freitag(urlaub('Bestätigt'));
  const eintrag = sp.tage['2026-11-20'][0];
  assert.equal(eintrag.art, 'abwesenheit');
  assert.equal('ohneLohn' in eintrag, false);
  assert.equal(wu.istOhneLohn(eintrag), false);
  assert.equal(wu.hatOhneLohn([sp]), false);
  // Ein wieder abgesagter Urlaub steht seit 25.11.2026 nicht mehr auf dem Blatt (vorher weiter als
  // „Urlaub“) – mit oder ohne Haken; der Mitarbeiter hat dann in dieser Woche keine Zeile.
  assert.equal(freitag(urlaub('Abgesagt')), undefined);
});

// ================================================================ Summe „abrechnen ohne Lohn“
test('Summe je Mitarbeiterin: geplante Zeit aller markierten Einsätze – abgesagt oder nicht', () => {
  const sp = freitag();
  assert.deepEqual(wu.summeOhneLohn(sp), { min: 75, anzahl: 1 });
  assert.equal(wu.ohneLohnSummenText(sp), '* abrechnen ohne Lohn: 1,25 Std.');
  // ohne markierten Einsatz: nichts
  const ohne = freitag(FREITAG.map((b) => { const f = { ...b.fields }; delete f[FELD]; return { ...b, fields: f }; }));
  assert.deepEqual(wu.summeOhneLohn(ohne), { min: 0, anzahl: 0 });
  assert.equal(wu.ohneLohnSummenText(ohne), '');
  assert.deepEqual(wu.summeOhneLohn(undefined), { min: 0, anzahl: 0 });
  assert.equal(wu.ohneLohnSummenText({ tage: {} }), '');
  // von Hand gebaute Einträge (wie der Renderer sie bekommt)
  const hand = { tage: { a: [
    { art: 'einsatz', status: 'ohneLohn', planMin: 90 },
    { art: 'einsatz', status: 'abgesagt', planMin: 60, ohneLohn: true },
    { art: 'einsatz', status: 'abgesagt', planMin: 120 },              // nur abgesagt: zählt nicht
    { art: 'einsatz', status: 'bestaetigt', planMin: 60, istMin: 60 }, // normal: zählt nicht
    { art: 'einsatz', status: 'offen', planMin: 45 },
    { art: 'einsatz', status: 'abgesagt', planMin: null, ohneLohn: true }, // ohne geplante Zeit: 0 Min, aber markiert
    { art: 'abwesenheit', grund: 'Urlaub', stundenMin: 480, ohneLohn: true },
  ] } };
  assert.deepEqual(wu.summeOhneLohn(hand), { min: 150, anzahl: 3 });
  assert.equal(wu.ohneLohnSummenText(hand), '* abrechnen ohne Lohn: 2,5 Std.');
});

// ================================================================ Darstellung (eintragStil)
test('Darstellung: abgesagt + Haken = violett, Zahl mit * fett, nur Klient und Zeit durchgestrichen', () => {
  const e = (felder) => ({ art: 'einsatz', planMin: 75, istMin: null, ...felder });
  // abgesagt + Haken: wird abgerechnet
  assert.deepEqual(wu.eintragStil(e({ status: 'abgesagt', ohneLohn: true })), { farbe: 'violett', rechts: '1,25*', fett: true, strich: 'text' });
  // Haken ohne Absage: wie bisher violett mit *, nichts durchgestrichen
  assert.deepEqual(wu.eintragStil(e({ status: 'ohneLohn' })), { farbe: 'violett', rechts: '1,25*', fett: true, strich: '' });
  assert.deepEqual(wu.eintragStil(e({ status: 'ohneLohn', ohneLohn: true, istMin: 90 })), { farbe: 'violett', rechts: '1,25*', fett: true, strich: '' });
  assert.deepEqual(wu.eintragStil(e({ status: 'abgesagt', ohneLohn: true, planMin: null })), { farbe: 'violett', rechts: '*', fett: true, strich: 'text' });
  // alles ohne Haken: unverändert
  assert.deepEqual(wu.eintragStil(e({ status: 'abgesagt' })), { farbe: 'grau', rechts: '1,25', fett: false, strich: 'ganz' });
  assert.deepEqual(wu.eintragStil(e({ status: 'abgesagt', planMin: null })), { farbe: 'grau', rechts: '', fett: false, strich: 'ganz' });
  assert.deepEqual(wu.eintragStil(e({ status: 'offen' })), { farbe: 'orange', rechts: 'offen', fett: false, strich: '' });
  assert.deepEqual(wu.eintragStil(e({ status: 'bestaetigt', istMin: 90 })), { farbe: 'blau', rechts: '1,5', fett: false, strich: '' });
  assert.deepEqual(wu.eintragStil(e({ status: 'geplant' })), { farbe: 'blau', rechts: '0', fett: false, strich: '' });
  // ohneLohn: false oder ein anderer Wert ist kein Haken
  assert.deepEqual(wu.eintragStil(e({ status: 'abgesagt', ohneLohn: false })), { farbe: 'grau', rechts: '1,25', fett: false, strich: 'ganz' });
  assert.deepEqual(wu.eintragStil(e({ status: 'abgesagt', ohneLohn: 'ja' })), { farbe: 'grau', rechts: '1,25', fett: false, strich: 'ganz' });
});

// ================================================================ PDF
test('PDF: der abgesagte Einsatz mit Haken steht mit „1,25*“ da, die Summe nennt „abrechnen ohne Lohn“', async () => {
  const d = wu.baueWoche(FREITAG, TEAM, BEREICH, NACH_DER_WOCHE);
  const bytes = await wu.erstelleWochenuebersichtPdf({ ...d, stand: '24.11.2026, 16:23' });
  const texte = pdfTexte(bytes);
  // beide abgesagten Einsätze stehen da: der markierte mit *, der andere wie bisher ohne
  assert.ok(texte.includes('Theo Tester 13.45–15.00'));
  assert.ok(texte.includes('Kurt Kunde 15.15–16.30'));
  assert.equal(texte.filter((t) => t === '1,25*').length, 1);
  assert.equal(texte.filter((t) => t === '1,25').length, 1);
  // Summe der Mitarbeiterin unverändert, darunter die abzurechnende Zeit
  assert.ok(texte.includes('6,5 Std. bestätigt'));
  assert.equal(texte.filter((t) => t === '* abrechnen ohne Lohn: 1,25 Std.').length, 1);
  assert.ok(!texte.includes('offen'));
  // Legende erklärt das *
  assert.ok(texte.includes(wu.LEGENDE + wu.LEGENDE_OHNE_LOHN));
  assert.match(wu.LEGENDE_OHNE_LOHN, /\* = Abrechnen ohne Lohn: .*abrechnen/);
});

test('PDF: beim markierten Einsatz sind nur Klient und Zeit durchgestrichen – die Zahl bleibt lesbar', async () => {
  const d = wu.baueWoche(FREITAG, TEAM, BEREICH, NACH_DER_WOCHE);
  const [seite] = seitenInhalte(await wu.erstelleWochenuebersichtPdf({ ...d, stand: 'x' }));
  const linien = striche(seite);
  assert.equal(linien.length, 2, 'zwei abgesagte Einsätze');
  const [markiert, nurAbgesagt] = linien; // 13:45 steht über 15:15
  // nur abgesagt: grauer Strich über die ganze Zeile samt Zahl (wie bisher)
  assert.equal(nurAbgesagt.farbe, GRAU);
  assert.ok(Math.abs(nurAbgesagt.laenge - SPALTE) < 0.01, `ganze Zeile erwartet, ist ${nurAbgesagt.laenge}`);
  // abgesagt + Haken: violetter Strich genau so lang wie „Klient Zeit“ – er endet vor der Zahl
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const textBreite = font.widthOfTextAtSize('Theo Tester 13.45–15.00', 8.5);
  assert.equal(markiert.farbe, VIOLETT);
  assert.ok(Math.abs(markiert.laenge - textBreite) < 0.01, `Strich ${markiert.laenge}, Text ${textBreite}`);
  assert.ok(markiert.laenge < SPALTE - fett.widthOfTextAtSize('1,25*', 8.5) - 7.9, 'Abstand zur Zahl');
});

test('PDF: Seiten ohne markierten Einsatz bleiben exakt, wie sie waren (zweite Summenzeile nur dort, wo nötig)', async () => {
  const personal = Array.from({ length: 5 }, (_, i) => ma(`recMA0000000001${i}`, `Test ${i} M.`));
  const basis = personal.flatMap((p, i) => [
    wb(`recA${i}`, { Datum: '2026-11-18', Von: '08:00', Bis: '09:30', Dauer_Ist: 5400, Patient_Name: `Klient ${i}` }, p.id),
    wb(`recB${i}`, { Datum: '2026-11-19', Von: '10:00', Bis: '11:00', Status: 'Abgesagt', Patient_Name: `Klient ${i}` }, p.id),
  ]);
  // nur der 5. Mitarbeiter (Seite 2) hat einen abgesagten Einsatz MIT Haken
  const absage = (haken) => wb('recX', { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', Status: 'Abgesagt', Patient_Name: 'Theo Tester', ...(haken ? { [FELD]: true } : {}) }, personal[4].id);
  const pdf = async (haken) => {
    const d = wu.baueWoche([...basis, absage(haken)], personal, BEREICH, NACH_DER_WOCHE);
    return wu.erstelleWochenuebersichtPdf({ ...d, stand: '24.11.2026, 16:23' });
  };
  const [mitSeiten, ohneSeiten] = [seitenInhalte(await pdf(true)), seitenInhalte(await pdf(false))];
  assert.equal(mitSeiten.length, 2);
  assert.equal(ohneSeiten.length, 2);
  assert.equal(mitSeiten[0], ohneSeiten[0], 'Seite 1 (kein markierter Einsatz) muss Zeichen für Zeichen gleich sein');
  assert.notEqual(mitSeiten[1], ohneSeiten[1]);
  // Maße: die Summenzeile ist nur auf der Seite mit markiertem Einsatz zweizeilig (34), sonst 22 wie bisher
  assert.deepEqual(mitSeiten.map(summenHoehe), [22, 34]);
  assert.deepEqual(ohneSeiten.map(summenHoehe), [22, 22]);
  const texte = pdfTexte(await pdf(true));
  assert.equal(texte.filter((t) => t === wu.LEGENDE).length, 1, 'Seite 1: Legende wie bisher');
  assert.equal(texte.filter((t) => t === wu.LEGENDE + wu.LEGENDE_OHNE_LOHN).length, 1, 'Seite 2: mit Zusatz');
  assert.equal(texte.filter((t) => t.startsWith('* abrechnen ohne Lohn')).length, 1, 'nur beim 5. Mitarbeiter');
  assert.ok(!pdfTexte(await pdf(false)).some((t) => t.includes('*')), 'ohne Haken: kein * auf dem ganzen Blatt');
});

test('PDF: zweite Summenzeile passt in die Spalte, auch bei großen Summen und neben „offen“', async () => {
  const doc = await PDFDocument.create();
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const gross = { tage: { a: [{ art: 'einsatz', status: 'abgesagt', planMin: 99 * 60 + 45, ohneLohn: true }] } };
  assert.equal(wu.ohneLohnSummenText(gross), '* abrechnen ohne Lohn: 99,75 Std.');
  assert.ok(fett.widthOfTextAtSize(wu.ohneLohnSummenText(gross), 9) <= SPALTE);
  // Blatt mit offenem, bestätigtem und markiertem Einsatz in einer Spalte: alle drei Angaben stehen da
  const d = wu.baueWoche([
    wb('rec1', { Datum: '2026-11-18', Von: '08:00', Bis: '09:30', Dauer_Ist: 5400 }),
    wb('rec2', { Datum: '2026-11-19', Von: '08:00', Bis: '09:00' }),
    wb('rec3', { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', Status: 'Abgesagt', [FELD]: true }),
  ], TEAM, BEREICH, NACH_DER_WOCHE);
  const texte = pdfTexte(await wu.erstelleWochenuebersichtPdf({ ...d, stand: 'x' }));
  for (const t of ['1 offen', '1,5 Std. bestätigt', '* abrechnen ohne Lohn: 1,25 Std.']) assert.ok(texte.includes(t), t);
});

// ================================================================ Endpoint
test('Endpoint Wochendienstplan: abgesagt + Haken landet mit * im hochgeladenen PDF', async () => {
  const REC = 'recWoche0000000001';
  let upload = null;
  airtableAttrappe((a) => {
    if (a.host === 'content.airtable.com') { upload = a.body; return antwort(200, { fields: { Datei: [{ id: 'att1' }] } }); }
    if (a.tabelle === 'Wochendienstplan' && a.methode === 'GET') return antwort(200, { id: REC, fields: { Woche: '2026-11-20' } });
    if (a.tabelle === 'Wochendienstplan') return antwort(200, {});
    if (a.tabelle === 'tblXJOSz4LaJCG10M') return antwort(200, { records: FREITAG });
    if (a.tabelle === 'tbl3pMfhOLYPsQ5jF') return antwort(200, { records: TEAM });
    return antwort(200, {});
  });
  const res = antwortObjekt();
  await wochenuebersichtHandler({ method: 'POST', headers: { 'x-hook-secret': process.env.STUNDENZETTEL_SECRET }, body: { recordId: REC } }, res);
  assert.equal(res.statusCode, 200);
  const texte = pdfTexte(Buffer.from(upload.file, 'base64'));
  assert.ok(texte.includes('1,25*'));
  assert.ok(texte.includes('* abrechnen ohne Lohn: 1,25 Std.'));
});

// ================================================================ Alles andere bleibt
test('Für die Mitarbeiterin ändert sich nichts: abgesagt bleibt abgesagt (Stundenzettel, Wochenplan je Mitarbeiter)', () => {
  const felder = { Datum: '2026-11-20', Von: '13:45', Bis: '15:00', Status: 'Abgesagt', Patient: ['recPatTest0000001'], Patient_Name: ['Theo Tester'] };
  const mit = { id: 'recA', fields: { ...felder, [FELD]: true } };
  const ohne = { id: 'recA', fields: felder };
  // Stundenzettel: abgesagt wird ausgelassen – nicht berechnet, nicht unter „Ohne Arbeitszeit“
  const z = berechneZeitnachweis([mit], { jetzt: '2026-11-27T04:00:00Z' });
  assert.deepEqual(z, berechneZeitnachweis([ohne], { jetzt: '2026-11-27T04:00:00Z' }));
  assert.deepEqual(z.ohneLohn, []);
  assert.deepEqual(z.ausgelassen, { abgesagt: 1, zukunft: 0 });
  // Wochenplan je Mitarbeiter: Hinweis „Abgesagt“, keine Notiz zur Zeiterfassung
  const plan = dp.wochenplan([mit], BEREICH);
  assert.deepEqual(plan, dp.wochenplan([ohne], BEREICH));
  assert.deepEqual(plan.tage[4].eintraege[0].hinweise, [{ text: 'Abgesagt', art: 'abgesagt' }]);
  assert.equal(dp.ohneLohnNotiz(plan), '');
});

// ================================================================ Test-Hilfen (tests/_hilfen.mjs)
// Aufgefallen bei diesem Auftrag: Der gepackte Seiteninhalt eines Blatts endete zufällig auf das Byte
// 0x0D. Die bisherige Textsuche hielt es für einen Zeilenumbruch und fand im ganzen Blatt keinen Text.
test('pdfTexte liest auch Streams, deren gepackte Daten auf 0x0D enden; unlesbare Streams sind ein Fehler', async () => {
  const zlib = await import('node:zlib');
  const hex = (s) => Buffer.from(s, 'latin1').toString('hex').toUpperCase();
  // Inhalt suchen, dessen gepackte Form auf 0x0D endet (im Mittel jeder 256. Versuch)
  let gepackt = null;
  let nr = 0;
  for (; nr < 20000 && !gepackt; nr++) {
    const versuch = zlib.deflateSync(Buffer.from(`BT\n<${hex(`Zeile ${nr}`)}> Tj\nET\n`, 'latin1'));
    if (versuch[versuch.length - 1] === 0x0d) gepackt = versuch;
  }
  assert.ok(gepackt, 'kein passender Inhalt gefunden');
  const pdf = (daten) => Buffer.concat([
    Buffer.from(`%PDF-1.7\n1 0 obj\n<<\n/Filter /FlateDecode\n/Length ${daten.length}\n>>\nstream\n`, 'latin1'),
    daten,
    Buffer.from('\nendstream\nendobj\n2 0 obj\n<<\n/Length 22\n>>\nstream\nBT\n<4F686E65> Tj\nET\n\n\nendstream\nendobj\n', 'latin1'),
  ]);
  assert.deepEqual(pdfTexte(pdf(gepackt)), [`Zeile ${nr - 1}`, 'Ohne']);
  assert.equal(pdfStreams(pdf(gepackt)).length, 2);
  // beschädigter gepackter Stream: Fehler statt leerem Ergebnis
  assert.throws(() => pdfTexte(pdf(gepackt.subarray(0, gepackt.length - 1))));
});
