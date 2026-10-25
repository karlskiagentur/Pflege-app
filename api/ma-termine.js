import { fetchAll, sendError, reportError, requireMitarbeiter, esc, handledPreflight, ohneDruckLinks, TABLES } from './_lib.js';

// Zeitfenster: Die Mitarbeiter-App zeigt nur heutige und künftige Einsätze sowie im
// Zeitnachweis den aktuellen Monat und den Vormonat. Ältere Einsätze werden daher nicht
// mehr übertragen - die Liste bleibt auch nach Jahren Dienstplan schnell.
// 70 Tage decken den Vormonat immer vollständig ab (höchstens 62 Tage zurück) plus Puffer.
// Einsätze ohne Datum werden sicherheitshalber immer mitgeliefert.
export const FENSTER_TAGE = 70;

export function fensterFormel(mitarbeiterId) {
  const ab = `DATEADD(TODAY(), -${FENSTER_TAGE}, 'days')`;
  return `AND(FIND('${esc(mitarbeiterId)}', ARRAYJOIN({Pfleger_ID})), OR(`
    + `IF({Datum}, IS_AFTER({Datum}, ${ab}), 1), `
    + `IF({Uhrzeit}, IS_AFTER({Uhrzeit}, ${ab}), 0)))`;
}

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    // Auth: Mitarbeiter über Session-Token ermitteln, NICHT über Body-ID (IDOR-Schutz).
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;
    const mitarbeiterId = ma.id;

    const alleFormel = `filterByFormula=${encodeURIComponent(`FIND('${esc(mitarbeiterId)}', ARRAYJOIN({Pfleger_ID}))`)}`;
    let records;
    try {
      records = await fetchAll(TABLES.BESUCHE, `filterByFormula=${encodeURIComponent(fensterFormel(mitarbeiterId))}`);
    } catch (e) {
      // Sicherheitsnetz: Lehnt Airtable die Fenster-Formel ab, gilt die bisherige Abfrage
      // ohne Zeitfenster (die App funktioniert weiter) - und der Betreiber wird alarmiert.
      if (!e || e.status !== 422) throw e;
      reportError('api/ma-termine', 'Zeitfenster-Formel abgelehnt - Abfrage ohne Zeitfenster', { status: e.status });
      records = null;
    }
    // Leeres Ergebnis -> zur Sicherheit wie bisher ohne Zeitfenster abfragen
    // (kostet nur bei Mitarbeitern ohne aktuelle Einsätze eine zweite, kleine Abfrage).
    if (!records || records.length === 0) {
      records = await fetchAll(TABLES.BESUCHE, alleFormel);
    }
    // Aktueller Anzeigename (z. B. nach Kürzung auf "Vorname N." im Büro) - die App
    // übernimmt ihn, ohne dass sich der Mitarbeiter neu anmelden muss.
    res.setHeader('X-Mitarbeiter-Name', encodeURIComponent(String((ma.fields && ma.fields.Name) || '')));
    // Rohes Record-Array wie zuvor mitarbeiter_termine (App sortiert selbst) - ohne die
    // Druck-Links des Büros (enthalten Schlüssel, siehe ohneDruckLinks).
    res.status(200).json(records.map(ohneDruckLinks));
  } catch (e) {
    sendError(res, e, 'api/ma-termine');
  }
}
