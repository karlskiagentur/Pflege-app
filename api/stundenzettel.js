import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { airtable, fetchAll, sendError, esc, TABLES } from './_lib.js';
import { UNTERSCHRIFT_PDL_B64 } from './_unterschrift-pdl.js';

// Interner Hook (Airtable-Automation "Status = Erstellen" -> Webhook), KEIN
// Session-Token-Flow: Auth über gemeinsames Secret im Header X-Hook-Secret.
// Erzeugt den Monats-Stundenzettel als PDF und hängt ihn an die Stundenzettel-Zeile.

const ZETTEL = 'tblmlg9ZNrtwRxmXx';  // Tabelle "Stundenzettel" (ID -> umbenenn-fest)
const DATEI_FELD = 'Datei';          // Anhang-Feld (uploadAttachment akzeptiert Feldnamen)

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_TOKEN = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;

// Sekunden -> "h:mm". Minutengenau, nie auf Stunden gerundet.
// Der Zettel liest die abrechenbare Ist-Zeit aus dem Formelfeld Ist_Stunden_Monat
// (= Dauer_Ist auf 15-min gerundet), identisch zur Arbeitsstunden-Seite im Interface.
const hmm = (sec) => {
  const m = Math.round((Number(sec) || 0) / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// Single-Select "Monat_Auswahl" ("August 2026") -> "YYYY-MM". Unbekannter
// Name wirft -> der äußere Catch setzt Status "Fehler" + meldet (ohne Inhalte).
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const parseMonatAuswahl = (s) => {
  const m = /^([A-Za-zÄÖÜäöüß]+)\s+(\d{4})$/.exec(String(s).trim());
  const idx = m ? MONATE.indexOf(m[1]) : -1;
  if (idx < 0) throw new Error('Unbekannter Monat_Auswahl-Wert');
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
};

const berlinHM = (iso) =>
  new Date(iso).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });

