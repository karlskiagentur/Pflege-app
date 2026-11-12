// Wochendienstplan ALLER Mitarbeiter als PDF (A4 quer) – Aufbau wie die bisherige Word-Tabelle
// des Büros: Zeilen = Tage (Mo–Fr, Sa/So), Spalten = Mitarbeiter (4 je Seite), je Einsatz
// "Klient Von–Bis" und rechts die Stunden. Reine Logik ohne Netz (testbar).
//
// Stunden = BESTÄTIGTE Ist-Zeit. Nicht bestätigte Einsätze stehen als "offen" da und zählen
// nicht; abgesagte sind durchgestrichen; Urlaub/Gleitzeit/Krank/Abwesend laut Dienstplan.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pdfText } from './_pdftext.js';
import { termin, vorbei, abwesenheitsGrund, berlin } from './_zeitkonto.js';

const A4_QUER = [841.89, 595.28];
const M = 26;
const SPALTEN_JE_SEITE = 4;
const TAG_SPALTE = 78;

const F = {
  gruen: rgb(0.573, 0.776, 0.365),
  linie: rgb(0.25, 0.25, 0.25),
  schwarz: rgb(0.12, 0.12, 0.12),
  blau: rgb(0.11, 0.42, 0.68),
  rot: rgb(0.78, 0.16, 0.12),
  orange: rgb(0.78, 0.4, 0.05),
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

/** Summen je Mitarbeiter: bestätigte Minuten, Zahl offener Einsätze. */
export function summen(ma) {
  let min = 0;
  let offen = 0;
  for (const liste of Object.values(ma.tage || {})) {
    for (const e of liste) {
      if (e.art !== 'einsatz' || e.status === 'abgesagt') continue;
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

  for (const r of besuche || []) {
    const f = (r && r.fields) || {};
    const t = termin(f, (r && r.id) || '');
    if (!t.datum || !inWoche.has(t.datum)) continue;

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
          // Stunden nur bei Urlaub/Gleitzeit (api/_abrechnung.js), sonst null
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
          // abgesagt > (noch nicht vorbei | Ist-Zeit da) = bestätigt > vorbei ohne Ist = offen
          status: t.status === 'Abgesagt' || hervorhebung === 'Storniert'
            ? 'abgesagt'
            : t.istMin !== null
              ? 'bestaetigt'
              : vorbei(t, nun) ? 'offen' : 'geplant',
          markiert: MARKIERT.includes(hervorhebung),
        };

    for (const id of ids) {
      const sp = spalten.get(id);
      if (!sp) continue;                           // inaktiv oder unbekannt -> keine Spalte
      (sp.tage[t.datum] = sp.tage[t.datum] || []).push(eintrag);
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
 *   eintrag: { art:'einsatz', klient, von, bis, istMin, status:'bestaetigt'|'offen'|'abgesagt', markiert }
 *          | { art:'abwesenheit', grund:'Krank'|'Urlaub'|'Gleitzeit'|'Abwesend', stundenMin }
 */
export async function erstelleWochenuebersichtPdf({ kw, jahr, tage, stand, mitarbeiter }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

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
    const SUMME_H = 22;
    const FUSS_H = 30;
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
    page.drawRectangle({ x: x0, y: top - KOPF_H, width: W - 2 * M, height: KOPF_H, color: F.gruen });
    page.drawText(pdfText(`KW ${kw}`), { x: x0 + 8, y: top - 19, size: 12, font: bold, color: F.schwarz });
    gruppe.forEach((ma, i) => {
      page.drawText(kuerzen(ma.name, bold, 10.5, colW - 12), { x: xSp(i) + 6, y: top - 19, size: 10.5, font: bold, color: F.schwarz });
    });

    // Tageszeilen
    let yr = top - KOPF_H;
    zeilen.forEach((z, r) => {
      const h = rowH[r];
      page.drawRectangle({ x: x0, y: yr - h, width: TAG_SPALTE, height: h, color: F.gruen });
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
    page.drawRectangle({ x: x0, y: yr - SUMME_H, width: TAG_SPALTE, height: SUMME_H, color: F.gruen });
    page.drawText(pdfText('Summe'), { x: x0 + 8, y: yr - 15, size: 10, font: bold, color: F.schwarz });
    gruppe.forEach((ma, i) => {
      const { min, offen } = summen(ma);
      const t = pdfText(`${stundenDe(min)} Std. bestätigt`);
      page.drawText(t, { x: xSp(i) + colW - 6 - bold.widthOfTextAtSize(t, 9.5), y: yr - 15, size: 9.5, font: bold, color: F.schwarz });
      if (offen) page.drawText(pdfText(`${offen} offen`), { x: xSp(i) + 6, y: yr - 15, size: 9, font: bold, color: F.orange });
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
    const leg = 'Zahl rechts = bestätigte Ist-Zeit in Stunden  ·  offen = nicht bestätigt, zählt nicht  ·  durchgestrichen = abgesagt  ·  gelb = Zusatz/Änderung des Büros';
    page.drawText(pdfText(leg), { x: M, y: bottom - 13, size: 7.5, font, color: F.grau });
    page.drawText(pdfText('Vertraulich – nur für die interne Ablage des Pflegedienstes. Erzeugt aus dem digitalen Dienstplan.'), { x: M, y: bottom - 24, size: 7.5, font, color: F.grau });
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
  const offen = e.status === 'offen';
  const farbe = abgesagt ? F.grau : offen ? F.orange : F.blau;
  const rechts = pdfText(abgesagt ? (e.planMin ? stundenDe(e.planMin) : '') : offen ? 'offen' : stundenDe(e.istMin || 0));
  const rw = font.widthOfTextAtSize(rechts, size);
  const links = kuerzen(`${e.praefix}${e.klient} ${uhrKurz(e.von)}–${uhrKurz(e.bis)}`, font, size, breite - rw - 8);
  if (e.markiert && !abgesagt) {
    page.drawRectangle({ x: x - 2, y: y - 2.5, width: breite + 4, height: lineH - 1, color: F.gelb });
  }
  page.drawText(links, { x, y, size, font, color: farbe });
  page.drawText(rechts, { x: x + breite - rw, y, size, font, color: farbe });
  if (abgesagt) {
    page.drawLine({ start: { x, y: y + size * 0.3 }, end: { x: x + breite, y: y + size * 0.3 }, thickness: 0.6, color: F.grau });
  }
}
