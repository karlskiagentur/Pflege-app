// PDF-Vorschau in der App (src/vorschau.ts, src/PdfVorschau.tsx): Maßstab, Fehlertexte, und dass
// die Lohnabrechnung nicht mehr per window.open (ohne Weg zurück) geöffnet wird.
// Die TypeScript-Datei wird mit dem TypeScript-Compiler übersetzt. Aufruf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const quelle = readFileSync(new URL('../src/vorschau.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(quelle, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const V = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('Seite füllt die Breite, gezeichnet wird feiner (Gerätepixel × 1,5)', () => {
  const m = V.seitenMass(595, 842, 358, 3); // A4 auf einem iPhone (390 px, Rand abgezogen)
  assert.equal(m.breiteCss, 358);
  assert.equal(m.hoeheCss, Math.round(842 * (358 / 595)));
  assert.ok(Math.abs(m.pixel - (358 / 595) * 4.5) < 1e-9);
  assert.ok(595 * m.pixel * 842 * m.pixel <= V.MAX_PIXEL);
});

test('Große Bildschirme: nie mehr als MAX_PIXEL Bildpunkte je Seite (iPhone-Speichergrenze)', () => {
  for (const [b, dpr] of [[1200, 3], [2400, 2], [5000, 1]]) {
    const m = V.seitenMass(595, 842, b, dpr);
    const flaeche = 595 * m.pixel * 842 * m.pixel;
    assert.ok(flaeche <= V.MAX_PIXEL * 1.0001, `Breite ${b}: ${Math.round(flaeche)}`);
    assert.ok(flaeche >= V.MAX_PIXEL * 0.99, `Breite ${b}: Grenze ausgeschöpft`);
    assert.equal(m.breiteCss, b);
  }
});

test('Unbrauchbare Angaben: A4 und Gerätepixel 1 als Rückfall, nie NaN', () => {
  const m = V.seitenMass(0, -5, 0, Number.NaN);
  assert.ok(Number.isFinite(m.pixel) && m.pixel > 0);
  assert.equal(m.breiteCss, 1);
  const n = V.seitenMass(595, 842, 300, 9); // Gerätepixel über 3 werden gedeckelt
  assert.ok(Math.abs(n.pixel - (300 / 595) * 4.5) < 1e-9);
});

test('Fehlertexte: verständlich, ohne Technik', () => {
  assert.match(V.vorschauFehlerText(410), /nicht mehr verfügbar/);
  assert.match(V.vorschauFehlerText(404), /nicht gefunden/);
  assert.match(V.vorschauFehlerText(401), /neu anmelden|erneut anmelden/);
  assert.match(V.vorschauFehlerText(0), /Keine Verbindung/);
  assert.match(V.vorschauFehlerText(undefined), /herunterladen/i);
  assert.match(V.vorschauFehlerText(502), /herunterladen/i);
  for (const s of [0, 401, 403, 404, 410, 500, undefined]) assert.ok(!/\d{3}|undefined|Error/.test(V.vorschauFehlerText(s)), String(s));
});

test('Gemeldet (Alarm) werden nur echte Fehler', () => {
  assert.equal(V.vorschauFehlerMelden(undefined), true); // Datei nicht anzeigbar
  assert.equal(V.vorschauFehlerMelden(500), true);
  assert.equal(V.vorschauFehlerMelden(502), true);
  assert.equal(V.vorschauFehlerMelden(400), true);
  for (const s of [0, 401, 403, 404, 410]) assert.equal(V.vorschauFehlerMelden(s), false, String(s));
});

test('Mitarbeiter-App: Vorschau der Lohnabrechnung in der App mit Zurück, nicht per window.open', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const vorschau = readFileSync(new URL('../src/PdfVorschau.tsx', import.meta.url), 'utf8');
  assert.ok(!app.includes('window.open(selectedLohn.lohnId'), 'alter Aufruf per window.open');
  assert.ok(app.includes('oeffneLohnVorschau(selectedLohn)'));
  assert.ok(/<PdfVorschau[\s\S]*?onZurueck=\{schliesseLohnVorschau\}/.test(app));
  assert.ok(app.includes("addEventListener('popstate'"), 'Zurück-Geste schließt die Vorschau');
  assert.ok(app.includes('v.vorschauNr === nr'), 'Rückfall-Timer schließt nie eine neu geöffnete Vorschau');
  assert.equal((vorschau.match(/<ArrowLeft size=\{22\}\/> Zurück/g) || []).length, 1, 'Zurück-Knopf oben in der Leiste');
  assert.equal((vorschau.match(/<ArrowLeft size=\{18\}\/> Zurück/g) || []).length, 1, 'Zurück-Knopf auch im Fehlerhinweis');
  // PDF.js: Legacy-Ausgabe (läuft auch auf älteren iPhones), erst beim Öffnen nachgeladen
  assert.equal((vorschau.match(/import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/g) || []).length, 2);
  assert.ok(vorschau.includes("import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')"));
  assert.ok(!/pdfjs-dist\/build\//.test(vorschau) && !/from 'pdfjs-dist/.test(vorschau), 'kein statischer/moderner Import');
  assert.ok(!/reportClientError\([^)]*url/.test(vorschau), 'Adresse mit Anmeldung wird nie gemeldet');
});
