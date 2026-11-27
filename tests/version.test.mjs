// Neue App-Version in der Mitarbeiter-App ohne Abmelden (src/version.ts, Wunsch Karl 27.11.2026: „nur App
// schließen und wieder öffnen“). Die TypeScript-Datei wird hier mit dem TypeScript-Compiler übersetzt (wie
// tests/neuigkeiten.test.mjs). Keine Personendaten. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const quelle = readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(quelle, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const V = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

const ALT = '/assets/index-Alt12345.js';
const NEU = '/assets/index-Neu67_8-9.js';

// Speicher-Attrappe wie window.sessionStorage
const speicher = () => {
  const daten = new Map();
  return { daten, getItem: (k) => (daten.has(k) ? daten.get(k) : null), setItem: (k, v) => { daten.set(k, String(v)); }, removeItem: (k) => { daten.delete(k); } };
};
const kaputt = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('gesperrt'); }, removeItem() { throw new Error('gesperrt'); } };
const vergesslich = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// Zustand der Mitarbeiter-Ansicht, in dem nichts offen ist (wie direkt nach dem Öffnen der App)
const FREI = { dauerInput: {}, dauerConfirm: null, dauerSaving: null, meldungOffen: null, meldungSending: false, urlaubVon: '', urlaubBis: '',
  urlaubNotiz: '', urlaubSending: false, lohnVorschau: null, activeModal: null, pushLaedt: false };

test('bundleAus: Haupt-Bundle aus index.html bzw. <script src>', () => {
  const html = `<!doctype html><html><head><script type="module" crossorigin src="${NEU}"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-LG13F28o.css"></head><body><div id="root"></div></body></html>`;
  assert.equal(V.bundleAus(html), NEU);
  assert.equal(V.bundleAus(ALT), ALT);
  assert.equal(V.bundleAus(`https://pflege-app.example${ALT}?x=1`), ALT);
  for (const unbrauchbar of ['', '<html></html>', '/assets/index-.js', '/assets/pdf-Dd0sOQuD.js', '/assets/index-LG13F28o.css', null, undefined, 42, {}, [ALT]]) {
    assert.equal(V.bundleAus(unbrauchbar), '', String(unbrauchbar));
  }
});

test('maInArbeit: nichts offen = frei; jede Eingabe, jeder Dialog und jedes Speichern = in Arbeit', () => {
  assert.equal(V.maInArbeit(FREI), false);
  assert.equal(V.maInArbeit({ ...FREI, dauerInput: null, urlaubNotiz: '   ', meldungSending: 0 === 1 }), false);
  const offen = {
    dauerInput: { recEinsatz0000001: '75' }, dauerConfirm: { besuchId: 'recEinsatz0000001', minuten: 75 }, dauerSaving: 'recEinsatz0000001',
    meldungOffen: { id: 'recEinsatz0000001' }, meldungSending: true, urlaubVon: '2026-12-21', urlaubBis: '2026-12-24', urlaubNotiz: 'Weihnachten',
    urlaubSending: true, lohnVorschau: { lohnId: 'recLohn0000000001' }, activeModal: 'lohn-choice', pushLaedt: true,
  };
  for (const [feld, wert] of Object.entries(offen)) {
    assert.equal(V.maInArbeit({ ...FREI, [feld]: wert }), true, `${feld} offen, trotzdem „frei“`);
  }
  // Ist-Zeit eingetippt, aber noch nicht gespeichert - auch eine leere Eingabe zählt (Feld bearbeitet)
  assert.equal(V.maInArbeit({ ...FREI, dauerInput: { recEinsatz0000001: '' } }), true);
});

test('maInArbeit: unbekannter Zustand gilt als „in Arbeit“ (lieber der Hinweis als eine verlorene Eingabe)', () => {
  for (const s of [undefined, null, 'frei', 7, {}, { ...FREI, dauerInput: undefined }, { ...FREI, dauerInput: 'kaputt' }]) {
    assert.equal(V.maInArbeit(s), true, JSON.stringify(s));
  }
});

test('neustartVormerken: höchstens ein automatischer Neustart je Version', () => {
  const s = speicher();
  assert.equal(V.neustartVormerken(NEU, s), true);
  assert.equal(s.getItem(V.NEUSTART_SCHLUESSEL), NEU);
  assert.equal(V.neustartVormerken(NEU, s), false, 'zweiter Neustart für dieselbe Version (Schleife)');
  assert.equal(V.neustartVormerken(ALT, s), true, 'eine spätere, andere Version darf wieder einmal');
  assert.equal(V.neustartVormerken(ALT, s), false);
});

test('neustartVormerken: ohne nutzbaren Sitzungsspeicher oder ohne gültige Version kein automatischer Neustart', () => {
  assert.equal(V.neustartVormerken(NEU, null), false);
  assert.equal(V.neustartVormerken(NEU, undefined), false);
  assert.equal(V.neustartVormerken(NEU, kaputt), false);
  assert.equal(V.neustartVormerken(NEU, vergesslich), false, 'Speicher merkt sich nichts -> sonst Schleife möglich');
  for (const ziel of ['', 'irgendwas', '/assets/index-.js', null, undefined]) assert.equal(V.neustartVormerken(ziel, speicher()), false, String(ziel));
});

