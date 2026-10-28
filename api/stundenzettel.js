import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { airtable, fetchAll, sendError, esc, TABLES } from './_lib.js';
import { UNTERSCHRIFT_PDL_B64 } from './_unterschrift-pdl.js';
import { berechneZeitnachweis, hm } from './_zeitkonto.js';
import { pdfText } from './_pdftext.js';

// Interner Hook (Airtable-Automation "Status = Erstellen" -> Webhook), KEIN
// Session-Token-Flow: Auth über gemeinsames Secret im Header X-Hook-Secret.
// Erzeugt den Monats-Stundenzettel als PDF und hängt ihn an die Stundenzettel-Zeile.
// Rechenregeln (nur Vergangenes, Ist/Plan, Kunden-Anfahrt, Pausen): api/_zeitkonto.js

const ZETTEL = 'tblmlg9ZNrtwRxmXx';  // Tabelle "Stundenzettel" (ID -> umbenenn-fest)
const DATEI_FELD = 'Datei';          // Anhang-Feld (uploadAttachment akzeptiert Feldnamen)

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_TOKEN = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;

// Single-Select "Monat_Auswahl" ("August 2026") -> "YYYY-MM". Unbekannter
// Name wirft -> der äußere Catch setzt Status "Fehler" + meldet (ohne Inhalte).
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const parseMonatAuswahl = (s) => {
  const m = /^([A-Za-zÄÖÜäöüß]+)\s+(\d{4})$/.exec(String(s).trim());
  const idx = m ? MONATE.indexOf(m[1]) : -1;
  if (idx < 0) throw new Error('Unbekannter Monat_Auswahl-Wert');
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
};

// Text für die PDF-Standardschrift (Windows-1252): gemeinsamer Helfer in _pdftext.js, auch vom
// Dienstplan genutzt. Re-Export, damit bestehende Importe aus diesem Modul unverändert funktionieren.
export { pdfText };

const datumDe = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const uhrDe = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Spalten des Zettels (x in pt; A4 hoch, Rand 50). Soll und Ist rechtsbündig, Klient ganz rechts.
export const SPALTEN = { datum: 50, fenster: 110, sollR: 212, istR: 256, klient: 272 };

// Kurzhinweis oben auf Seite 1; die ausführliche Erläuterung steht am Ende jedes Zettels.
export const HINWEIS = 'Zeitfenster und Soll = Planung laut Dienstplan · bezahlt wird die Ist-Zeit plus Kunden-Anfahrt · Erläuterung am Ende';
export const ERLAEUTERUNG = [
  'Zeitfenster und Soll: geplante Zeit laut Dienstplan. Das Zeitfenster bleibt so stehen, auch wenn ein Einsatz länger oder kürzer gedauert hat – es zeigt immer die Planung.',
  'Ist: die in der App unter „Tatsächliche Dauer“ erfasste Zeit im 15-Minuten-Takt (gerundet, z. B. 20 Min. = 0:15, 25 Min. = 0:30). Bezahlt wird die Ist-Zeit, nicht das Zeitfenster. Fett gedruckt = weicht von der Planung ab.',
  '„laut Ist“: der gerechnete Zeitraum, wenn er vom Zeitfenster abweicht – Beginn laut Plan (bzw. direkt nach dem vorherigen Einsatz, wenn dieser länger gedauert hat) plus Ist-Dauer.',
  'Kunden-Anfahrt: Die Zeit zwischen dem Ende eines Einsatzes (laut Ist) und dem Beginn des nächsten wird bis 30 Minuten voll bezahlt. Ist die Lücke länger, werden trotzdem 30 Minuten Anfahrt bezahlt; nur der Rest ist Pause – unbezahlt und separat ausgewiesen (z. B. Lücke 1:00 = 0:30 Pause + 0:30 Anfahrt).',
  'Dauert ein Einsatz länger als geplant, wird die Anfahrt zum nächsten kürzer oder der nächste Einsatz beginnt später – keine Minute wird doppelt bezahlt. Dauert er kürzer, wird die Lücke länger; was über 30 Minuten hinausgeht, ist Pause.',
];

