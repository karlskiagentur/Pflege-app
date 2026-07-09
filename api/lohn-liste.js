import { airtable, sendError, requireMitarbeiter, esc, handledPreflight } from './_lib.js';

const LOHN = 'tblMoak6mpdJtTM8S'; // Tabelle "Lohnabrechnung" (ID statt Name -> umbenenn-fest)

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    // Auth: Mitarbeiter über Session-Token; Lohndaten nur für den eigenen Datensatz.
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;
    const mitarbeiterId = ma.id;

    // Filter unverändert über das Lookup-Feld Mitarbeiter_ID (== Personal-Record-ID);
    // neu ist nur: die ID kommt aus dem geprüften Token, nicht aus dem Body.
    const formula = encodeURIComponent(`{Mitarbeiter_ID} = '${esc(mitarbeiterId)}'`);
    const data = await airtable(`${LOHN}?filterByFormula=${formula}`);

    const liste = (data.records || []).map(r => {
      const files = (r.fields && r.fields.Datei) || [];
      const file = files[0] || null;
      return {
        id: r.id,
        zeitraum: (r.fields && r.fields.Zeitraum) || '',
        dateiname: file ? file.filename : 'Datei',
        url: file ? file.url : '',
      };
    });
    liste.sort((a, b) => new Date(b.zeitraum).getTime() - new Date(a.zeitraum).getTime());
    res.status(200).json(liste);
  } catch (e) {
    sendError(res, e, 'api/lohn-liste');
  }
}
