import { fetchAll, sendError, requireMitarbeiter, esc, handledPreflight } from './_lib.js';
import { LOHN, ARCHIVIERT, lohnFuerApp } from './_lohn.js';

// Lohnabrechnungen des eingeloggten Mitarbeiters (Tabelle "Lohnabrechnung", vom Büro
// über die Interface-Seite "Mitarbeiter (Lohnabrechnung)" hochgeladen).
// Ausgeliefert werden nur Monat, Dateinamen und Fristen - keine Datei-URLs; die Datei
// selbst gibt es nur über /api/lohn-download (mit erneuter Eigentümer-Prüfung).
export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    // Auth: Mitarbeiter über Session-Token; Lohndaten nur für den eigenen Datensatz.
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;

    // Filter über das Lookup-Feld Mitarbeiter_ID (== Personal-Record-ID). Die ID kommt aus
    // dem geprüften Token, nicht aus dem Request (IDOR-Schutz).
    const formel = `AND(FIND('${esc(ma.id)}', ARRAYJOIN({Mitarbeiter_ID})), {Status} != '${ARCHIVIERT}')`;
    const records = await fetchAll(LOHN, `filterByFormula=${encodeURIComponent(formel)}`);

    const jetzt = Date.now();
    const liste = records
      // zweite, exakte Prüfung am Link selbst (FIND ist nur der Vorfilter)
      .filter((r) => Array.isArray(r.fields && r.fields.Mitarbeiter) && r.fields.Mitarbeiter.includes(ma.id))
      .map((r) => lohnFuerApp(r, jetzt))
      .filter(Boolean)
      .sort((a, b) => b.sortierung.localeCompare(a.sortierung))
      .map(({ sortierung, ...rest }) => rest);

    res.status(200).json(liste);
  } catch (e) {
    sendError(res, e, 'api/lohn-liste');
  }
}