/**
 * Anzeige-Zeilen eines Tages (rein, ohne PDF - testbar).
 * Spalten: Zeitfenster laut Dienstplan | Soll | Ist | Klient.
 * Ist = erfasste Zeit; ohne Erfassung die angerechnete Soll-Zeit, markiert mit "*".
 */
export function tagesZeilen(tag) {
  return tag.zeilen.map((z) => {
    const fenster = z.von && z.bis ? `${z.von} – ${z.bis}` : (z.von || '–');
    if (z.art === 'anfahrt') return { art: 'anfahrt', fenster, soll: '', ist: hm(z.min), fett: false, istFenster: '', klient: 'Kunden-Anfahrt' };
    if (z.art === 'pause') return { art: 'pause', fenster, soll: '', ist: `(${hm(z.min)})`, fett: false, istFenster: '', klient: 'Pause (unbezahlt)' };
    const sollBekannt = typeof z.sollMin === 'number';
    const erfasst = z.quelle === 'ist';
    return {
      art: 'einsatz',
      fenster,
      soll: sollBekannt ? hm(z.sollMin) : '–',
      ist: erfasst ? hm(z.min) : `${hm(z.min)}*`,
      fett: erfasst && sollBekannt && z.min !== z.sollMin, // Ist weicht von der Planung ab
      // Zeitraum laut Ist, wenn er vom Zeitfenster abweicht (nicht bei 0 Minuten)
      istFenster: z.zeitAbweichend && z.min > 0 ? `${z.istVon} – ${z.istBis}` : '',
      klient: z.klient || '–',
    };
  });
}

// Text der Tagessumme (Klient-Spalte); der Betrag (bezahlt) steht in der Ist-Spalte.
export function tagesSummeText(tag) {
  const teile = ['Tagessumme'];
  if (tag.anfahrtMin) teile.push(`davon Anfahrt ${hm(tag.anfahrtMin)}`);
  if (tag.pauseMin) teile.push(`Pause ${hm(tag.pauseMin)} unbezahlt`);
  return teile.join(' · ');
}

/**
 * Rendert den Stundenzettel (A4 hoch). Rein, ohne Netz - auch für Tests/Vorschau.
 * @param {{maName: string, maNr: string|number, monat: string, nachweis: object, final: boolean}} d
 */
