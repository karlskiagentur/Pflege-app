// Wochendienstplan je Mitarbeiter als PDF - reine Logik ohne Netz, damit sie vollständig
// testbar ist (tests/dienstplan.test.mjs). Der Endpoint ist api/dienstplan-pdf.js.
//
// Vorgabe Pflegedienst (Karl, 25.10.2026):
// 1. Gedruckt wird im Büro je Mitarbeiter einzeln: nur der Wochenplan (Mo–So) von
//    Mitarbeiter A oder B.
// 2. Es zählen exakt die Daten zum Zeitpunkt des Klicks - auch die für den Rest der Woche
//    bereits geplanten Einsätze. Nichts wird gespeichert; jeder Klick erzeugt das PDF neu.
// 3. Das PDF fragt beim Öffnen nach dem Drucken (wo der PDF-Betrachter das unterstützt);
//    herunterladen und später drucken geht immer.
// 4. Enthalten ist nur, was der Mitarbeiter auch in seiner App sieht (gleiche Auswahl über
//    Pfleger_ID wie /api/ma-termine) - keine internen Notizen des Büros.

import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import { berlin, hm, termin, uhr } from './_zeitkonto.js';
import { pdfText } from './_pdftext.js';

// Felder der Tabelle Personal über ihre IDs (umbenennungsfest).
export const PERSONAL_FELDER = {
  NAME: 'fld8SZxbFR0l5CpWt',
  AKTIV: 'fldZMKSFJ73AkKtW6',
  SCHLUESSEL: 'fldMcUoE6e56w0NbE', // Dienstplan_Schlüssel (Druck-Link)
};

// Besuche-Felder, die der Dienstplan braucht (Datenminimierung: keine internen Notizen,
// keine Zeiterfassung, keine Kontaktdaten).
export const BESUCHE_FELDER = [
  'Datum', 'Uhrzeit', 'Von', 'Bis', 'Dauer_Soll', 'Status', 'Patient_Name', 'Tätigkeit',
  'Adresse_Klient', 'Hervorhebung', 'Pfleger_Ersatz_Name',
];

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const TAG_MS = 86400000;

const isoPlus = (iso, tage) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
};
export const datumDe = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const kurzDe = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/**
 * Kalenderwoche Mo–So (Europe/Berlin) zum Zeitpunkt `jetzt`, optional um `woche` Wochen
 * verschoben. KW nach ISO 8601: Die Woche gehört zu dem Jahr, in dem ihr Donnerstag liegt.
 */
export function wochenBereich(jetzt, woche = 0) {
  const heute = berlin(jetzt).datum;
  const wochentag = new Date(`${heute}T12:00:00Z`).getUTCDay(); // 0 = Sonntag
  const montag = isoPlus(heute, -((wochentag + 6) % 7) + 7 * (Number(woche) || 0));
  const tage = Array.from({ length: 7 }, (_, i) => isoPlus(montag, i));
  const donnerstag = new Date(`${tage[3]}T12:00:00Z`);
  const jahr = donnerstag.getUTCFullYear();
  const tagImJahr = Math.round((donnerstag.getTime() - Date.UTC(jahr, 0, 1, 12)) / TAG_MS); // 0-basiert
  return { montag, sonntag: tage[6], tage, kw: Math.floor(tagImJahr / 7) + 1, jahr };
}

// Erlaubter Abstand eines Datums (Parameter "datum") zu heute: ein gutes Jahr in beide Richtungen.
export const DATUM_MAX_TAGE = 400;

/**
 * true, wenn `iso` ein echtes Kalenderdatum YYYY-MM-DD ist (kein 30.02.) und höchstens
 * DATUM_MAX_TAGE Tage von `jetzt` entfernt liegt.
 */
