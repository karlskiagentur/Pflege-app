import { sendError, requireMitarbeiter, handledPreflight } from './_lib.js';
import { lohnListeFuer } from './_lohn.js';

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
    res.status(200).json(await lohnListeFuer(ma.id, Date.now()));
  } catch (e) {
    sendError(res, e, 'api/lohn-liste');
  }
}
