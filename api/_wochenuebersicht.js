// Wochendienstplan ALLER Mitarbeiter als PDF (A4 quer) – Aufbau wie die bisherige Word-Tabelle
// des Büros: Zeilen = Tage (Mo–Fr, Sa/So), Spalten = Mitarbeiter (4 je Seite), je Einsatz
// "Klient Von–Bis" und rechts die Stunden. Reine Logik ohne Netz (testbar).
//
// Stunden = BESTÄTIGTE Ist-Zeit. Nicht bestätigte Einsätze stehen als "offen" da und zählen
// nicht; abgesagte sind durchgestrichen; Urlaub/Gleitzeit/Krank/Abwesend laut Dienstplan.
// Abwesenheit steht als eigener Eintrag über den Einsätzen des Tages – aus einer eigenen Zeile ohne
// Klient oder, wenn das Büro die Einsätze einer Kranken absagt und dort „Krank“ wählt, aus diesen
// abgesagten Einsätzen (ein Eintrag je Tag und Art; Regel 7 in api/_zeitkonto.js, Meldung
// Geschäftsleitung 25.11.2026). Eine wieder ABGESAGTE Abwesenheitszeile (z. B. abgelehnter Urlaub)
// steht nicht auf dem Blatt.
// „Abrechnen ohne Lohn“ (Spalte im Dienstplan, Wunsch Geschäftsleitung 23.11.2026): Der Einsatz
// gilt als geklärt – er steht mit der GEPLANTEN Zeit und einem * da (wird abgerechnet), zählt aber
// nicht zur Summe der Mitarbeiterin (keine Arbeitszeit) und nicht als "offen".
// Das Büro überträgt von diesem Blatt die Stunden der Klienten in die Abrechnung (Hinweis
// Geschäftsleitung 24.11.2026). Deshalb gilt das * auch für einen ABGESAGTEN Einsatz mit Haken
// (z. B. kurzfristige Absage, die berechnet wird): Klient und Zeit bleiben durchgestrichen (für die
// Mitarbeiterin fällt er aus), die Zahl mit * bleibt lesbar, und unter der Summe der Mitarbeiterin
// steht „* abrechnen ohne Lohn: … Std.“. Ein abgesagter Einsatz OHNE Haken bleibt, wie er war.
// Abweichende Ist-Zeit (Wunsch Geschäftsleitung 25.11.2026): Hat die Mitarbeiterin eine andere Zeit
// bestätigt als geplant (z. B. 2 Std. bei 14.45–16.00), steht die Zahl FETT da – wie auf dem
// Stundenzettel („fett = weicht von der Planung ab“). So wundert sich niemand, dass Zahl und
// Zeitfenster nicht zusammenpassen. Die Legende nennt es nur auf Seiten, auf denen es vorkommt.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pdfText, druckbreite } from './_pdftext.js';
import { LOGO_B64, LOGO_BREITE, LOGO_HOEHE } from './_logo.js';
import { termin, vorbei, abwesenheitsGrund, abwesenheitsEintraege, berlin } from './_zeitkonto.js';

const A4_QUER = [841.89, 595.28];
const M = 26;
const SPALTEN_JE_SEITE = 4;
const TAG_SPALTE = 78;

const F = {
  // Markenfarbe Wunschlos Pflege: Sand #dccfbc (wie Kopfzeile der App und Briefkopf)
  marke: rgb(220 / 255, 207 / 255, 188 / 255),
  linie: rgb(0.25, 0.25, 0.25),
  schwarz: rgb(0.12, 0.12, 0.12),
  blau: rgb(0.11, 0.42, 0.68),
  rot: rgb(0.78, 0.16, 0.12),
  orange: rgb(0.78, 0.4, 0.05),
  violett: rgb(0.42, 0.25, 0.63), // „Abrechnen ohne Lohn“
  grau: rgb(0.5, 0.5, 0.5),
  gelb: rgb(1, 0.92, 0.2),
  weiss: rgb(1, 1, 1),
};

