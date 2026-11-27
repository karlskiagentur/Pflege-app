// Reiter „Adressen“ der Mitarbeiter-App (src/klienten.ts, Wunsch Pflegedienst 27.11.2026): die
// Adressen aller eigenen Klienten - auch wenn der Einsatz in der Zukunft oder Vergangenheit liegt -
// und der Link, der die Route in Google Maps öffnet. Die TypeScript-Datei wird hier mit dem
// TypeScript-Compiler übersetzt (wie tests/neuigkeiten.test.mjs). Alle Daten frei erfunden.
// Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { FENSTER_TAGE } from '../api/ma-termine.js';

const quelle = readFileSync(new URL('../src/klienten.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(quelle, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { klientenAusEinsaetzen, klientenSicher, mapsUrl, KLIENTEN_TAGE_ZURUECK } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

// „Heute“ der Tests: Freitag, 27.11.2026, 10:15 Uhr in Deutschland (UTC+1).
const TAG = 86400000;
const HEUTE = Date.parse('2026-11-27T00:00:00+01:00');
const JETZT = Date.parse('2026-11-27T10:15:00+01:00');
const ZEIT = { heuteBeginnMs: HEUTE, jetztMs: JETZT };
const tagVor = (n) => new Date(HEUTE - n * TAG + 12 * 3600000).toISOString().slice(0, 10);

let lfd = 0;
// Einsatz, wie /api/ma-termine ihn liefert (roher Airtable-Datensatz; Nachschlagefelder als Liste).
const einsatz = (tag, von, klient, zusatz = {}) => {
  const [pid, name, adresse] = klient || [];
  lfd += 1;
  return { id: `recEinsatz${String(lfd).padStart(7, '0')}`, fields: {
    'Tätigkeit': 'Hauswirtschaft', Datum: tag, Von: von, Uhrzeit: new Date(`${tag}T${von}:00+01:00`).toISOString(), Status: 'Geplant',
    ...(pid ? { Patient: [pid] } : {}), ...(name ? { Patient_Name: [name] } : {}), ...(adresse ? { Adresse_Klient: [adresse] } : {}),
    Pfleger: ['recMaAdressTest01'], Pfleger_ID: ['recMaAdressTest01'], ...zusatz,
  } };
};
const KUNDE = ['recKlAdressTest01', 'Kurt Kunde', 'Musterstraße 1, 12345 Musterstadt'];
const PROBE = ['recKlAdressTest02', 'Lina Probe', 'Beispielweg 7, 12345 Musterstadt'];
const BEISPIEL = ['recKlAdressTest03', 'Otto Beispiel', 'Probegasse 3, 12345 Musterstadt'];
const VORLAGE = ['recKlAdressTest04', 'Hans Vorlage', 'Vorlagenplatz 12, 12345 Musterstadt'];
// Ist-Zeit in der App erfasst (api/besuch-dauer.js schreibt Dauer_Ist in Sekunden + Erledigt_Am).
const IST_ERFASST = { Dauer_Ist: 3600, Erledigt_Am: '2026-11-20T09:00:00.000Z' };
const namen = (liste) => liste.map((k) => k.name);
const tagVon = (ms) => new Date(ms + 3600000).toISOString().slice(0, 10); // Kalendertag in UTC+1

test('Zeitraum: genau wie der Abruf der Einsätze (FENSTER_TAGE in api/ma-termine.js)', () => {
  assert.equal(KLIENTEN_TAGE_ZURUECK, FENSTER_TAGE);
  assert.equal(KLIENTEN_TAGE_ZURUECK, 70); // „10 Wochen“ im Text des Reiters
});

test('Adresse steht bereit, egal ob der Einsatz künftig, heute oder vergangen ist', () => {
  const liste = klientenAusEinsaetzen([
    einsatz('2026-12-03', '09:00', KUNDE),
    einsatz('2026-11-27', '13:00', PROBE),
    einsatz('2026-11-10', '08:00', BEISPIEL, IST_ERFASST),
  ], ZEIT);
  assert.deepEqual(liste, [
    { id: BEISPIEL[0], name: 'Otto Beispiel', adresse: BEISPIEL[2], naechsterMs: null, letzterMs: Date.parse('2026-11-10T08:00:00+01:00') },
    { id: KUNDE[0], name: 'Kurt Kunde', adresse: KUNDE[2], naechsterMs: Date.parse('2026-12-03T09:00:00+01:00'), letzterMs: null },
    { id: PROBE[0], name: 'Lina Probe', adresse: PROBE[2], naechsterMs: Date.parse('2026-11-27T13:00:00+01:00'), letzterMs: null },
  ]);
});

test('ein Klient mit vielen Einsätzen steht einmal da - mit nächstem und letztem Einsatz', () => {
  const liste = klientenAusEinsaetzen([
    einsatz('2026-12-07', '09:00', KUNDE),
    einsatz('2026-11-20', '09:00', KUNDE, IST_ERFASST),
    einsatz('2026-11-30', '09:00', KUNDE),
    einsatz('2026-11-25', '09:00', KUNDE, IST_ERFASST),
  ], ZEIT);
  assert.equal(liste.length, 1);
  assert.equal(tagVon(liste[0].naechsterMs), '2026-11-30');
  assert.equal(tagVon(liste[0].letzterMs), '2026-11-25');
});

test('abgesagte Einsätze und Urlaub/Abwesenheit-Zeilen (ohne Klient) zählen nicht', () => {
  const liste = klientenAusEinsaetzen([
    einsatz('2026-11-30', '09:00', KUNDE, { Status: 'Abgesagt' }),
    einsatz('2026-11-20', '09:00', KUNDE, { Status: ['Abgesagt'] }),
    einsatz('2026-11-30', '08:00', null, { 'Abwesend/Urlaub': 'Urlaub', 'Tätigkeit': 'Urlaub' }),
    einsatz('2026-12-01', '09:00', PROBE),
  ], ZEIT);
  assert.deepEqual(namen(liste), ['Lina Probe']); // Kurt Kunde: nur abgesagt -> nicht in der Liste
});

test(`nach ${KLIENTEN_TAGE_ZURUECK} Tagen ohne Einsatz verschwindet die Adresse - auch wenn der Server ältere Einsätze liefert`, () => {
  const grenze = HEUTE - KLIENTEN_TAGE_ZURUECK * TAG;
  const genau = (ms, klient) => ({ id: `recGrenze${ms}`, fields: { Uhrzeit: new Date(ms).toISOString(), Status: 'Bestätigt', Patient: [klient[0]], Patient_Name: [klient[1]], Adresse_Klient: [klient[2]] } });
  const liste = klientenAusEinsaetzen([
    genau(grenze - 1, KUNDE),                                // eine Millisekunde zu alt
    genau(grenze, PROBE),                                    // genau auf der Grenze: zählt noch
    einsatz(tagVor(200), '09:00', BEISPIEL, IST_ERFASST),     // Ausnahmefall: Server ohne Zeitfenster
    einsatz(tagVor(KLIENTEN_TAGE_ZURUECK - 1), '09:00', VORLAGE, IST_ERFASST),
  ], ZEIT);
  assert.deepEqual(namen(liste), ['Lina Probe', 'Hans Vorlage']);
  // Ein alter Einsatz macht einen aktuellen Klienten nicht älter und liefert keine Daten nach.
  const gemischt = klientenAusEinsaetzen([einsatz(tagVor(300), '09:00', KUNDE, IST_ERFASST), einsatz('2026-11-26', '09:00', KUNDE, IST_ERFASST)], ZEIT);
  assert.equal(tagVon(gemischt[0].letzterMs), '2026-11-26');
});

test('ohne gültiges „heute“ gibt es keine Liste (die 10-Wochen-Grenze wäre sonst nicht prüfbar)', () => {
  const daten = [einsatz('2026-11-30', '09:00', KUNDE), einsatz(tagVor(300), '09:00', PROBE, IST_ERFASST)];
  for (const zeit of [undefined, null, {}, { heuteBeginnMs: NaN, jetztMs: JETZT }, { heuteBeginnMs: null, jetztMs: JETZT },
    { heuteBeginnMs: '2026-11-27', jetztMs: JETZT }, { heuteBeginnMs: Infinity, jetztMs: JETZT }, 'heute', 5]) {
    assert.deepEqual(klientenAusEinsaetzen(daten, zeit), [], JSON.stringify(zeit));
  }
  // „jetzt“ fehlt: Es gilt der Tagesbeginn - die Liste bleibt richtig begrenzt.
  assert.deepEqual(namen(klientenAusEinsaetzen(daten, { heuteBeginnMs: HEUTE })), ['Kurt Kunde']);
});

test('Einsatz ohne Uhrzeit zählt nicht (er steht auch im Plan nirgends)', () => {
  const ohne = einsatz('2026-11-30', '09:00', KUNDE);
  delete ohne.fields.Uhrzeit;
  const kaputt = einsatz('2026-11-30', '09:00', PROBE, { Uhrzeit: 'morgen früh' });
  assert.deepEqual(klientenAusEinsaetzen([ohne, kaputt, einsatz('2026-11-30', '10:00', BEISPIEL)], ZEIT).map((k) => k.name), ['Otto Beispiel']);
});

test('fehlende Anschrift: der Klient steht trotzdem da (die App zeigt „Adresse fehlt“)', () => {
  const ohneAnschrift = ['recKlAdressTest09', 'Grete Probe', ''];
  const liste = klientenAusEinsaetzen([einsatz('2026-11-30', '09:00', ohneAnschrift)], ZEIT);
  assert.deepEqual(liste, [{ id: 'recKlAdressTest09', name: 'Grete Probe', adresse: '', naechsterMs: Date.parse('2026-11-30T09:00:00+01:00'), letzterMs: null }]);
  // Steht die Anschrift an einem anderen Einsatz desselben Klienten, wird sie übernommen - die jüngste gewinnt.
  const mit = klientenAusEinsaetzen([
    einsatz('2026-11-30', '09:00', ohneAnschrift),
    einsatz('2026-11-12', '09:00', ['recKlAdressTest09', 'Grete Probe', 'Alte Gasse 1, 12345 Musterstadt'], IST_ERFASST),
    einsatz('2026-11-19', '09:00', ['recKlAdressTest09', 'Grete Probe', 'Testallee 5, 12345 Musterstadt'], IST_ERFASST),
  ], ZEIT);
  assert.equal(mit.length, 1);
  assert.equal(mit[0].adresse, 'Testallee 5, 12345 Musterstadt');
});

test('heute mit erfasster Ist-Zeit = liegt hinter mir; heute noch offen oder später = kommt noch', () => {
  const um = (zeit) => Date.parse(`2026-11-27T${zeit}:00+01:00`);
  const [beispiel, kunde, gProbe, probe, tester, vorlage] = klientenAusEinsaetzen([
    einsatz('2026-11-27', '08:00', KUNDE, { Dauer_Ist: 5400, Erledigt_Am: '2026-11-27T08:35:00.000Z' }),
    einsatz('2026-11-30', '09:00', KUNDE),
    einsatz('2026-11-27', '08:30', PROBE),                        // heute früh, Ist-Zeit noch offen
    einsatz('2026-11-27', '09:00', VORLAGE, { Dauer_Ist: 3600 }),  // Ist-Zeit erfasst (ohne Zeitstempel)
    // Terminbestätigung des Klienten (Status „Bestätigt“) heißt nicht, dass der Einsatz vorbei ist
    einsatz('2026-11-27', '09:30', BEISPIEL, { Status: 'Bestätigt' }),
    einsatz('2026-11-27', '07:00', ['recKlAdressTest05', 'Grete Probe', 'Testallee 5'], { Dauer_Ist: 0 }), // 0:00 ist keine Ist-Zeit
    // Ist-Zeit vorab erfasst (Büro oder zu frühe Eingabe): Der Einsatz liegt trotzdem noch vor mir
    einsatz('2026-11-27', '12:00', ['recKlAdressTest06', 'Theo Tester', 'Am Musterhang 9'], IST_ERFASST),
    einsatz('2026-12-04', '09:00', ['recKlAdressTest06', 'Theo Tester', 'Am Musterhang 9'], IST_ERFASST),
  ], ZEIT);
  assert.deepEqual(namen([beispiel, kunde, gProbe, probe, tester, vorlage]), ['Otto Beispiel', 'Kurt Kunde', 'Grete Probe', 'Lina Probe', 'Theo Tester', 'Hans Vorlage']);
  assert.equal(tagVon(kunde.letzterMs), '2026-11-27');
  assert.equal(tagVon(kunde.naechsterMs), '2026-11-30');
  assert.deepEqual([probe.naechsterMs, probe.letzterMs], [um('08:30'), null]);
  assert.deepEqual([vorlage.naechsterMs, vorlage.letzterMs], [null, um('09:00')]);
  assert.deepEqual([beispiel.naechsterMs, beispiel.letzterMs], [um('09:30'), null]);
  assert.deepEqual([gProbe.naechsterMs, gProbe.letzterMs], [um('07:00'), null]);
  assert.deepEqual([tester.naechsterMs, tester.letzterMs], [um('12:00'), null]);
  // Ein gestriger Einsatz ohne Ist-Zeit ist vorbei - er wird nicht zum „nächsten“.
  const gestern = klientenAusEinsaetzen([einsatz('2026-11-26', '15:00', KUNDE)], ZEIT);
  assert.equal(gestern[0].naechsterMs, null);
  assert.equal(tagVon(gestern[0].letzterMs), '2026-11-26');
});

test('gleicher Name, verschiedene Klienten bleiben getrennt; ohne Verknüpfung zählt der Name', () => {
  const a = ['recKlAdressTest11', 'Grete Probe', 'Testallee 5, 12345 Musterstadt'];
  const b = ['recKlAdressTest12', 'Grete Probe', 'Am Musterhang 9, 12345 Musterstadt'];
  const liste = klientenAusEinsaetzen([einsatz('2026-11-30', '09:00', b), einsatz('2026-11-30', '11:00', a)], ZEIT);
  assert.deepEqual(liste.map((k) => [k.id, k.adresse]), [[a[0], a[2]], [b[0], b[2]]]); // gleiche Namen: feste Reihenfolge nach Datensatz
  // Ältere Antwort ohne das Feld „Patient“: Schlüssel aus dem Namen, zwei Einsätze = ein Eintrag.
  const ohneId = (tag) => einsatz(tag, '09:00', ['', 'Theo Tester', 'Kundenring 2, 12345 Musterstadt']);
  const perName = klientenAusEinsaetzen([ohneId('2026-11-30'), ohneId('2026-12-02')], ZEIT);
  assert.deepEqual(perName.map((k) => [k.id, k.name, k.adresse]), [['name:Theo Tester', 'Theo Tester', 'Kundenring 2, 12345 Musterstadt']]);
});

test('Felder als Einzelwert statt Liste; mehrzeilige Anschrift wird einzeilig', () => {
  const liste = klientenAusEinsaetzen([{ id: 'recEinzelwert00001', fields: {
    Uhrzeit: '2026-12-01T08:00:00.000Z', Status: 'Geplant', Patient: 'recKlAdressTest04', Patient_Name: 'Hans Vorlage',
    Adresse_Klient: '  Vorlagenplatz 12 \n 12345 Musterstadt  ',
  } }, { id: 'recOhneFields00001', Uhrzeit: '2026-12-02T08:00:00.000Z', Patient: ['recKlAdressTest02'], Patient_Name: ['Lina Probe'], Adresse_Klient: ['Beispielweg 7'] }], ZEIT);
  assert.deepEqual(liste.map((k) => [k.name, k.adresse]), [['Lina Probe', 'Beispielweg 7'], ['Hans Vorlage', 'Vorlagenplatz 12, 12345 Musterstadt']]);
});

test('lieber keine Adresse als eine falsche: mehrere Klienten an einem Einsatz', () => {
  const zwei = (adressen, namenListe = ['Kurt Kunde', 'Lina Probe']) => ({ id: 'recZweiKlienten001', fields: {
    Uhrzeit: '2026-12-01T08:00:00.000Z', Status: 'Geplant', Patient: [KUNDE[0], PROBE[0]], Patient_Name: namenListe, Adresse_Klient: adressen } });
  // vollzählig geliefert: jede Adresse gehört zum Klienten an derselben Stelle
  assert.deepEqual(klientenAusEinsaetzen([zwei([KUNDE[2], PROBE[2]])], ZEIT).map((k) => [k.id, k.name, k.adresse]),
    [[KUNDE[0], 'Kurt Kunde', KUNDE[2]], [PROBE[0], 'Lina Probe', PROBE[2]]]);
  // eine Adresse fehlt in der Lieferung: Zuordnung unklar -> aus diesem Einsatz keine Adresse
  assert.deepEqual(klientenAusEinsaetzen([zwei([PROBE[2]])], ZEIT).map((k) => [k.name, k.adresse]), [['Kurt Kunde', ''], ['Lina Probe', '']]);
  // ... die richtige kommt dann aus einem eigenen Einsatz des Klienten
  const ergaenzt = klientenAusEinsaetzen([zwei([PROBE[2]]), einsatz('2026-11-20', '09:00', KUNDE, IST_ERFASST)], ZEIT);
  assert.deepEqual(ergaenzt.map((k) => [k.name, k.adresse]), [['Kurt Kunde', KUNDE[2]], ['Lina Probe', '']]);
  // leere Stelle in der Lieferung (Klient ohne Anschrift): die andere Adresse verrutscht nicht
  assert.deepEqual(klientenAusEinsaetzen([zwei([null, PROBE[2]])], ZEIT).map((k) => [k.name, k.adresse]), [['Kurt Kunde', ''], ['Lina Probe', PROBE[2]]]);
  // Namen unvollständig: kein Name geraten
  assert.deepEqual(klientenAusEinsaetzen([zwei([KUNDE[2], PROBE[2]], ['Lina Probe'])], ZEIT).map((k) => [k.id, k.name]), [[KUNDE[0], ''], [PROBE[0], '']]);
});

test('sortiert nach Nachnamen - mit Umlauten, ohne Groß/Klein-Unterschied, auch bei drei Namensteilen', () => {
  const k = (nr, name) => einsatz('2026-11-30', '09:00', [`recKlSortTest${String(nr).padStart(4, '0')}`, name, 'Musterstraße 1']);
  const liste = klientenAusEinsaetzen([
    k(1, 'Max Zimmer'), k(2, 'Udo Übung'), k(3, 'anna maria beispiel'), k(4, 'Otto Ärmel'), k(5, 'Prüfstein'),
    k(6, 'Theo Tester'), k(7, 'Erika Mustermann'), k(8, 'Max Mustermann'), k(9, 'Max von Aue'),
  ], ZEIT);
  assert.deepEqual(namen(liste), ['Otto Ärmel', 'Max von Aue', 'anna maria beispiel', 'Erika Mustermann', 'Max Mustermann', 'Prüfstein', 'Theo Tester', 'Udo Übung', 'Max Zimmer']);
});

test('die Liste enthält nur Name, Adresse und die beiden Zeitpunkte - nichts sonst aus dem Einsatz', () => {
  const ein = [einsatz('2026-11-30', '09:00', KUNDE, { Notiz_Intern: 'nur fürs Büro', Notiz_Patient: 'Schlüssel beim Nachbarn', Pfleger_Name: ['Erika M.'], Geburtsdatum: '1940-01-01' })];
  const kopie = JSON.stringify(ein);
  const liste = klientenAusEinsaetzen(ein, ZEIT);
  assert.deepEqual(Object.keys(liste[0]).sort(), ['adresse', 'id', 'letzterMs', 'naechsterMs', 'name']);
  assert.ok(!/Büro|Schlüssel|Erika|1940|Hauswirtschaft/.test(JSON.stringify(liste)));
  assert.equal(JSON.stringify(ein), kopie, 'die Einsätze der App bleiben unverändert');
});

test('unbrauchbare Eingaben ergeben eine leere bzw. bereinigte Liste, nie einen Fehler', () => {
  for (const eingabe of [undefined, null, '', 'Einsätze', 42, {}, { termine: [] }, [], [null], [undefined, 5, 'x', [], {}, { fields: null }, { fields: 'kaputt' }]]) {
    assert.deepEqual(klientenAusEinsaetzen(eingabe, ZEIT), [], JSON.stringify(eingabe));
  }
  const schraeg = { id: 'recSchraeg00000001', fields: { Uhrzeit: ['2026-12-01T08:00:00.000Z'], Status: { name: 'Geplant' }, Patient: [{ id: 'recX' }, null, 'recKlAdressTest01'],
    Patient_Name: [{ error: '#ERROR!' }], Adresse_Klient: [12345], Dauer_Ist: 0 } };
  assert.deepEqual(klientenAusEinsaetzen([schraeg], ZEIT), [{ id: 'recKlAdressTest01', name: '', adresse: '12345', naechsterMs: Date.parse('2026-12-01T08:00:00.000Z'), letzterMs: null }]);
});

test('klientenSicher: wirft nie - ein Fehler in den Daten kommt als Meldung zurück, nicht als Absturz', () => {
  const gut = klientenSicher([einsatz('2026-11-30', '09:00', KUNDE)], ZEIT);
  assert.equal(gut.fehler, null);
  assert.deepEqual(namen(gut.klienten), ['Kurt Kunde']);
  const gift = { id: 'recGift00000000001', fields: {} };
  Object.defineProperty(gift.fields, 'Status', { enumerable: true, get() { throw new Error('Feld nicht lesbar'); } });
  assert.throws(() => klientenAusEinsaetzen([gift], ZEIT), /Feld nicht lesbar/);
  const schlecht = klientenSicher([einsatz('2026-11-30', '09:00', KUNDE), gift], ZEIT);
  assert.deepEqual(schlecht.klienten, []);
  assert.match(String(schlecht.fehler && schlecht.fehler.message), /Feld nicht lesbar/);
  assert.deepEqual(klientenSicher(undefined, undefined), { klienten: [], fehler: null });
});

test('Zufallsprobe: 400 erfundene Einsatzlisten - Regeln gelten immer, nichts wirft', () => {
  let saat = 20261127;
  const zufall = () => { saat = (Math.imul(saat, 1664525) + 1013904223) >>> 0; return saat / 4294967296; };
  const aus = (liste) => liste[Math.floor(zufall() * liste.length)];
  const klienten = Array.from({ length: 9 }, (_, i) => [`recKlZufall${String(i).padStart(6, '0')}`, `${aus(['Kurt', 'Lina', 'Otto', 'Hans', 'Grete', 'Theo'])} ${aus(['Kunde', 'Probe', 'Beispiel', 'Vorlage', 'Tester'])}`, `Musterstraße ${i + 1}, 12345 Musterstadt`]);
  for (let lauf = 0; lauf < 400; lauf += 1) {
    const daten = Array.from({ length: Math.floor(zufall() * 40) }, () => {
      const tage = Math.floor(zufall() * 240) - 200;         // 200 Tage zurück bis 40 Tage voraus
      const ms = HEUTE + tage * TAG + Math.floor(zufall() * 24) * 3600000;
      const klient = aus(klienten);
      const art = zufall();
      const felder = { Uhrzeit: zufall() < 0.05 ? aus(['', 'kaputt', null]) : new Date(ms).toISOString(),
        Status: aus(['Geplant', 'Geplant', 'Bestätigt', 'Abgesagt', 'Änderungswunsch', ['Geplant'], undefined]) };
      if (art > 0.1) { felder.Patient = [klient[0]]; felder.Patient_Name = zufall() < 0.9 ? [klient[1]] : klient[1]; }
      if (art > 0.1 && zufall() < 0.85) felder.Adresse_Klient = [klient[2]];
      if (zufall() < 0.3) felder.Dauer_Ist = 3600;
      return zufall() < 0.05 ? aus([null, 7, 'x', {}]) : { id: `recZ${lauf}x${Math.floor(zufall() * 1e9)}`, fields: felder, _ms: ms };
    });
    const liste = klientenAusEinsaetzen(daten, ZEIT);
    const gueltig = daten.filter((d) => d && d.fields && Array.isArray(d.fields.Patient) && typeof d.fields.Uhrzeit === 'string' && d.fields.Uhrzeit.includes('T')
      && [d.fields.Status].flat()[0] !== 'Abgesagt' && d._ms >= HEUTE - KLIENTEN_TAGE_ZURUECK * TAG);
    // genau die Klienten mit mindestens einem zählenden Einsatz - jeder einmal
    assert.deepEqual(liste.map((k) => k.id).sort(), [...new Set(gueltig.map((d) => d.fields.Patient[0]))].sort(), `Lauf ${lauf}`);
    for (const k of liste) {
      const eigene = gueltig.filter((d) => d.fields.Patient[0] === k.id).map((d) => d._ms);
      for (const ms of [k.naechsterMs, k.letzterMs]) if (ms !== null) assert.ok(eigene.includes(ms), `Lauf ${lauf}: Zeitpunkt stammt nicht aus den eigenen Einsätzen`);
      assert.ok(k.naechsterMs !== null || k.letzterMs !== null);
      if (k.naechsterMs !== null) assert.ok(k.naechsterMs >= HEUTE, `Lauf ${lauf}: „nächster“ liegt vor heute`);
      if (k.letzterMs !== null) assert.ok(k.letzterMs >= HEUTE - KLIENTEN_TAGE_ZURUECK * TAG, `Lauf ${lauf}: älter als die Grenze`);
      const stamm = klienten.find((x) => x[0] === k.id);
      assert.ok(k.adresse === '' || k.adresse === stamm[2], `Lauf ${lauf}: fremde Adresse`);
      assert.equal(k.name, stamm[1]);
    }
    assert.equal(klientenSicher(daten, ZEIT).fehler, null);
  }
});

test('Tipp auf die Adresse öffnet die Route in Google Maps (Maps-URLs: /maps/dir/ mit api=1)', () => {
  const adresse = 'Musterstraße 1, 12345 Musterstadt';
  const link = mapsUrl(adresse);
  assert.equal(link, 'https://www.google.com/maps/dir/?api=1&destination=Musterstra%C3%9Fe%201%2C%2012345%20Musterstadt');
  for (const a of [adresse, 'Äußere Übungsgasse 12/1, 12345 Ödmusterhausen', 'Am Weg 3 & 4 #2?x=1 +50%', 'Haus „Probe“, Zeile 2']) {
    const url = new URL(mapsUrl(a));
    assert.equal(`${url.origin}${url.pathname}`, 'https://www.google.com/maps/dir/');
    assert.deepEqual([...url.searchParams.keys()], ['api', 'destination'], `Zusatz-Parameter bei: ${a}`);
    assert.equal(url.searchParams.get('api'), '1');           // ohne api=1 ignoriert Google Maps die Adresse
    assert.equal(url.searchParams.get('destination'), a);     // Ziel = genau die Adresse, kein Startort (= eigener Standort)
    assert.equal(url.hash, '');
    assert.ok(!/[ ,ÄÖÜäöüß]/.test(mapsUrl(a).split('destination=')[1]), 'Leerzeichen, Kommas und Umlaute müssen kodiert sein');
  }
  // mehrzeilige Anschrift: Zeilenumbruch wird zum Komma (unverändert zum bisherigen Link der Einsatzkarte)
  assert.equal(new URL(mapsUrl('Musterstraße 1\n12345 Musterstadt')).searchParams.get('destination'), 'Musterstraße 1, 12345 Musterstadt');
  assert.ok(mapsUrl(`${'Sehr lange Straße '.repeat(20)}1, 12345 Musterstadt`).length < 2048, 'Maps-URLs sind auf 2.048 Zeichen begrenzt');
});

test('App.tsx: Reiter „Adressen“, Adresse auf allen Einsatzkarten, jeder Adress-Link öffnet Google Maps', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // ein Link-Baustein für alle Karten: kommt aus src/klienten.ts (oben geprüft), keine zweite Fassung
  assert.match(app, /import \{ klientenSicher, mapsUrl \} from '\.\/klienten';/);
  assert.ok(!/const mapsUrl\b/.test(app) && !app.includes('google.com/maps'), 'eigene Maps-Adresse in App.tsx');
  // fünfter Reiter zwischen Plan und Urlaub
  assert.match(app, /\{ id: 'tagesplan', icon: CalendarDays, label: 'Plan' \}, \{ id: 'adressen', icon: MapPin, label: 'Adressen' \}, \{ id: 'urlaub', icon: Plane, label: 'Urlaub' \}/);
  // jeder Adress-Link: neues Fenster (Handy: Google-Maps-App), ohne Rückverweis auf die App
  const links = app.match(/<a\b[^>]*?href=\{mapsUrl\([^>]*>/g) || [];
  assert.equal(links.length, 4, 'Übersicht, Plan/Heute, Plan/Demnächst, Adressen');
  for (const l of links) {
    assert.ok(l.includes('target="_blank"') && l.includes('rel="noopener noreferrer"'), l);
  }
  // Jeder Link hängt nur daran, dass eine Adresse da ist - kein abgeschalteter oder verschachtelter Zweig.
  const karten = app.match(/\{getValue\(t, 'Adresse_Klient'\) && \(\s*<a\s+href=\{mapsUrl\(getValue\(t, 'Adresse_Klient'\)\)\}/g) || [];
  assert.equal(karten.length, 3, 'Übersicht, Plan/Heute, Plan/Demnächst');
  // Übersicht: Adresse ausgeschrieben (früher nur das Wort „Route“)
  const uebersicht = app.slice(app.indexOf('{/* TAGESPLAN-VORSCHAU */}'), app.indexOf('{/* GEDÄCHTNISSTÜTZE'));
  assert.ok(uebersicht.includes("{getValue(t, 'Adresse_Klient')}</span>") && !/>\s*Route\s*</.test(uebersicht));
  // Demnächst: Adresse auch bei künftigen Einsätzen
  const demnaechst = app.slice(app.indexOf('{/* DEMNÄCHST */}'), app.indexOf('{/* IST-ZEIT BESTÄTIGEN */}'));
  assert.match(demnaechst, /\{getValue\(t, 'Adresse_Klient'\) && \(\s*<a\s+href=\{mapsUrl\(getValue\(t, 'Adresse_Klient'\)\)\}/);
  assert.ok(demnaechst.includes("{getValue(t, 'Adresse_Klient')}</span>"));
  // Reiter: aus den geladenen Einsätzen, nur solange er offen ist; Fehler werden gemeldet statt abzustürzen
  assert.match(app, /const adressen = mitarbeiterTab === 'adressen'\s*\? klientenSicher\(mitarbeiterTermine, \{ heuteBeginnMs: heute\.getTime\(\), jetztMs: Date\.now\(\) \}\)\s*: \{ klienten: \[\], fehler: null \};/);
  assert.ok(app.includes("if (adressen.fehler) reportClientError('ma-adressen', adressen.fehler);"));
  const reiter = app.slice(app.indexOf('{/* TAB: ADRESSEN'), app.indexOf('{/* TAB: LOHN */}'));
  assert.match(reiter, /\{k\.adresse \? \(\s*<a href=\{mapsUrl\(k\.adresse\)\}/);
  assert.ok(reiter.includes('in Google Maps'));
  assert.ok(reiter.includes('Adresse fehlt – bitte im Büro nachfragen.'));
  assert.ok(reiter.includes('in den letzten 10 Wochen'), 'Text des Reiters nennt den Zeitraum');
  assert.ok(!/fetch|\/api\//.test(reiter), 'der Reiter löst keinen eigenen Abruf aus');
  // nichts davon landet im Gerätespeicher (Beschluss 18.10.2026: kein Geräte-Cache)
  const speicherzeilen = app.split('\n').filter((z) => /localStorage\.setItem\(|sessionStorage|speichereJson\(|indexedDB/.test(z));
  assert.ok(speicherzeilen.length > 0);
  for (const z of speicherzeilen) assert.ok(!/klient|adress/i.test(z), `Adressen im Gerätespeicher: ${z.trim().slice(0, 80)}`);
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(/.test(quelle), 'src/klienten.ts speichert nichts und ruft nichts ab');
});
