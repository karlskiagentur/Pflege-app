import { sendError, requireMitarbeiter, handledPreflight, TABLES } from './_lib.js';
import { aboEndpoint, aboSpeichern, endpointGueltig } from './_abo.js';

// Speichert das Push-Abo des eingeloggten Mitarbeiters – Datensatz wird über
// den Session-Token ermittelt (nicht über eine frei setzbare mitarbeiterId).
// Ein Gerät gehört immer nur dem zuletzt angemeldeten Konto: dasselbe Gerät wird bei
// allen anderen Konten (Klienten und Mitarbeiter) entfernt, siehe api/_abo.js.
const MAX_ABO_LAENGE = 4000;

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;

    const { subscription } = req.body || {};
    if (!subscription || typeof subscription !== 'object') {
      res.status(400).json({ status: 'error', message: 'subscription nötig' }); return;
    }
    if (!endpointGueltig(aboEndpoint(subscription)) || JSON.stringify(subscription).length > MAX_ABO_LAENGE) {
      res.status(400).json({ status: 'error', message: 'Ungültiges Push-Abo' }); return;
    }

    await aboSpeichern(TABLES.PERSONAL, ma, subscription);
    res.status(200).json({ status: 'success' });
  } catch (e) {
    sendError(res, e, 'api/abo-pfleger');
  }
}
