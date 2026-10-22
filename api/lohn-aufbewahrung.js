import { sendError, reportError } from './_lib.js';
import { lohnAufbewahrung } from './_lohn.js';

// Vercel-Cron (täglich, morgens): Aufbewahrung der Lohnabrechnungen - Erinnerung 7 Tage
// vor der Löschung, Löschung der Datei nach 3 Monaten, verpasste Upload-Pushs nachholen.
// Regeln und Ablauf: api/_lohn.js.
export default async function handler(req, res) {
  // Auth: Vercel-Cron schickt "Authorization: Bearer <CRON_SECRET>". Fehlt das Secret oder
  // passt es nicht -> ablehnen (fail closed), wie api/stundenzettel-monatslauf.
  const secret = process.env.CRON_SECRET;
  if (!secret || String(req.headers.authorization || '') !== `Bearer ${secret}`) {
    res.status(401).json({ status: 'error' }); return;
  }
  try {
    const ergebnis = await lohnAufbewahrung(Date.now());
    if (ergebnis.fehler.length > 0) {
      // Einzelne Einträge sind gescheitert: sofort melden (ohne Inhalte, nur IDs).
      reportError('api/lohn-aufbewahrung', `${ergebnis.fehler.length} Eintrag/Einträge fehlgeschlagen`, {
        ids: ergebnis.fehler.map((f) => f.id),
        meldungen: ergebnis.fehler.map((f) => f.meldung).slice(0, 3),
      });
      res.status(500).json({ status: 'error', ...ergebnis }); return;
    }
    res.status(200).json({ status: 'ok', ...ergebnis });
  } catch (e) {
    sendError(res, e, 'api/lohn-aufbewahrung');
  }
}
