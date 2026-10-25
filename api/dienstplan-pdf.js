import { randomBytes, timingSafeEqual } from 'node:crypto';
import { airtable, fetchAll, reportError, TABLES } from './_lib.js';
import {
  PERSONAL_FELDER as PF, BESUCHE_FELDER, wochenBereich, wocheZuDatum, datumGueltig, dienstplanFormel,
  wochenplan, erstelleDienstplanPdf, dateiname,
} from './_dienstplan.js';

// Wochendienstplan eines Mitarbeiters als PDF - für den Druck im Büro.
//
// Aufruf über die Schaltfläche „Dienstplan drucken" im Airtable-Interface:
//   GET /api/dienstplan-pdf?ma=<Personal-Record-ID>&t=<Dienstplan_Schlüssel>[&datum=YYYY-MM-DD | &woche=1]
// Ohne datum/woche: laufende Woche. datum = die Woche, in der dieses Datum liegt (Schaltfläche
// in der Dienstplan-Zeile eines Einsatzes -> Woche dieses Einsatzes). woche=1 = Folgewoche.
// Ohne gespeicherten Schlüssel schickt die Schaltfläche "&einrichten=1": Der Server erzeugt
// dann einen zufälligen Schlüssel (192 Bit), speichert ihn am Mitarbeiter und bittet um einen
// zweiten Klick. Der Schlüssel wird dabei NIE ausgeliefert - wer nur die Record-ID kennt,
// kommt so nicht an Daten.
//
// Sicherheit: Der Schlüssel gilt nur für diesen einen Mitarbeiter (kein Generalschlüssel),
// wird zeitkonstant verglichen und lässt sich jederzeit widerrufen (Feld leeren). Deaktivierte
// Mitarbeiter bekommen keinen Plan. Antworten werden nie zwischengespeichert; Fehlerseiten
// enthalten keine Daten. Technische Fehler gehen als Alarm an den Betreiber.

const QUELLE = 'api/dienstplan-pdf';
const ID_MUSTER = /^rec[A-Za-z0-9]{14}$/;
const SCHLUESSEL_MUSTER = /^[A-Za-z0-9_-]{32}$/;

const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Kurze Hinweisseite im Browser (statt JSON), ohne Daten und ohne externe Inhalte.
function hinweisSeite(res, status, titel, text) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.status(status).send(
    '<!doctype html><html lang="de"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">'
    + `<title>${html(titel)} – Wunschlos Pflege</title>`
    + '<style>body{margin:0;background:#F9F7F4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#3A3A3A}'
    + 'main{max-width:560px;margin:12vh auto;padding:32px;background:#fff;border-radius:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}'
    + 'h1{font-size:22px;margin:0 0 12px}p{font-size:17px;line-height:1.5;margin:0}small{display:block;margin-top:20px;color:#8a8a8a}</style>'
    + `</head><body><main><h1>${html(titel)}</h1><p>${html(text)}</p><small>Wunschlos Pflege · Dienstplan drucken</small></main></body></html>`,
  );
}

