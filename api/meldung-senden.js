import { airtable, sendError, requireMitarbeiter, esc, handledPreflight, TABLES } from './_lib.js';

const MELDUNGEN = 'tblnl3Zc4L1OLTNkH'; // Tabelle "Meldungen" (ID statt Name)

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST erlaubt' });
    return;
  }
  try {
    // Auth: nur eingeloggte Mitarbeiter dürfen Meldungen anlegen.
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;
    const mitarbeiterName = (ma.fields && ma.fields.Name) || '';

    const { typ, patientId, besuchId, notiz } = req.body || {};

    const fields = {
      Mitarbeiter: mitarbeiterName, // aus Token abgeleitet, nicht fälschbar
      Typ: typ || 'Sonstiges',
      Status: 'Neu',
    };

    // Wenn ein Einsatz mitgegeben wird: prüfen, dass er dem Mitarbeiter gehört (IDOR-Schutz).
    if (besuchId) {
      if (!/^rec[A-Za-z0-9]{14,}$/.test(String(besuchId))) {
        res.status(400).json({ status: 'error', message: 'Ungültige besuchId' }); return;
      }
      const besuch = await airtable(`${TABLES.BESUCHE}/${besuchId}`).catch(() => null);
      const pflegerIds = (besuch && besuch.fields && besuch.fields.Pfleger_ID) || [];
      const gehoert = Array.isArray(pflegerIds)
        ? pflegerIds.map(String).includes(ma.id)
        : String(pflegerIds) === ma.id;
      if (!besuch || !gehoert) {
        res.status(403).json({ status: 'error', message: 'Kein Zugriff auf diesen Einsatz' }); return;
      }
      fields.Einsatz = [besuchId];
      // Patient sicher aus dem Einsatz übernehmen, nicht aus dem Body.
      const p = (besuch.fields && besuch.fields.Patient) || [];
      if (p[0]) fields.Patient = [p[0]];
    } else if (patientId && /^rec[A-Za-z0-9]{14,}$/.test(String(patientId))) {
      fields.Patient = [patientId];
    }

    if (notiz) fields.Notiz = String(notiz).slice(0, 2000);

    const data = await airtable(MELDUNGEN, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    res.status(200).json({ status: 'success', id: data.id });
  } catch (e) {
    sendError(res, e, 'api/meldung-senden');
  }
}
