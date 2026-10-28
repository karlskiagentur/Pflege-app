import { fetchAll, sendError, reportError, requireMitarbeiter, esc, handledPreflight, ohneDruckLinks, TABLES } from './_lib.js';
import { mitteilungenFuer } from './_mitteilungen.js';
import { lohnListeFuer } from './_lohn.js';

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

// Einsätze des Mitarbeiters (Zeitfenster, mit Sicherheitsnetz wie bisher).
async function einsaetzeLaden(mitarbeiterId) {
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
  return records;
}

// Zusatzdaten (Mitteilungen, Lohnabrechnungen): Ein Fehler dort darf die Einsätze nie
// verhindern - Alarm an den Betreiber, in der Antwort steht dann null (App behält den Stand).
const zusatz = (name, versprechen) => versprechen.catch((e) => {
  reportError('api/ma-termine', `${name} nicht geladen: ${(e && e.message) || e}`, { status: e && e.status });
  return null;
});

// Antwort:
//   bisher (format fehlt): Array der Einsätze - so lesen es ältere App-Versionen weiter.
//   format 2:              { termine } und mit "neuigkeiten: true" zusätzlich
//                          { mitteilungen, lohn } (App-Start, Tipp auf einen Push, Rückkehr
//                          nach >10 Min.) - parallel abgefragt, ohne zusätzliche Anmeldung.
export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    // Auth: Mitarbeiter über Session-Token ermitteln, NICHT über Body-ID (IDOR-Schutz).
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const format2 = body.format === 2;
    const mitNeuigkeiten = format2 && body.neuigkeiten === true;

    const [records, mitteilungen, lohn] = await Promise.all([
      einsaetzeLaden(ma.id),
      mitNeuigkeiten ? zusatz('Mitteilungen', mitteilungenFuer('mitarbeiter', ma.id)) : null,
      mitNeuigkeiten ? zusatz('Lohnabrechnungen', lohnListeFuer(ma.id, Date.now())) : null,
    ]);
    // Aktueller Anzeigename (z. B. nach Kürzung auf "Vorname N." im Büro) - die App
    // übernimmt ihn, ohne dass sich der Mitarbeiter neu anmelden muss.
    res.setHeader('X-Mitarbeiter-Name', encodeURIComponent(String((ma.fields && ma.fields.Name) || '')));
    // Rohe Records wie zuvor mitarbeiter_termine (App sortiert selbst) - ohne die
    // Druck-Links des Büros (enthalten Schlüssel, siehe ohneDruckLinks).
    const termine = records.map(ohneDruckLinks);
    if (!format2) { res.status(200).json(termine); return; }
    res.status(200).json(mitNeuigkeiten ? { termine, mitteilungen, lohn } : { termine });
  } catch (e) {
    sendError(res, e, 'api/ma-termine');
  }
}