// Zeitkonstanter Vergleich (gleiche Länge vorausgesetzt).
function gleich(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

const param = (req, name) => {
  const v = req.query ? req.query[name] : undefined;
  return String((Array.isArray(v) ? v[0] : v) ?? '').trim();
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    hinweisSeite(res, 405, 'Nicht möglich', 'Der Dienstplan lässt sich nur über die Schaltfläche „Dienstplan drucken“ öffnen.');
    return;
  }
  const ma = param(req, 'ma');
  const schluessel = param(req, 't');
  const woche = param(req, 'woche') || '0';
  const datum = param(req, 'datum');
  if (!ID_MUSTER.test(ma) || (schluessel && !SCHLUESSEL_MUSTER.test(schluessel)) || !/^[01]$/.test(woche)
    || (datum && !datumGueltig(datum))) {
    hinweisSeite(res, 400, 'Link ungültig', 'Bitte den Dienstplan über die Schaltfläche „Dienstplan drucken“ im Airtable-Interface öffnen.');
    return;
  }

  try {
    // 1) Mitarbeiter: nur Name, Aktiv, Schlüssel (Feld-IDs -> umbenennungsfest)
    const felder = [PF.NAME, PF.AKTIV, PF.SCHLUESSEL].map((id) => `fields%5B%5D=${id}`).join('&');
    const formel = encodeURIComponent(`RECORD_ID() = '${ma}'`);
    const daten = await airtable(`${TABLES.PERSONAL}?filterByFormula=${formel}&${felder}&returnFieldsByFieldId=true&maxRecords=1`);
    const rec = (daten.records || [])[0];
    if (!rec) {
      hinweisSeite(res, 404, 'Link ungültig', 'Diesen Mitarbeiter gibt es nicht (mehr). Bitte die Airtable-Seite neu laden.');
      return;
    }
    const f = rec.fields || {};
    if (!f[PF.AKTIV]) {
      hinweisSeite(res, 403, 'Mitarbeiter nicht aktiv', 'Für deaktivierte Mitarbeiter wird kein Dienstplan erstellt.');
      return;
    }

    // 2) Schlüssel prüfen bzw. beim ersten Klick einrichten
    const gespeichert = String(f[PF.SCHLUESSEL] || '').trim();
    if (!gespeichert) {
      if (schluessel) { // fremder Schlüssel für einen Mitarbeiter ohne Schlüssel: nie übernehmen
        hinweisSeite(res, 403, 'Link nicht mehr gültig', 'Bitte die Airtable-Seite neu laden und noch einmal auf „Dienstplan drucken“ klicken.');
        return;
      }
      await airtable(`${TABLES.PERSONAL}/${rec.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { [PF.SCHLUESSEL]: randomBytes(24).toString('base64url') } }),
      });
      hinweisSeite(res, 200, 'Druck eingerichtet', 'Der Dienstplan-Druck für diesen Mitarbeiter ist jetzt eingerichtet. Bitte dieses Fenster schließen und in Airtable noch einmal auf „Dienstplan drucken“ klicken.');
      return;
    }
    if (!schluessel || !gleich(schluessel, gespeichert)) {
      hinweisSeite(res, 403, 'Link nicht mehr gültig', 'Bitte die Airtable-Seite neu laden und noch einmal auf „Dienstplan drucken“ klicken.');
      return;
    }

    // 3) Woche und Einsätze genau zum Zeitpunkt des Klicks (nichts zwischengespeichert)
    const jetzt = Date.now();
    const bereich = datum ? wocheZuDatum(datum) : wochenBereich(jetzt, Number(woche));
    const query = `filterByFormula=${encodeURIComponent(dienstplanFormel(rec.id, bereich))}&`
      + BESUCHE_FELDER.map((n) => `fields%5B%5D=${encodeURIComponent(n)}`).join('&');
    const besuche = await fetchAll(TABLES.BESUCHE, query);
    const plan = wochenplan(besuche, bereich);
    const maName = String(f[PF.NAME] || '').trim() || 'Mitarbeiter';
    const bytes = await erstelleDienstplanPdf({ maName, bereich, plan, jetzt });

    // 4) PDF direkt im Browser öffnen (Drucken/Herunterladen im Betrachter)
    const name = dateiname(maName, bereich);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    if (e && e.status === 429) {
      hinweisSeite(res, 503, 'Bitte kurz warten', 'Die Datenbank ist gerade ausgelastet. Bitte in einer Minute noch einmal klicken.');
      return;
    }
    // Details nur in Log + Alarm, nie an den Browser (keine Namen, keine Schlüssel).
    console.error(`[${QUELLE}]`, e && e.message, e && e.detail ? JSON.stringify(e.detail) : '');
    reportError(QUELLE, (e && e.message) || String(e), { status: e && e.status });
    hinweisSeite(res, 500, 'Dienstplan gerade nicht verfügbar', 'Der Dienstplan konnte nicht erstellt werden. Bitte in einer Minute erneut versuchen – die Technik ist bereits informiert.');
  }
}
