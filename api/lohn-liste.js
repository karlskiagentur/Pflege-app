import { airtable, sendError, requireMitarbeiter, esc, handledPreflight } from './_lib.js';

const ZETTEL = 'tblmlg9ZNrtwRxmXx'; // Tabelle "Stundenzettel" (ID statt Name -> umbenenn-fest)

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    // Auth: Mitarbeiter über Session-Token; Lohndaten nur für den eigenen Datensatz.
    const ma = await requireMitarbeiter(req, res);
    if (!ma) return;

    // Filter über das Lookup-Feld Mitarbeiter_ID (== Personal-Record-ID),
    // die ID kommt aus dem geprüften Token, nicht aus dem Body.
    const formula = encodeURIComponent(`{Mitarbeiter_ID} = '${esc(ma.id)}'`);
    const data = await airtable(`${ZETTEL}?filterByFormula=${formula}`);

    const liste = (data.records || [])
      .map((r) => {
        const f = r.fields || {};
        const monatRaw = String(f.Monat || '');
        const sz = (f.Datei || [])[0] || null;           // Stundenzettel-PDF (automatisch)
        const la = (f.Lohnabrechnung || [])[0] || null;  // Lohnabrechnung (Büro-Upload)
        return {
          id: r.id,
          monatRaw,
          monat: /^\d{4}-\d{2}/.test(monatRaw) ? `${monatRaw.slice(5, 7)}.${monatRaw.slice(0, 4)}` : monatRaw,
          summe: f.Summe_Stunden || '',
          stundenzettel: sz ? { name: sz.filename, url: sz.url } : null,
          lohnabrechnung: la ? { name: la.filename, url: la.url } : null,
        };
      })
      // Zeilen ganz ohne Datei sind für den Mitarbeiter noch nicht relevant.
      .filter((z) => z.stundenzettel || z.lohnabrechnung);

    liste.sort((a, b) => b.monatRaw.localeCompare(a.monatRaw));
    res.status(200).json(liste.map(({ monatRaw, ...rest }) => rest));
  } catch (e) {
    sendError(res, e, 'api/lohn-liste');
  }
}