const TAGE_KURZ = ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'];
const kurzDe = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const datumDe = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** 90 -> "1,5" · 75 -> "1,25" · 120 -> "2" (Dezimalstunden wie in der Word-Tabelle). */
export function stundenDe(min) {
  const s = (Math.round((min / 60) * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}
/** "08:30" -> "8.30" */
const uhrKurz = (hhmm) => (hhmm ? `${Number(hhmm.slice(0, 2))}.${hhmm.slice(3, 5)}` : '');
/** Minuten ab Mitternacht -> "08:30" */
const uhrAus = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Fußzeile. Der Zusatz zu „Abrechnen ohne Lohn“ steht nur auf Seiten, auf denen ein so markierter
// Einsatz vorkommt – alle anderen Blätter bleiben, wie sie waren.
export const LEGENDE = 'Zahl rechts = bestätigte Ist-Zeit in Stunden  ·  offen = nicht bestätigt, zählt nicht  ·  durchgestrichen = abgesagt  ·  gelb = Zusatz/Änderung des Büros';
export const LEGENDE_OHNE_LOHN = '  ·  * = Abrechnen ohne Lohn: geplante Zeit abrechnen, zählt nicht';
// Zusatz zur abweichenden Ist-Zeit – ebenfalls nur auf Seiten, auf denen sie vorkommt.
export const LEGENDE_ABWEICHUNG = '  ·  fett = Ist-Zeit weicht vom Plan ab';
const LEGENDE_TRENNER = '  ·  ';

/**
 * Zeilen der Legende einer Seite. Passt alles in eine Zeile, bleibt es bei einer (wie bisher); kommen
 * abweichende Ist-Zeit UND „Abrechnen ohne Lohn“ auf derselben Seite vor, steht der Zusatz zum * in
 * einer zweiten Zeile.
 * @param {{abweichung: boolean, ohneLohn: boolean}} inhalt  was auf der Seite vorkommt
 * @param {(text: string) => number} breiteVon  gedruckte Breite eines Textes
 * @param {number} platz  verfügbare Breite
 * @returns {string[]}
 */
export function legendeZeilen(inhalt, breiteVon, platz) {
  const erste = LEGENDE + (inhalt && inhalt.abweichung ? LEGENDE_ABWEICHUNG : '');
  if (!inhalt || !inhalt.ohneLohn) return [erste];
  const zusammen = erste + LEGENDE_OHNE_LOHN;
  if (breiteVon(zusammen) <= platz) return [zusammen];
  return [erste, LEGENDE_OHNE_LOHN.slice(LEGENDE_TRENNER.length)];
}
/** Kennzeichen hinter der geplanten Zeit eines Einsatzes mit „Abrechnen ohne Lohn“. */
export const OHNE_LOHN_ZEICHEN = '*';

/**
 * Trägt der Einsatz „Abrechnen ohne Lohn“? Gilt für den geklärten Einsatz (status 'ohneLohn') und für
 * den ABGESAGTEN Einsatz mit Haken (status bleibt 'abgesagt', zusätzlich ohneLohn: true) – beide
 * werden dem Klienten berechnet und sind keine Arbeitszeit.
 */
export const istOhneLohn = (e) => !!e && e.art === 'einsatz' && (e.status === 'ohneLohn' || e.ohneLohn === true);

/** Steht auf dieser Seite (Gruppe von Mitarbeitern) ein Einsatz mit „Abrechnen ohne Lohn“? */
export function hatOhneLohn(gruppe) {
  return (gruppe || []).some((ma) => Object.values((ma && ma.tage) || {})
    .some((liste) => liste.some(istOhneLohn)));
}

/** Text rechts neben einem Einsatz mit „Abrechnen ohne Lohn“: geplante Stunden + *, z. B. „1,25*“. */
export const ohneLohnAnzeige = (e) => `${e && e.planMin ? stundenDe(e.planMin) : ''}${OHNE_LOHN_ZEICHEN}`;

/** Nur abzurechnende Zeit je Mitarbeiter: geplante Minuten aller Einsätze mit „Abrechnen ohne Lohn“. */
export function summeOhneLohn(ma) {
  let min = 0;
  let anzahl = 0;
  for (const liste of Object.values((ma && ma.tage) || {})) {
    for (const e of liste) {
      if (!istOhneLohn(e)) continue;
      min += e.planMin || 0;
      anzahl++;
    }
  }
  return { min, anzahl };
}

/** Zweite Zeile in der Summe der Mitarbeiterin ('' ohne solche Einsätze), z. B. „* abrechnen ohne Lohn: 1,25 Std.“ */
export function ohneLohnSummenText(ma) {
  const s = summeOhneLohn(ma);
  return s.anzahl ? `${OHNE_LOHN_ZEICHEN} abrechnen ohne Lohn: ${stundenDe(s.min)} Std.` : '';
}

/**
 * Hat die Mitarbeiterin eine andere Zeit bestätigt als geplant? Gleiche Regel wie auf dem
 * Stundenzettel (dort ist die Ist-Zeit dann fett): bestätigter Einsatz, geplante Dauer bekannt, Ist
 * (im 15-Minuten-Takt) ungleich Plan. Auch eine bewusst bestätigte 0 ist eine Abweichung.
 */
export const istAbweichend = (e) => !!e && e.art === 'einsatz' && e.status === 'bestaetigt'
  && typeof e.istMin === 'number' && typeof e.planMin === 'number' && e.istMin !== e.planMin;

/** Steht auf dieser Seite (Gruppe von Mitarbeitern) ein Einsatz mit abweichender Ist-Zeit? */
export function hatAbweichung(gruppe) {
  return (gruppe || []).some((ma) => Object.values((ma && ma.tage) || {})
    .some((liste) => liste.some(istAbweichend)));
}

/**
 * Darstellung eines Einsatzes (rein – testbar): Farbe, Text rechts, Schrift der Zahl, Durchstreichung.
 * strich: 'ganz' = abgesagt wie bisher (Zeile samt Zahl) · 'text' = abgesagt + „Abrechnen ohne Lohn“
 * (nur Klient und Zeit – die Zahl mit * bleibt lesbar, sie wird abgerechnet) · '' = keine.
 */
export function eintragStil(e) {
  const abgesagt = e.status === 'abgesagt';
  const offen = e.status === 'offen';
  const ohneLohn = istOhneLohn(e);
  return {
    farbe: ohneLohn ? 'violett' : abgesagt ? 'grau' : offen ? 'orange' : 'blau',
    rechts: ohneLohn ? ohneLohnAnzeige(e)
      : abgesagt ? (e.planMin ? stundenDe(e.planMin) : '') : offen ? 'offen' : stundenDe(e.istMin || 0),
    // fett: Zahl mit * („Abrechnen ohne Lohn“) oder bestätigte Zeit, die vom Plan abweicht
    fett: ohneLohn || istAbweichend(e),
    strich: abgesagt ? (ohneLohn ? 'text' : 'ganz') : '',
  };
}

/** Summen je Mitarbeiter: bestätigte Minuten, Zahl offener Einsätze. */
export function summen(ma) {
  let min = 0;
  let offen = 0;
  for (const liste of Object.values(ma.tage || {})) {
    for (const e of liste) {
      if (e.art !== 'einsatz' || e.status === 'abgesagt') continue;
      if (e.status === 'ohneLohn') continue;        // geklärt, aber keine Arbeitszeit
      if (e.status === 'bestaetigt') min += e.istMin || 0;
      else offen++;
    }
  }
  return { min, offen };
}

// --- Airtable-Records -> Eingabeformat des Renderers --------------------------------------
// Die Fachregeln kommen aus api/_zeitkonto.js (termin, vorbei, Bestätigungsregel) – hier wird
// nichts nachgebaut, nur zugeordnet und benannt.

const feldText = (v) => {
  if (Array.isArray(v)) return feldText(v[0]);
  if (v && typeof v === 'object') return String(v.name || '');
  return v === undefined || v === null ? '' : String(v);
};

// Hervorhebung des Büros: Neu/Geändert/Zusatz = markiert (gelb), Storniert = abgesagt.
const MARKIERT = ['Neu', 'Geändert', 'Zusatz'];

// Mitarbeiter stehen auf dem Blatt mit vollem Namen: Personal.„Name_Vollständig“
// (fldC1jpCqrxqoUn1M, pflegt das Büro im Reiter Mitarbeiter). Die Apps kennen nur Personal.Name
// („Vorname N.“) – Personal-Datensätze gehen nie vollständig an ein Gerät.
export const MA_NAME_VOLLSTAENDIG_FELD = 'Name_Vollständig';

/** Spaltenkopf: voller Name, wenn eingetragen, sonst die Kurzform aus Personal.Name. */
export function mitarbeiterName(fields) {
  const f = fields || {};
  return feldText(f[MA_NAME_VOLLSTAENDIG_FELD]).trim() || feldText(f.Name).trim();
}

/** Klientenname fürs Blatt: so, wie er im Dienstplan steht (Patient_Name). */
export function klientName(fields) {
  return feldText((fields || {}).Patient_Name).trim();
}

/**
 * Baut die Eingabe für erstelleWochenuebersichtPdf aus Airtable-Records.
 * Spalten = aktive Mitarbeiter mit mindestens einer Zeile in der Woche, nach Name sortiert.
 * @param {Array<{id?: string, fields: object}>} besuche   Besuche der Woche (alle Mitarbeiter)
 * @param {Array<{id: string, fields: object}>} personal   Personal-Records
 * @param {{tage: string[], kw: number, jahr: number}} bereich  aus wochenBereich()/wocheZuDatum()
 * @param {Date|string|number} jetzt
 */
export function baueWoche(besuche, personal, bereich, jetzt = Date.now()) {
  const nun = berlin(jetzt);
  const inWoche = new Set(bereich.tage);

  // Aktive Mitarbeiter -> Spalte (noch ohne Einträge)
  const spalten = new Map();
  for (const p of personal || []) {
    const f = (p && p.fields) || {};
    if (!f.Aktiv) continue;                       // nur aktive (Regel 6)
    spalten.set(String(p.id), { id: String(p.id), name: mitarbeiterName(f), tage: {} });
  }

  // Abgesagte Einsätze mit „Krank“ o. ä. je Mitarbeiter (Regel 7) – daraus entsteht unten je Tag und
  // Art ein Abwesenheitseintrag; eigene Abwesenheitszeilen des Mitarbeiters gehen dabei vor.
  const ausfaelle = new Map(); // Mitarbeiter-ID -> { eigene: [termin], ausfall: [termin] }
  const merke = (id, art, t) => {
    if (!ausfaelle.has(id)) ausfaelle.set(id, { eigene: [], ausfall: [] });
    ausfaelle.get(id)[art].push(t);
  };

  for (const r of besuche || []) {
    const f = (r && r.fields) || {};
    const t = termin(f, (r && r.id) || '');
    if (!t.datum || !inWoche.has(t.datum)) continue;
    // Wieder abgesagte Abwesenheit (z. B. abgelehnter Urlaub): steht nicht auf dem Blatt – wie auf
    // dem Stundenzettel. (Vorher stand sie weiter als „Urlaub“ da.)
    if (t.abwesenheit && t.status === 'Abgesagt') continue;

    // Zuordnung wie im Dienstplan/ma-termine: über Pfleger_ID (enthält auch die Vertretung,
    // wenn das Büro sie dort einträgt) – gleiche Regel wie beim Stundenzettel.
    const ids = (Array.isArray(f.Pfleger_ID) ? f.Pfleger_ID : [f.Pfleger_ID])
      .map((x) => (x && typeof x === 'object' ? x.id : x))
      .map((x) => String(x || ''))
      .filter(Boolean);

    const hervorhebung = feldText(f.Hervorhebung).trim();
    const eintrag = t.abwesenheit
      ? {
          art: 'abwesenheit',
          grund: t.abwesenheit,
          notiz: abwesenheitsGrund(t.abwesenheit, t.taetigkeit),
          // eingetragene Stunden (Urlaub, Gleitzeit, Krank – api/_abrechnung.js), sonst null
          stundenMin: t.stundenMin,
        }
      : {
          art: 'einsatz',
          klient: klientName(f),
          von: t.vonText || (t.start !== null ? uhrAus(t.start) : ''),
          bis: t.bisText || (t.planEnde !== null ? uhrAus(t.planEnde) : ''),
          istMin: t.istMin,
          planMin: t.planMin,
          // Bestätigungsregel 1:1 wie im Stundenzettel (api/_zeitkonto.js):
          // abgesagt > „Abrechnen ohne Lohn“ (geklärt, auch mit eingetragener Ist-Zeit keine
          // Arbeitszeit) > Ist-Zeit da = bestätigt > vorbei ohne Ist = offen > geplant
          // Abgesagt + Haken: Status bleibt „abgesagt“ (für die Mitarbeiterin fällt er aus);
          // dass er trotzdem abgerechnet wird, trägt das Feld ohneLohn weiter unten.
          status: t.status === 'Abgesagt' || hervorhebung === 'Storniert'
            ? 'abgesagt'
            : t.ohneLohn
              ? 'ohneLohn'
              : t.istMin !== null
                ? 'bestaetigt'
                : vorbei(t, nun) ? 'offen' : 'geplant',
          markiert: MARKIERT.includes(hervorhebung),
          // „Abrechnen ohne Lohn“ – auch am abgesagten Einsatz. Nur gesetzt, wenn angekreuzt
          // (alle übrigen Einträge behalten ihren Aufbau).
          ...(t.ohneLohn ? { ohneLohn: true } : {}),
        };

    for (const id of ids) {
      const sp = spalten.get(id);
      if (!sp) continue;                           // inaktiv oder unbekannt -> keine Spalte
      (sp.tage[t.datum] = sp.tage[t.datum] || []).push(eintrag);
      if (t.abwesenheit) merke(id, 'eigene', t);
      else if (t.ausfall) merke(id, 'ausfall', t);
    }
  }

  // Regel 7: Abwesenheitstag aus abgesagten Einsätzen – dieselbe Regel wie auf dem Stundenzettel
  // (ein Eintrag je Tag und Art; gibt es schon eine eigene Zeile derselben Art, gilt nur diese).
  for (const [id, { eigene, ausfall }] of ausfaelle) {
    if (!ausfall.length) continue;
    const sp = spalten.get(id);
    for (const a of abwesenheitsEintraege(eigene, ausfall)) {
      if (!a.einsaetze) continue;                  // eigene Zeilen stehen schon da
      sp.tage[a.datum].push({ art: 'abwesenheit', grund: a.art, notiz: '', stundenMin: a.min });
    }
  }

  // Innerhalb eines Tages: Abwesenheit zuerst, dann nach Beginn
  for (const sp of spalten.values()) {
    for (const liste of Object.values(sp.tage)) {
      liste.sort((a, b) =>
        (a.art === 'abwesenheit' ? 0 : 1) - (b.art === 'abwesenheit' ? 0 : 1) ||
        String(a.von || '').localeCompare(String(b.von || '')));
    }
  }

  const mitarbeiter = [...spalten.values()]
    .filter((sp) => Object.keys(sp.tage).length > 0)   // nur wer eine Zeile in der Woche hat
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return { kw: bereich.kw, jahr: bereich.jahr, tage: bereich.tage, mitarbeiter };
}

/**
 * @param {{kw:number, jahr:number, tage:string[], stand:string, mitarbeiter:Array}} d
 *   tage = 7 ISO-Daten Mo–So · mitarbeiter[].tage = { iso: [eintrag] }
 *   eintrag: { art:'einsatz', klient, von, bis, istMin, planMin,
 *              status:'bestaetigt'|'offen'|'geplant'|'abgesagt'|'ohneLohn', markiert,
 *              ohneLohn?: true (mit Haken „Abrechnen ohne Lohn“ – auch bei status 'abgesagt') }
 *          | { art:'abwesenheit', grund:'Krank'|'Urlaub'|'Gleitzeit'|'Abwesend', stundenMin }
 */
export async function erstelleWochenuebersichtPdf({ kw, jahr, tage, stand, mitarbeiter }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Logo klein unten rechts. Lässt es sich nicht einbetten, entsteht das Blatt ohne Logo.
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO_B64, 'base64')); } catch (_) { logo = null; }

  // Zeilen: Mo–Fr einzeln, Sa/So zusammen (wie in der Word-Tabelle)
  const zeilen = [0, 1, 2, 3, 4].map((i) => ({ kopf: [TAGE_KURZ[i], kurzDe(tage[i])], isos: [tage[i]] }));
  zeilen.push({ kopf: ['SA/SO', `${tage[5].slice(8, 10)}./${kurzDe(tage[6])}`], isos: [tage[5], tage[6]] });

  const seiten = [];
  for (let i = 0; i < mitarbeiter.length; i += SPALTEN_JE_SEITE) seiten.push(mitarbeiter.slice(i, i + SPALTEN_JE_SEITE));
  if (!seiten.length) seiten.push([]);

  const eintraege = (ma, zeile) => zeile.isos.flatMap((iso, n) => (ma.tage[iso] || []).map((e) => ({
    ...e, praefix: zeile.isos.length > 1 ? (n === 0 ? 'Sa ' : 'So ') : '',
  })));

  seiten.forEach((gruppe, s) => {
    const page = pdf.addPage(A4_QUER);
    const [W, H] = A4_QUER;
    const colW = (W - 2 * M - TAG_SPALTE) / SPALTEN_JE_SEITE;

    // Kopfzeile über der Tabelle
    let y = H - M - 12;
    page.drawText(pdfText(`Wochendienstplan KW ${kw} / ${jahr}`), { x: M, y, size: 14, font: bold, color: F.schwarz });
    const rechts = pdfText(`${datumDe(tage[0])} – ${datumDe(tage[6])}   ·   Stand ${stand}   ·   Seite ${s + 1} von ${seiten.length}`);
    page.drawText(rechts, { x: W - M - font.widthOfTextAtSize(rechts, 9), y: y + 1, size: 9, font, color: F.grau });
    y -= 10;

    // Zeilenhöhen (dynamisch) – bei sehr vollen Wochen wird die Schrift verkleinert
    const KOPF_H = 30;
    // Zweite Zeile in der Summe („* abrechnen ohne Lohn: … Std.“) nur auf Seiten mit so markierten
    // Einsätzen – alle anderen Blätter behalten ihre Maße.
    const mitOhneLohn = hatOhneLohn(gruppe);
    const SUMME_H = mitOhneLohn ? 34 : 22;
    // Legende: in der Regel eine Zeile; eine zweite nur, wenn abweichende Ist-Zeit UND * vorkommen.
    const logoBreite = logo ? 16 * (LOGO_BREITE / LOGO_HOEHE) : 0;
    const legende = legendeZeilen(
      { abweichung: hatAbweichung(gruppe), ohneLohn: mitOhneLohn },
      (t) => druckbreite(pdfText(t), font, 7.5),
      W - 2 * M - logoBreite - 6,
    );
    const FUSS_H = 30 + 11 * (legende.length - 1);
    const verfuegbar = y - M - FUSS_H - KOPF_H - SUMME_H;
    const anzahl = zeilen.map((z) => Math.max(1, ...gruppe.map((ma) => eintraege(ma, z).length)));
    let size = 8.5;
    let lineH = 12;
    const hoehen = () => anzahl.map((n) => Math.max(34, n * lineH + 12));
    while (hoehen().reduce((a, b) => a + b, 0) > verfuegbar && size > 6) { size -= 0.25; lineH -= 0.4; }
    const rowH = hoehen();
    const rest = verfuegbar - rowH.reduce((a, b) => a + b, 0);
    if (rest > 0) rowH.forEach((_, i) => { rowH[i] += rest / rowH.length; }); // Blatt ausfüllen

    const x0 = M;
    const xSp = (i) => x0 + TAG_SPALTE + i * colW;
    const top = y;

    // Kopfzeile der Tabelle (grün): KW + Namen
    page.drawRectangle({ x: x0, y: top - KOPF_H, width: W - 2 * M, height: KOPF_H, color: F.marke });
    page.drawText(pdfText(`KW ${kw}`), { x: x0 + 8, y: top - 19, size: 12, font: bold, color: F.schwarz });
    gruppe.forEach((ma, i) => {
      page.drawText(kuerzen(ma.name, bold, 10.5, colW - 12), { x: xSp(i) + 6, y: top - 19, size: 10.5, font: bold, color: F.schwarz });
    });

    // Tageszeilen
    let yr = top - KOPF_H;
    zeilen.forEach((z, r) => {
      const h = rowH[r];
      page.drawRectangle({ x: x0, y: yr - h, width: TAG_SPALTE, height: h, color: F.marke });
      page.drawText(pdfText(z.kopf[0]), { x: x0 + 8, y: yr - 17, size: 11, font: bold, color: F.schwarz });
      page.drawText(pdfText(z.kopf[1]), { x: x0 + 8, y: yr - 31, size: 10, font, color: F.schwarz });
      gruppe.forEach((ma, i) => {
        let ye = yr - 6 - size;
        for (const e of eintraege(ma, z)) {
          zeichneEintrag(page, e, xSp(i) + 6, ye, colW - 12, size, lineH, font, bold);
          ye -= lineH;
        }
      });
      yr -= h;
    });

    // Summenzeile
    page.drawRectangle({ x: x0, y: yr - SUMME_H, width: TAG_SPALTE, height: SUMME_H, color: F.marke });
    page.drawText(pdfText('Summe'), { x: x0 + 8, y: yr - 15, size: 10, font: bold, color: F.schwarz });
    gruppe.forEach((ma, i) => {
      const { min, offen } = summen(ma);
      const t = pdfText(`${stundenDe(min)} Std. bestätigt`);
      page.drawText(t, { x: xSp(i) + colW - 6 - bold.widthOfTextAtSize(t, 9.5), y: yr - 15, size: 9.5, font: bold, color: F.schwarz });
      if (offen) page.drawText(pdfText(`${offen} offen`), { x: xSp(i) + 6, y: yr - 15, size: 9, font: bold, color: F.orange });
      const nurAbrechnen = mitOhneLohn ? pdfText(ohneLohnSummenText(ma)) : '';
      if (nurAbrechnen) {
        page.drawText(nurAbrechnen, { x: xSp(i) + colW - 6 - bold.widthOfTextAtSize(nurAbrechnen, 9), y: yr - 27, size: 9, font: bold, color: F.violett });
      }
    });
    const bottom = yr - SUMME_H;

    // Gitterlinien
    const linie = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.7, color: F.linie });
    let yl = top;
    linie(x0, yl, W - M, yl);
    for (const h of [KOPF_H, ...rowH, SUMME_H]) { yl -= h; linie(x0, yl, W - M, yl); }
    linie(x0, top, x0, bottom);
    for (let i = 0; i <= SPALTEN_JE_SEITE; i++) linie(xSp(i), top, xSp(i), bottom);

    // Fuß: Legende + Vertraulichkeit
    legende.forEach((zeile, n) => {
      page.drawText(pdfText(zeile), { x: M, y: bottom - 13 - 11 * n, size: 7.5, font, color: F.grau });
    });
    page.drawText(pdfText('Vertraulich – nur für die interne Ablage des Pflegedienstes. Erzeugt aus dem digitalen Dienstplan.'), { x: M, y: bottom - 24 - 11 * (legende.length - 1), size: 7.5, font, color: F.grau });
    if (logo) {
      const h = 16;
      const w = h * (LOGO_BREITE / LOGO_HOEHE);
      page.drawImage(logo, { x: W - M - w, y: bottom - 6 - h, width: w, height: h });
    }
  });

  return pdf.save();
}