export async function erstellePdf({ maName, maNr, monat, nachweis, final }) {
  const monatLabel = new Date(`${monat}-01T12:00:00Z`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const kursiv = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const grau = rgb(0.45, 0.45, 0.45);
  const hellgrau = rgb(0.6, 0.6, 0.6);
  const schwarz = rgb(0.2, 0.2, 0.2);
  const orange = rgb(0.7, 0.33, 0.08);
  const A4 = [595.28, 841.89];
  const M = 50;
  const SP = SPALTEN;
  const KLIENT_MAX = A4[0] - M - SP.klient;
  const BREITE = A4[0] - 2 * M;

  const text = (page, s, x, y, size, f, color) => page.drawText(pdfText(s), { x, y, size, font: f, color });
  const rechts = (page, s, xR, y, size, f, color) => {
    const t = pdfText(s);
    page.drawText(t, { x: xR - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  };
  // Zeitwert rechtsbündig; ein angehängtes "*" oder ")" hängt rechts über, damit die Ziffern
  // aller Zeilen genau untereinander stehen.
  const zeitwert = (page, s, xR, y, size, f, color) => {
    const t = pdfText(s);
    const haengt = /[*)]$/.test(t) ? t.slice(-1) : '';
    rechts(page, haengt ? t.slice(0, -1) : t, xR, y, size, f, color);
    if (haengt) page.drawText(haengt, { x: xR + 0.5, y, size, font: f, color });
  };
  const gekuerzt = (s, f, size, max) => {
    let t = pdfText(s);
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };
  // Fließtext an Wortgrenzen auf die Breite max umbrechen.
  const umbrechen = (s, f, size, max) => {
    const zeilen = [];
    let akt = '';
    for (const w of pdfText(s).split(' ')) {
      const probe = akt ? `${akt} ${w}` : w;
      if (!akt || f.widthOfTextAtSize(probe, size) <= max) akt = probe;
      else { zeilen.push(akt); akt = w; }
    }
    if (akt) zeilen.push(akt);
    return zeilen;
  };

  let page;
  let y;
  // Neue Seite: Kopf immer, Spaltenköpfe nur, wenn danach Tabellenzeilen folgen.
  const neueSeite = (tabellenkopf = true) => {
    const ersteSeite = pdf.getPageCount() === 0;
    page = pdf.addPage(A4);
    y = A4[1] - M;
    text(page, 'Wunschlos Pflege – Stundennachweis', M, y, 16, bold, schwarz);
    y -= 22;
    text(page, `${maName}${maNr ? ` · Nr. ${maNr}` : ''} · ${monatLabel}`, M, y, 11, font, grau);
    y -= 16;
    const stand = `${datumDe(nachweis.jetzt.datum)}, ${uhrDe(nachweis.jetzt.min)} Uhr`;
    if (final) {
      text(page, `Erstellt am ${stand}`, M, y, 9, font, hellgrau);
    } else {
      text(page, `VORLÄUFIG · Stand ${stand} · enthält nur bereits vergangene Termine`, M, y, 9, bold, orange);
    }
    if (ersteSeite) {
      y -= 13;
      text(page, HINWEIS, M, y, 8, font, grau);
    }
    y -= 24;
    if (!tabellenkopf) return;
    text(page, 'Datum', SP.datum, y, 10, bold, schwarz);
    text(page, 'Zeitfenster', SP.fenster, y, 10, bold, schwarz);
    rechts(page, 'Soll', SP.sollR, y, 10, bold, schwarz);
    rechts(page, 'Ist', SP.istR, y, 10, bold, schwarz);
    text(page, 'Klient', SP.klient, y, 10, bold, schwarz);
    y -= 10;
    text(page, 'laut Dienstplan', SP.fenster, y, 7.5, font, grau);
    rechts(page, 'geplant', SP.sollR, y, 7.5, font, grau);
    rechts(page, 'erfasst', SP.istR, y, 7.5, font, grau);
    y -= 5;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: grau });
    y -= 15;
  };
  neueSeite();
  const platz = (benoetigt, tabellenkopf = true) => {
    if (y - benoetigt < M) { neueSeite(tabellenkopf); return true; }
    return false;
  };

  for (const tag of nachweis.tage) {
    let datumZeigen = true;
    for (const z of tagesZeilen(tag)) {
      if (platz(z.istFenster ? 25 : 14)) datumZeigen = true;
      if (datumZeigen) { text(page, datumDe(tag.datum), SP.datum, y, 10, font, schwarz); datumZeigen = false; }
      if (z.art === 'einsatz') {
        text(page, z.fenster, SP.fenster, y, 10, font, schwarz);
        rechts(page, z.soll, SP.sollR, y, 10, font, schwarz);
        zeitwert(page, z.ist, SP.istR, y, 10, z.fett ? bold : font, schwarz);
        page.drawText(gekuerzt(z.klient, font, 10, KLIENT_MAX), { x: SP.klient, y, size: 10, font, color: schwarz });
        if (z.istFenster) {
          y -= 11;
          text(page, `laut Ist: ${z.istFenster}`, SP.fenster, y, 8, kursiv, grau);
        }
      } else {
        const farbe = z.art === 'anfahrt' ? grau : hellgrau;
        text(page, z.fenster, SP.fenster, y, 10, kursiv, farbe);
        zeitwert(page, z.ist, SP.istR, y, 10, kursiv, farbe);
        text(page, z.klient, SP.klient, y, 10, kursiv, farbe);
      }
      y -= 14;
    }
    if (tag.zeilen.length > 1) {
      platz(14);
      zeitwert(page, hm(tag.bezahltMin), SP.istR, y, 9, bold, grau);
      page.drawText(gekuerzt(tagesSummeText(tag), bold, 9, KLIENT_MAX), { x: SP.klient, y, size: 9, font: bold, color: grau });
      y -= 14;
    }
    y -= 4; // Abstand zwischen Tagen
  }
  if (nachweis.tage.length === 0) {
    text(page, 'Keine vergangenen Einsätze in diesem Monat.', M, y, 10, font, grau);
    y -= 16;
  }

  // Fußblock: Summen + (nur beim fertigen Monat) EINE Unterschrift der Pflegedienstleitung.
  const s = nachweis.summen;
  const mitUnterschrift = final && s.einsaetze > 0;
  platz(mitUnterschrift ? 230 : 120, false);
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: grau });
  y -= 18;
  const WERT_R = 300;  // Beträge rechtsbündig
  const NOTIZ_X = 312; // kurze Erklärung rechts daneben
  const summenZeile = (label, wert, notiz, f, size, color) => {
    text(page, label, M, y, size, f, color);
    rechts(page, `${wert} Std.`, WERT_R, y, size, f, color);
    if (notiz) text(page, notiz, NOTIZ_X, y, 8, font, grau);
    y -= size + 6;
  };
  summenZeile('Einsätze laut Dienstplan (Soll)', hm(s.sollMin), 'nur zum Vergleich', font, 10, grau);
  summenZeile('Einsätze erfasst (Ist)', hm(s.einsatzMin), '', font, 10, schwarz);
  summenZeile('Kunden-Anfahrt', hm(s.anfahrtMin), '', font, 10, schwarz);
  summenZeile(final ? 'Monatssumme (bezahlt)' : 'Zwischensumme (bezahlt)', hm(s.bezahltMin), '= Ist + Kunden-Anfahrt', bold, 12, schwarz);
  summenZeile('Pausen (unbezahlt)', hm(s.pauseMin), 'nicht in der Summe enthalten', font, 9, grau);
  if (s.ohneIst > 0) {
    text(page, `* Keine Ist-Zeit erfasst – die Soll-Zeit wurde angerechnet (${s.ohneIst} ${s.ohneIst === 1 ? 'Einsatz' : 'Einsätze'}).`, M, y, 8, font, grau);
    y -= 12;
  }

  if (mitUnterschrift) {
    y -= 18;
    const sigPdl = await pdf.embedPng(Buffer.from(UNTERSCHRIFT_PDL_B64, 'base64'));
    const blockR = A4[0] - M;
    const lineX0 = blockR - 200, lineX1 = blockR;
    const sigW = 150, sigH = sigW * (600 / 1200);   // seitenverhältnis-treu (1200x600)
    const imgX = lineX0 + (200 - sigW) / 2;
    page.drawImage(sigPdl, { x: imgX, y: y - sigH, width: sigW, height: sigH });
    const lineY = y - sigH - 4;
    page.drawLine({ start: { x: lineX0, y: lineY }, end: { x: lineX1, y: lineY }, thickness: 0.8, color: schwarz });
    text(page, 'Pflegedienstleitung', lineX0, lineY - 14, 9, font, grau);
    y = lineY - 24;
  }

  // Erläuterung für die Mitarbeiter (auf jedem Zettel, notfalls auf eigener Seite).
  const absaetze = ERLAEUTERUNG.map((t) => umbrechen(t, font, 8, BREITE - 10));
  platz(24 + absaetze.reduce((h, z) => h + z.length * 10 + 3, 0), false);
  y -= 10;
  text(page, 'So ist der Stundennachweis zu lesen', M, y, 9, bold, schwarz);
  y -= 13;
  for (const zeilen of absaetze) {
    text(page, '•', M + 1, y, 8, font, grau);
    for (const z of zeilen) {
      page.drawText(z, { x: M + 10, y, size: 8, font, color: grau });
      y -= 10;
    }
    y -= 3;
  }
  return pdf.save();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  // Auth: gemeinsames Secret. Bewusst ohne Details in der Antwort; fehlendes
  // Env-Secret lehnt ebenfalls ab (Endpoint ist nie unabsichtlich offen).
  const secret = process.env.STUNDENZETTEL_SECRET;
  if (!secret || String(req.headers['x-hook-secret'] || '') !== secret) {
    res.status(401).json({ status: 'error' }); return;
  }

  const recordId = String((req.body && req.body.recordId) || '');
  if (!/^rec[A-Za-z0-9]{14,}$/.test(recordId)) {
    res.status(400).json({ status: 'error', message: 'recordId nötig' }); return;
  }

  try {
    // 1) Stundenzettel-Zeile: Mitarbeiter-Link + Monat -> "YYYY-MM"
    const zettel = await airtable(`${ZETTEL}/${recordId}`);
    const zf = zettel.fields || {};
    const maId = Array.isArray(zf.Mitarbeiter) ? zf.Mitarbeiter[0] : null;
    // Monat: bevorzugt aus Monat_Auswahl (Single Select), sonst Fallback Date-Feld "Monat".
    const auswahl = String(zf.Monat_Auswahl || '').trim();
    const monat = auswahl ? parseMonatAuswahl(auswahl) : String(zf.Monat || '').slice(0, 7);
    if (!maId || !/^\d{4}-\d{2}$/.test(monat)) {
      throw new Error('Stundenzettel-Zeile unvollständig (Mitarbeiter oder Monat fehlt)');
    }

    // 2) Personal-Stammdaten (nur Name + Nummer)
    const personal = await airtable(`${TABLES.PERSONAL}/${maId}`);
    const pf = personal.fields || {};
    const maName = pf.Name || 'Mitarbeiter';
    const maNr = pf.Anmelde_ID || pf.Personal_Nr || '';

    // 3) ALLE Termine des Monats dieses Mitarbeiters (auch ohne erfasste Ist-Zeit) -
    //    welche zählen, entscheidet der Rechenkern (nur Vergangenes, nichts Abgesagtes).
    const formula = `AND({Monat} = '${esc(monat)}', FIND('${esc(maId)}', ARRAYJOIN({Pfleger_ID})))`;
    const besuche = await fetchAll(TABLES.BESUCHE, `filterByFormula=${encodeURIComponent(formula)}`);
    const nachweis = berechneZeitnachweis(besuche, { jetzt: Date.now() });

    // Fertig ist der Zettel erst, wenn der Monat vorbei ist; vorher "vorläufig".
    const final = nachweis.jetzt.datum.slice(0, 7) > monat;
    const bytes = await erstellePdf({ maName, maNr, monat, nachweis, final });
    // Die finale Fassung trägt "_final" im Namen: Zettel der Vorversion hießen auch mitten
    // im Monat "Stundenzettel_YYYY-MM.pdf" und dürfen nicht als fertig gelten (der
    // Monatsabschluss erkennt fertige Zettel am Dateinamen).
    const dateiname = final
      ? `Stundenzettel_${monat}_final.pdf`
      : `Stundenzettel_${monat}_vorlaeufig_${nachweis.jetzt.datum}.pdf`;

    // 4) PDF anhängen (uploadAttachment hängt an, frühere Fassungen bleiben erhalten)
    const up = await fetch(`https://content.airtable.com/v0/${BASE}/${recordId}/${DATEI_FELD}/uploadAttachment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf', filename: dateiname, file: Buffer.from(bytes).toString('base64') }),
    });
    if (!up.ok) {
      const e = new Error('Upload fehlgeschlagen');
      e.status = up.status;
      e.detail = await up.json().catch(() => ({}));
      throw e;
    }

    // 5) Ergebnis in die Zeile schreiben: Summe (bezahlt) + Titel + Status.
    //    Monat (Date) auf den 1. des gewählten Monats setzen, falls leer oder abweichend.
    const summe = hm(nachweis.summen.bezahltMin);
    const fields = {
      Titel: `${maName} · ${monat}${final ? '' : ' (vorläufig)'}`,
      Summe_Stunden: summe,
      Status: 'Erstellt',
    };
    if (String(zf.Monat || '').slice(0, 10) !== `${monat}-01`) fields.Monat = `${monat}-01`;
    await airtable(`${ZETTEL}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    });

    res.status(200).json({
      status: 'success', einsaetze: nachweis.summen.einsaetze, summe, vorlaeufig: !final,
      ohneIst: nachweis.summen.ohneIst, ausgelassen: nachweis.ausgelassen,
    });
  } catch (e) {
    // Status -> Fehler (best effort), dann Standard-Fehlerpfad (Alarm-Mail,
    // keine Namen/Secrets in der Antwort oder im Fehlertext).
    try {
      await airtable(`${ZETTEL}/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { Status: 'Fehler' }, typecast: true }),
      });
    } catch (_) { /* Statuspflege darf den Fehlerpfad nicht stören */ }
    sendError(res, e, 'api/stundenzettel');
  }
}