test('Reiter merken: nach dem Neustart öffnet die App denselben Reiter - einmalig', () => {
  for (const reiter of V.MA_REITER) {
    const s = speicher();
    V.reiterMerken(reiter, s);
    assert.equal(V.reiterNachNeustart(s), reiter);
    assert.equal(s.getItem(V.REITER_SCHLUESSEL), null, 'nach dem Lesen gelöscht');
    assert.equal(V.reiterNachNeustart(s), null, 'beim nächsten Start wieder Übersicht');
  }
  const s = speicher();
  V.reiterMerken('einstellungen', s);
  assert.equal(s.getItem(V.REITER_SCHLUESSEL), null, 'unbekannter Reiter wird nicht gemerkt');
  s.setItem(V.REITER_SCHLUESSEL, 'irgendwas');
  assert.equal(V.reiterNachNeustart(s), null);
  assert.equal(s.getItem(V.REITER_SCHLUESSEL), null, 'unbrauchbarer Wert wird entfernt');
  assert.equal(V.reiterNachNeustart(kaputt), null);
  assert.equal(V.reiterNachNeustart(null), null);
  V.reiterMerken('adressen', kaputt); // wirft nicht
  V.reiterMerken('adressen', null);
});

test('sitzungsSpeicher: ohne Browser null, wirft nie', () => {
  assert.equal(V.sitzungsSpeicher(), null);
});

test('App.tsx: Reiter-Liste stimmt mit der Reiterleiste überein', () => {
  assert.match(app, /useState<'uebersicht'\|'tagesplan'\|'adressen'\|'urlaub'\|'lohn'>\(/);
  const leiste = /\{\[ \{ id: 'uebersicht', icon: Phone, label: 'Übersicht' \},[^\n]*\]\.map\(\(tab\) =>/.exec(app);
  assert.ok(leiste, 'Reiterleiste nicht gefunden');
  assert.deepEqual([...leiste[0].matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]), [...V.MA_REITER]);
});

test('App.tsx: neue Version - Mitarbeiter-App startet selbst neu, wenn nichts in Arbeit ist, sonst Hinweis', () => {
  assert.match(app, /import \{ bundleAus, maInArbeit, neustartVormerken, reiterMerken, reiterNachNeustart, sitzungsSpeicher \} from '\.\/version';/);
  // Reiter nach dem Neustart: Ziel eines Pushs geht vor, sonst der gemerkte Reiter, sonst Übersicht
  assert.ok(app.includes("const START_REITER = typeof window !== 'undefined' ? reiterNachNeustart(sitzungsSpeicher()) : null;"));
  assert.ok(app.includes("(() => maTabFuerZiel(START_ZIEL) || START_REITER || 'uebersicht')"));
  // Neustart nur in der Mitarbeiter-Ansicht, nur ohne laufende Eingabe, höchstens einmal je Version
  const start = app.indexOf('autoNeustartRef.current = () => {');
  const ende = app.indexOf('\n  };', start);
  assert.ok(start > 0 && ende > start);
  const neustart = app.slice(start, ende);
  assert.ok(neustart.includes('if (!ziel || !mitarbeiterId) return false;'), 'Klienten-Ansicht darf nicht neu starten');
  for (const feld of ['dauerInput,', 'dauerConfirm,', 'dauerSaving,', 'meldungOffen: meldungTermin,', 'meldungSending,', 'urlaubVon,', 'urlaubBis,',
    'urlaubNotiz,', 'urlaubSending,', 'lohnVorschau,', 'activeModal,', "pushLaedt: mitarbeiterPushStatus === 'loading',"]) {
    assert.ok(neustart.includes(feld), `maInArbeit ohne ${feld}`);
  }
  const iArbeit = neustart.indexOf('if (maInArbeit({');
  const iVormerken = neustart.indexOf('if (!neustartVormerken(ziel, speicher)) return false;');
  const iReiter = neustart.indexOf('reiterMerken(mitarbeiterTab, speicher);');
  const iReload = neustart.indexOf('window.location.reload();');
  assert.ok(iArbeit > 0 && iArbeit < iVormerken && iVormerken < iReiter && iReiter < iReload, 'Reihenfolge: in Arbeit? -> einmal je Version -> Reiter merken -> Neustart');
  // Versions-Check: erkannt -> erst Neustart versuchen, sonst Hinweis; danach bei jeder Rückkehr erneut versuchen
  assert.ok(app.includes('if (neueVersionRef.current) { autoNeustartRef.current(); return; }'));
  assert.ok(app.includes('if (!autoNeustartRef.current()) setNewVersion(true);'));
  assert.ok(app.includes("const res = await fetch('/index.html?vc=' + Date.now(), { cache: 'no-store' });"));
  assert.ok(!/setInterval\(/.test(app), 'kein Intervall-Polling');
  // Hinweis in beiden Ansichten, ein gemeinsamer Baustein, Aussehen unverändert
  assert.equal((app.match(/\{newVersion && <NeueVersionHinweis \/>\}/g) || []).length, 2);
  assert.match(app, /<div className="min-h-screen bg-white pb-32">\n\s*\{\/\*[^\n]*\*\/\}\n\s*\{newVersion && <NeueVersionHinweis \/>\}/, 'Hinweis in der Mitarbeiter-Ansicht');
  assert.equal((app.match(/>Neue Version verfügbar</g) || []).length, 1, 'Hinweis-Text nur im gemeinsamen Baustein');
  assert.ok(app.includes('className="fixed top-0 left-0 right-0 z-[110] bg-[#0F6E56] text-white p-6 shadow-2xl flex flex-col items-center justify-center animate-in slide-in-from-top duration-500 w-full text-center cursor-pointer border-b-4 border-white/30"'));
});

test('src/version.ts speichert nur technische Werte (Bundle-Name, Reiter) und ruft nichts ab', () => {
  assert.ok(!/localStorage|indexedDB|fetch\(|XMLHttpRequest/.test(quelle));
  assert.deepEqual([...quelle.matchAll(/setItem\(([A-Z_]+|[a-z]+),/g)].map((m) => m[1]).sort(), ['NEUSTART_SCHLUESSEL', 'REITER_SCHLUESSEL']);
});