// "YYYY-MM-DD" -> "DD.MM.YYYY"; Fallback: Datum aus Uhrzeit (Berlin).
const datumText = (f) => {
  const d = String(f.Datum || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
  if (f.Uhrzeit) return new Date(f.Uhrzeit).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  return '-';
};

// Zeitfenster: Von-Bis (Select-Strings) > Uhrzeit + Dauer_Soll > nur Start.
const zeitfenster = (f) => {
  if (f.Von && f.Bis) return `${f.Von} – ${f.Bis}`;
  if (f.Uhrzeit) {
    const start = berlinHM(f.Uhrzeit);
    const soll = Number(f.Dauer_Soll) || 0;
    if (soll > 0) return `${start} – ${berlinHM(new Date(new Date(f.Uhrzeit).getTime() + soll * 1000).toISOString())}`;
    return start;
  }
  return '-';
};

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
    // 1) Stundenzettel-Zeile: Mitarbeiter-Link + Monat (Date) -> "YYYY-MM"
    const zettel = await airtable(`${ZETTEL}/${recordId}`);
    const zf = zettel.fields || {};
    const maId = Array.isArray(zf.Mitarbeiter) ? zf.Mitarbeiter[0] : null;
    // Monat: bevorzugt aus Monat_Auswahl (Single Select), sonst Fallback Date-Feld "Monat".
    const auswahl = String(zf.Monat_Auswahl || '').trim();
    const monat = auswahl ? parseMonatAuswahl(auswahl) : String(zf.Monat || '').slice(0, 7);
    if (!maId || !/^\d{4}-\d{2}$/.test(monat)) {
      throw new Error('Stundenzettel-Zeile unvollständig (Mitarbeiter oder Monat fehlt)');
    }

    // 2) Personal-Stammdaten (nur Name + Nummer, mehr braucht das PDF nicht)
    const personal = await airtable(`${TABLES.PERSONAL}/${maId}`);
    const pf = personal.fields || {};
    const maName = pf.Name || 'Mitarbeiter';
    const maNr = pf.Anmelde_ID || pf.Personal_Nr || '';

    // 3) Besuche des Monats mit erfasster Ist-Zeit dieses Pflegers.
    //    Feldnamen (Monat, Dauer_Ist, Pfleger_ID) sind gegen das Live-Schema
    //    geprüft; fetchAll behandelt die 100er-Pagination.
    const formula = `AND({Monat} = '${esc(monat)}', {Dauer_Ist}, FIND('${esc(maId)}', ARRAYJOIN({Pfleger_ID})))`;
    const besuche = await fetchAll(TABLES.BESUCHE, `filterByFormula=${encodeURIComponent(formula)}`);

    // Sortierung: Datum aufsteigend, dann Von bzw. Uhrzeit ("HH:mm" sortiert lexikografisch korrekt)
    const rows = besuche
      .map((r) => r.fields || {})
      .sort((a, b) => {
        const ka = `${a.Datum || ''} ${a.Von || (a.Uhrzeit ? berlinHM(a.Uhrzeit) : '')}`;
        const kb = `${b.Datum || ''} ${b.Von || (b.Uhrzeit ? berlinHM(b.Uhrzeit) : '')}`;
        return ka.localeCompare(kb);
      });

    // Monatssumme aus der abrechenbaren (15-min-gerundeten) Ist-Zeit je Einsatz.
    // Ist_Stunden_Monat = Formelfeld (Dauer_Ist auf 15-min gerundet) -> Summe in 15-min-Schritten.
    const totalSec = rows.reduce((s, f) => s + (Number(f.Ist_Stunden_Monat) || 0), 0);

    // 4) PDF (A4) - KEINE Klientennamen, nur Datum/Zeitfenster/Ist-Zeit
    const monatLabel = new Date(`${monat}-01T12:00:00Z`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const sigPdl = await pdf.embedPng(Buffer.from(UNTERSCHRIFT_PDL_B64, 'base64'));
    const grau = rgb(0.45, 0.45, 0.45);
    const schwarz = rgb(0.2, 0.2, 0.2);
    const A4 = [595.28, 841.89];
    const M = 50;                      // Seitenrand
    const COL = { datum: M, zeit: 200, ist: 420 };

    let page = pdf.addPage(A4);
    let y = A4[1] - M;

    const kopf = () => {
      page.drawText('Wunschlos Pflege – Stundennachweis', { x: M, y, size: 16, font: bold, color: schwarz });
      y -= 22;
      page.drawText(`${maName}${maNr ? ` · Nr. ${maNr}` : ''} · ${monatLabel}`, { x: M, y, size: 11, font, color: grau });
      y -= 28;
      page.drawText('Datum', { x: COL.datum, y, size: 10, font: bold, color: schwarz });
      page.drawText('Zeitfenster', { x: COL.zeit, y, size: 10, font: bold, color: schwarz });
      page.drawText('Ist-Zeit (h:mm)', { x: COL.ist, y, size: 10, font: bold, color: schwarz });
      y -= 6;
      page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: grau });
      y -= 16;
    };
    kopf();

    for (const f of rows) {
      if (y < M + 40) { page = pdf.addPage(A4); y = A4[1] - M; kopf(); }
      page.drawText(datumText(f), { x: COL.datum, y, size: 10, font, color: schwarz });
      page.drawText(zeitfenster(f), { x: COL.zeit, y, size: 10, font, color: schwarz });
      page.drawText(hmm(f.Ist_Stunden_Monat), { x: COL.ist, y, size: 10, font, color: schwarz });
      y -= 16;
    }
    if (rows.length === 0) {
      page.drawText('Keine Einsätze mit erfasster Ist-Zeit in diesem Monat.', { x: M, y, size: 10, font, color: grau });
      y -= 16;
    }

    // Fußblock: Summe + EINE (rechte) Unterschrift der Pflegedienstleitung,
    // vor-eingedruckt. Signatur sitzt über der Linie; braucht ~180pt.
    if (y < M + 180) { page = pdf.addPage(A4); y = A4[1] - M; }
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: grau });
    y -= 20;
    page.drawText(`Monatssumme: ${hmm(totalSec)} Std.`, { x: M, y, size: 12, font: bold, color: schwarz });
    y -= 40;
    // Nur EIN Unterschriftsblock (Pflegedienstleitung), rechtsbündig am Seitenrand.
    // Der Mitarbeiter ist bereits im Kopf benannt - keine linke Zeile mehr.
    const blockR = A4[0] - M;                       // rechter Rand des Blocks
    const lineX0 = blockR - 200, lineX1 = blockR;
    const sigW = 180, sigH = sigW * (600 / 1200);   // seitenverhältnis-treu (1200x600)
    const imgX = lineX0 + (200 - sigW) / 2;         // über der Linie zentriert
    page.drawImage(sigPdl, { x: imgX, y: y - sigH, width: sigW, height: sigH });
    const lineY = y - sigH - 4;
    page.drawLine({ start: { x: lineX0, y: lineY }, end: { x: lineX1, y: lineY }, thickness: 0.8, color: schwarz });
    page.drawText('Pflegedienstleitung', { x: lineX0, y: lineY - 14, size: 9, font, color: grau });

    const bytes = await pdf.save();

    // 5) PDF anhängen (uploadAttachment hängt an, bestehende Anhänge bleiben)
    const up = await fetch(`https://content.airtable.com/v0/${BASE}/${recordId}/${DATEI_FELD}/uploadAttachment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType: 'application/pdf',
        filename: `Stundenzettel_${monat}.pdf`,
        file: Buffer.from(bytes).toString('base64'),
      }),
    });
    if (!up.ok) {
      const e = new Error('Upload fehlgeschlagen');
      e.status = up.status;
      e.detail = await up.json().catch(() => ({}));
      throw e;
    }

    // 6) Ergebnis in die Zeile schreiben: Summe + Titel + Status.
    //    Monat (Date) auf den 1. des gewählten Monats setzen, falls leer oder
    //    abweichend -> hält Sortierung/Titel konsistent, wenn nur Monat_Auswahl gesetzt war.
    const fields = {
      Titel: `${maName} · ${monat}`,
      Summe_Stunden: hmm(totalSec),
      Status: 'Erstellt',
    };
    if (String(zf.Monat || '').slice(0, 10) !== `${monat}-01`) fields.Monat = `${monat}-01`;
    await airtable(`${ZETTEL}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    });

    res.status(200).json({ status: 'success', einsaetze: rows.length, summe: hmm(totalSec) });
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
