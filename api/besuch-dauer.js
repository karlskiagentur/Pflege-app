import { airtable, sendError, requireMitarbeiter, handledPreflight, TABLES } from './_lib.js';

// Der Pfleger erfasst nach dem Termin die TATSÄCHLICHE Dauer (Minuten).
// JSON: { token, besuchId, minuten }. Grundlage für die Monatsabrechnung.
export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }
  try {
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;

    const { besuchId, minuten } = req.body || {};
    if (!/^rec[A-Za-z0-9]{14,}$/.test(String(besuchId || ''))) {
      res.status(400).json({ status: 'error', message: 'besuchId nötig' }); return;
    }
    const min = Math.round(Number(minuten));
    if (!Number.isFinite(min) || min < 0 || min > 1440) {
      res.status(400).json({ status: 'error', message: 'Dauer muss 0-1440 Minuten sein' }); return;
    }

    // Eigentum: der Einsatz muss diesem Pfleger gehören (Haupt- ODER Ersatz-Pfleger).
    const besuch = await airtable(`${TABLES.BESUCHE}/${besuchId}`).catch(() => null);
    const f = (besuch && besuch.fields) || {};
    const idsFrom = (v) => (Array.isArray(v) ? v.map((x) => (x && x.id) ? x.id : x).map(String) : []);
    const owns = idsFrom(f.Pfleger).includes(ma.id) || idsFrom(f.Pfleger_Ersatz).includes(ma.id);
    if (!besuch || !owns) {
      res.status(403).json({ status: 'error', message: 'Kein Zugriff auf diesen Einsatz' }); return;
    }

    // Dauer_Ist ist ein Dauer-Feld (Airtable speichert Sekunden). Der Pfleger erfasst
    // Minuten -> in Sekunden umrechnen, damit Interface (h:mm) und Monatsformel stimmen.
    await airtable(`${TABLES.BESUCHE}/${besuchId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { Dauer_Ist: min * 60, Erledigt_Am: new Date().toISOString() } }),
    });
    res.status(200).json({ status: 'success' });
  } catch (e) {
    sendError(res, e, 'api/besuch-dauer');
  }
}