function kuerzen(s, f, size, max) {
  let t = pdfText(s);
  if (f.widthOfTextAtSize(t, size) <= max) return t;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function zeichneEintrag(page, e, x, y, breite, size, lineH, font, bold) {
  if (e.art === 'abwesenheit') {
    const farbe = e.grund === 'Krank' ? F.rot : F.blau;
    const t = pdfText(e.praefix + e.grund);
    page.drawText(t, { x, y, size: size + 0.5, font: bold, color: farbe });
    if (e.stundenMin) {
      const h = pdfText(stundenDe(e.stundenMin));
      page.drawText(h, { x: x + breite - bold.widthOfTextAtSize(h, size), y, size, font: bold, color: farbe });
    }
    return;
  }
  const abgesagt = e.status === 'abgesagt';
  const stil = eintragStil(e);
  const farbe = F[stil.farbe];
  const rechts = pdfText(stil.rechts);
  const fontRechts = stil.fett ? bold : font; // Zahl mit * fett: fällt beim Übertragen in die Abrechnung auf
  const rw = fontRechts.widthOfTextAtSize(rechts, size);
  const links = kuerzen(`${e.praefix}${e.klient} ${uhrKurz(e.von)}–${uhrKurz(e.bis)}`, font, size, breite - rw - 8);
  if (e.markiert && !abgesagt) {
    page.drawRectangle({ x: x - 2, y: y - 2.5, width: breite + 4, height: lineH - 1, color: F.gelb });
  }
  page.drawText(links, { x, y, size, font, color: farbe });
  page.drawText(rechts, { x: x + breite - rw, y, size, font: fontRechts, color: farbe });
  if (stil.strich) {
    // 'ganz': abgesagt wie bisher · 'text': nur Klient und Zeit, die Zahl mit * bleibt lesbar
    const ende = stil.strich === 'text' ? x + font.widthOfTextAtSize(links, size) : x + breite;
    page.drawLine({ start: { x, y: y + size * 0.3 }, end: { x: ende, y: y + size * 0.3 }, thickness: 0.6, color: farbe });
  }
}