export function datumGueltig(iso, jetzt = Date.now()) {
  const s = String(iso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T12:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return false;
  return Math.abs(t - new Date(jetzt).getTime()) <= DATUM_MAX_TAGE * TAG_MS;
}

/** Woche (Mo–So) zu einem Kalenderdatum YYYY-MM-DD. */
export function wocheZuDatum(iso) {
  return wochenBereich(Date.parse(`${iso}T12:00:00Z`), 0);
}

/**
 * Airtable-Formel: Einsätze des Mitarbeiters rund um die Woche (2 Tage Puffer je Seite; die
 * genaue Zuordnung zum Tag macht wochenplan() in Berliner Zeit). Auswahl über Pfleger_ID wie
 * in der Mitarbeiter-App; Einsätze ohne Datum zählen über ihre Uhrzeit.
 */
export function dienstplanFormel(maId, bereich) {
  const id = String(maId).replace(/'/g, "\\'");
  const ab = `DATETIME_PARSE('${isoPlus(bereich.montag, -2)}', 'YYYY-MM-DD')`;
  const bis = `DATETIME_PARSE('${isoPlus(bereich.sonntag, 2)}', 'YYYY-MM-DD')`;
  return `AND(FIND('${id}', ARRAYJOIN({Pfleger_ID})), `
    + `IF({Datum}, AND(IS_AFTER({Datum}, ${ab}), IS_BEFORE({Datum}, ${bis})), `
    + `IF({Uhrzeit}, AND(IS_AFTER({Uhrzeit}, ${ab}), IS_BEFORE({Uhrzeit}, ${bis})), 0)))`;
}

// Airtable liefert Lookup-/Select-Werte mal als Array, mal als Wert, mal als Objekt.
const wert = (v) => {
  if (Array.isArray(v)) return wert(v[0]);
  if (v && typeof v === 'object') return String(v.name || '');
  return v === undefined || v === null ? '' : String(v);
};
const alleWerte = (v) => (Array.isArray(v) ? v : [v])
  .map((x) => (x && typeof x === 'object' ? String(x.name || '') : String(x === undefined || x === null ? '' : x)))
  .map((s) => s.replace(/\s*\n\s*/g, ', ').trim())
  .filter(Boolean);

const zeitText = (t) => {
  const von = t.vonText || (t.start !== null ? uhr(t.start) : '');
  const bis = t.bisText || (t.planEnde !== null ? uhr(t.planEnde) : '');
  if (von && bis) return `${von} – ${bis}`;
  return von || 'ohne Uhrzeit';
};

/**
 * Ordnet die Einsätze den sieben Tagen der Woche zu (Berliner Datum), sortiert nach Beginn
 * und markiert Abgesagtes. Abgesagte Einsätze bleiben sichtbar (durchgestrichen), zählen
 * aber nicht.
 * @param {Array<{id?: string, fields: object}>} besuche  Airtable-Records
 * @param {{tage: string[]}} bereich  aus wochenBereich()
 */
export function wochenplan(besuche, bereich) {
  const tage = bereich.tage.map((datum, i) => ({
    datum, wochentag: WOCHENTAGE[i], eintraege: [], einsaetze: 0, planMin: 0,
  }));
  const proDatum = new Map(tage.map((t) => [t.datum, t]));
  for (const r of besuche || []) {
    const f = (r && r.fields) || {};
    const t = termin(f, (r && r.id) || '');
    const tag = t.datum ? proDatum.get(t.datum) : null;
    if (!tag) continue;
    const markierung = wert(f.Hervorhebung);
    const abgesagt = t.status === 'Abgesagt' || markierung === 'Storniert';
    const hinweise = [];
    if (abgesagt) {
      hinweise.push({ text: 'Abgesagt', art: 'abgesagt' });
    } else {
      if (markierung === 'Neu') hinweise.push({ text: 'Neu', art: 'neu' });
      if (markierung === 'Änderung') hinweise.push({ text: 'Geändert', art: 'aenderung' });
      if (markierung === 'Zusatz') hinweise.push({ text: 'Zusatz', art: 'zusatz' });
      if (t.status === 'Änderungswunsch') hinweise.push({ text: 'Änderungswunsch', art: 'wunsch' });
      if (t.status === 'Anfrage') hinweise.push({ text: 'Anfrage', art: 'anfrage' });
      const vertretung = alleWerte(f.Pfleger_Ersatz_Name).join(', ');
      if (vertretung) hinweise.push({ text: `Vertretung: ${vertretung}`, art: 'vertretung' });
    }
    tag.eintraege.push({
      id: t.id,
      start: t.start,
      ende: t.planEnde,
      zeit: zeitText(t),
      klient: t.klient || '–',
      adresse: alleWerte(f.Adresse_Klient).join(', '),
      taetigkeit: t.taetigkeit || 'Unterstützung',
      planMin: t.planMin,
      abgesagt,
      hinweise,
    });
  }

  const summen = { einsaetze: 0, planMin: 0, abgesagt: 0, ohneDauer: 0 };
  for (const tag of tage) {
    tag.eintraege.sort((a, b) =>
      (a.start === null) - (b.start === null) || (a.start || 0) - (b.start || 0)
      || (a.ende || 0) - (b.ende || 0) || String(a.id).localeCompare(String(b.id)));
    for (const e of tag.eintraege) {
      if (e.abgesagt) { summen.abgesagt++; continue; }
      tag.einsaetze++;
      tag.planMin += e.planMin || 0;
      if (e.planMin === null || e.planMin === undefined) summen.ohneDauer++;
    }
    summen.einsaetze += tag.einsaetze;
    summen.planMin += tag.planMin;
  }
  return { tage, summen };
}

/** Dateiname, z. B. "Dienstplan_KW44-2026_Denis_R.pdf" (nur ASCII). */
export function dateiname(maName, bereich) {
  const UMLAUT = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
  const name = pdfText(maName)
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUT[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'Mitarbeiter';
  return `Dienstplan_KW${String(bereich.kw).padStart(2, '0')}-${bereich.jahr}_${name}.pdf`;
}

// Druckdialog beim Öffnen (PDF-JavaScript; Chrome, Edge, Firefox, Acrobat). Betrachter ohne
// PDF-JavaScript (z. B. Safari, Vorschau) ignorieren es - Drucken dann über das Menü.
export const DRUCK_SKRIPT = 'this.print({bUI: true, bSilent: false, bShrinkToFit: true});';

export const LEGENDE = [
  'Neu, Geändert, Zusatz: Markierung des Büros im Dienstplan. Abgesagt: entfällt (durchgestrichen, nicht mitgezählt).',
  'Vertretung: Für diesen Einsatz ist eine Vertretung eingetragen. Änderungswunsch/Anfrage: Rückmeldung des Klienten ist noch offen.',
];

/**
 * Rendert den Wochendienstplan (A4 hoch). Rein, ohne Netz - auch für Tests und Vorschau.
 * @param {{maName: string, bereich: object, plan: {tage: object[], summen: object}, jetzt: number|Date, drucken?: boolean}} d
 */
export async function erstelleDienstplanPdf({ maName, bereich, plan, jetzt, drucken = true }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const kursiv = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const schwarz = rgb(0.16, 0.16, 0.16);
  const grau = rgb(0.42, 0.42, 0.42);
  const hellgrau = rgb(0.62, 0.62, 0.62);
  const linie = rgb(0.85, 0.85, 0.85);
  const band = rgb(0.95, 0.93, 0.89);
  const FARBE = {
    abgesagt: rgb(0.71, 0.28, 0.24),
    neu: rgb(0.11, 0.45, 0.27),
    aenderung: rgb(0.62, 0.42, 0.04),
    zusatz: rgb(0.76, 0.36, 0.05),
    wunsch: rgb(0.6, 0.24, 0.11),
    anfrage: rgb(0.52, 0.31, 0.04),
    vertretung: rgb(0.76, 0.25, 0.05),
  };

  const A4 = [595.28, 841.89];
  const M = 42;                // Rand links/rechts
  const OBEN = 48;             // Rand oben
  const UNTEN = 52;            // Rand unten (Platz für die Fußzeile)
  const SP = { zeit: M, klient: 120, taetigkeit: 330, hinweis: 470, rechts: A4[0] - M };
  const BREITE = {
    klient: SP.taetigkeit - SP.klient - 12,
    taetigkeit: SP.hinweis - SP.taetigkeit - 12,
    hinweis: SP.rechts - SP.hinweis,
  };

  const name = String(maName || 'Mitarbeiter');
  const kwText = `KW ${bereich.kw}/${bereich.jahr}`;
  const zeitraum = `Mo ${kurzDe(bereich.montag)} – So ${datumDe(bereich.sonntag)}`;
  const stand = berlin(jetzt);
  const standText = `${datumDe(stand.datum)}, ${uhr(stand.min)} Uhr`;

  // Titel statt Adresse im Browser-Tab (die Adresse enthält den Druck-Schlüssel).
  pdf.setTitle(`Dienstplan ${kwText} – ${name}`, { showInWindowTitleBar: true });
  pdf.setSubject('Wochendienstplan');
  pdf.setAuthor('Wunschlos Pflege');
  pdf.setCreator('Wunschlos Pflegeportal');
  pdf.setProducer('Wunschlos Pflegeportal');
  pdf.setLanguage('de-DE');
  pdf.setCreationDate(new Date(jetzt));
  pdf.setModificationDate(new Date(jetzt));

  let page;
  let y;
  const text = (s, x, yy, size, f, color) => page.drawText(pdfText(s), { x, y: yy, size, font: f, color });
  const rechts = (p, s, xR, yy, size, f, color) => {
    const t = pdfText(s);
    p.drawText(t, { x: xR - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color });
  };
  const gekuerzt = (s, f, size, max) => {
    let t = pdfText(s);
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };
  // Umbruch an Wortgrenzen (überlange Wörter werden hart getrennt), höchstens maxZeilen
  // Zeilen; was nicht passt, endet mit "…".
  const umbrechen = (s, f, size, max, maxZeilen) => {
    const zeilen = [];
    let akt = '';
    const passt = (x) => f.widthOfTextAtSize(x, size) <= max;
    for (const roh of pdfText(s).split(' ').filter(Boolean)) {
      let w = roh;
      while (!passt(w)) { // hart trennen
        let n = w.length - 1;
        while (n > 1 && !passt(w.slice(0, n))) n--;
        if (akt) { zeilen.push(akt); akt = ''; }
        zeilen.push(w.slice(0, n));
        w = w.slice(n);
      }
      const probe = akt ? `${akt} ${w}` : w;
      if (passt(probe)) akt = probe;
      else { zeilen.push(akt); akt = w; }
    }
    if (akt) zeilen.push(akt);
    if (zeilen.length > maxZeilen) {
      const rest = zeilen.slice(0, maxZeilen);
      rest[maxZeilen - 1] = gekuerzt(`${rest[maxZeilen - 1]}…`, f, size, max);
      return rest;
    }
    return zeilen;
  };

  // Seitenkopf: auf Seite 1 ausführlich, danach kompakt. Spaltenköpfe immer.
  const neueSeite = () => {
    const erste = pdf.getPageCount() === 0;
    page = pdf.addPage(A4);
    y = A4[1] - OBEN;
    if (erste) {
      text('Wunschlos Pflege – Wochendienstplan', M, y, 16, bold, schwarz);
      y -= 22;
      text(gekuerzt(name, bold, 13, 250), M, y, 13, bold, schwarz);
      rechts(page, `${kwText} · ${zeitraum}`, SP.rechts, y, 11, font, schwarz);
      y -= 15;
      text(`Stand ${standText} – enthält alle zu diesem Zeitpunkt geplanten Einsätze der Woche.`, M, y, 8.5, font, grau);
      y -= 22;
    } else {
      text(gekuerzt(`Wochendienstplan · ${name} · ${kwText} (Fortsetzung)`, bold, 10, SP.rechts - M), M, y, 10, bold, grau);
      y -= 20;
    }
    text('Zeit', SP.zeit, y, 8.5, bold, grau);
    text('Klient · Adresse', SP.klient, y, 8.5, bold, grau);
    text('Tätigkeit', SP.taetigkeit, y, 8.5, bold, grau);
    text('Hinweis', SP.hinweis, y, 8.5, bold, grau);
    y -= 5;
    page.drawLine({ start: { x: M, y }, end: { x: SP.rechts, y }, thickness: 0.8, color: grau });
    y -= 16;
  };

  const tagInfo = (tag) => {
    if (tag.einsaetze > 0) {
      const anzahl = `${tag.einsaetze} ${tag.einsaetze === 1 ? 'Einsatz' : 'Einsätze'}`;
      return tag.planMin > 0 ? `${anzahl} · geplant ${hm(tag.planMin)} Std.` : anzahl;
    }
    return tag.eintraege.length ? 'alle Einsätze abgesagt' : 'frei';
  };
  const tagKopf = (tag, fortsetzung) => {
    page.drawRectangle({ x: M, y: y - 5, width: SP.rechts - M, height: 18, color: band });
    text(`${tag.wochentag}, ${datumDe(tag.datum)}${fortsetzung ? ' (Fortsetzung)' : ''}`, M + 6, y, 10.5, bold, schwarz);
    rechts(page, tagInfo(tag), SP.rechts - 6, y, 9, font, grau);
    y -= 22;
  };

  neueSeite();
  for (const tag of plan.tage) {
    if (y - 40 < UNTEN) neueSeite(); // Tageskopf nie allein am Seitenende
    tagKopf(tag, false);
    if (!tag.eintraege.length) {
      text('Keine Einsätze geplant.', SP.klient, y, 9, kursiv, hellgrau);
      y -= 18;
      continue;
    }
    for (const e of tag.eintraege) {
      const adresse = e.adresse ? umbrechen(e.adresse, font, 8.5, BREITE.klient, 2) : [];
      const taetigkeit = umbrechen(e.taetigkeit, font, 9.5, BREITE.taetigkeit, 3);
      const hinweise = e.hinweise.flatMap((h) => umbrechen(h.text, bold, 7.5, BREITE.hinweis, 2)
        .map((z) => ({ z, farbe: FARBE[h.art] || grau })));
      const hoehe = Math.max(12 + adresse.length * 10.5, taetigkeit.length * 11.5, hinweise.length * 9.5) + 7;
      if (y - hoehe < UNTEN) { neueSeite(); tagKopf(tag, true); }

      const farbe = e.abgesagt ? hellgrau : schwarz;
      const zeit = gekuerzt(e.zeit, bold, 10, SP.klient - SP.zeit - 6);
      const klient = gekuerzt(e.klient, bold, 10, BREITE.klient);
      page.drawText(zeit, { x: SP.zeit, y, size: 10, font: bold, color: farbe });
      page.drawText(klient, { x: SP.klient, y, size: 10, font: bold, color: farbe });
      adresse.forEach((z, i) => page.drawText(z, { x: SP.klient, y: y - 11 - i * 10.5, size: 8.5, font, color: e.abgesagt ? hellgrau : grau }));
      taetigkeit.forEach((z, i) => page.drawText(z, { x: SP.taetigkeit, y: y - i * 11.5, size: 9.5, font, color: farbe }));
      hinweise.forEach((h, i) => page.drawText(h.z, { x: SP.hinweis, y: y - i * 9.5, size: 7.5, font: bold, color: h.farbe }));
      if (e.abgesagt) {
        const durch = (x, s, f) => page.drawLine({
          start: { x, y: y + 3.4 }, end: { x: x + f.widthOfTextAtSize(s, 10), y: y + 3.4 }, thickness: 0.8, color: hellgrau,
        });
        durch(SP.zeit, zeit, bold);
        durch(SP.klient, klient, bold);
      }
      y -= hoehe;
      page.drawLine({ start: { x: M, y: y + 5 }, end: { x: SP.rechts, y: y + 5 }, thickness: 0.4, color: linie });
      y -= 4;
    }
    y -= 6;
  }

  // Wochensumme + Legende
  const s = plan.summen;
  const notizen = [];
  if (s.ohneDauer > 0) notizen.push(`${s.ohneDauer} ${s.ohneDauer === 1 ? 'Einsatz' : 'Einsätze'} ohne geplante Dauer – in der Zeit nicht enthalten.`);
  notizen.push(`Stand ${standText}. Spätere Änderungen im Dienstplan sind nicht enthalten – aktuell ist immer die App.`);
  const legende = LEGENDE.flatMap((t) => umbrechen(t, font, 7.5, SP.rechts - M, 3));
  if (y - (40 + (notizen.length + legende.length) * 10) < UNTEN) neueSeite();
  y -= 2;
  page.drawLine({ start: { x: M, y }, end: { x: SP.rechts, y }, thickness: 0.8, color: grau });
  y -= 16;
  text(`Woche gesamt: ${s.einsaetze} ${s.einsaetze === 1 ? 'Einsatz' : 'Einsätze'} · geplante Zeit ${hm(s.planMin)} Std.`, M, y, 10.5, bold, schwarz);
  y -= 14;
  for (const n of notizen) { text(n, M, y, 8, font, grau); y -= 10; }
  y -= 2;
  for (const z of legende) { page.drawText(z, { x: M, y, size: 7.5, font, color: hellgrau }); y -= 9.5; }

  // Fußzeile auf jeder Seite (erst jetzt ist die Seitenzahl bekannt)
  const seiten = pdf.getPages();
  seiten.forEach((p, i) => {
    p.drawText(pdfText('Vertraulich: enthält Daten von Klienten – nicht weitergeben, nach Gebrauch datenschutzgerecht vernichten.'),
      { x: M, y: 26, size: 7, font, color: hellgrau });
    rechts(p, `Seite ${i + 1} von ${seiten.length}`, SP.rechts, 26, 7, font, hellgrau);
  });

  if (drucken) {
    const aktion = pdf.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of(DRUCK_SKRIPT) });
    pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.register(aktion));
  }
  return pdf.save();
}
