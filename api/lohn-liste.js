import { airtable, sendError, requireMitarbeiter, esc, handledPreflight } from './_lib.js';

const ZETTEL = 'tblmlg9ZNrtwRxmXx'; // Tabelle "Stundenzettel" (ID statt Name -> umbenenn-fest)

// Single-Select "Monat_Auswahl" ("August 2026") -> "YYYY-MM"; sonst leer.
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const ymAusAuswahl = (s) => {
  const m = /^([A-Za-zÄÖÜäöüß]+)\s+(\d{4})$/.exec(String(s || '').trim());
  const i = m ? MONATE.indexOf(m[1]) : -1;
  return i < 0 ? '' : `${m[2]}-${String(i + 1).padStart(2, '0')}`;
};

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
        // Monat bevorzugt aus Monat_Auswahl ("August 2026"), sonst aus dem Datumsfeld Monat -> "YYYY-MM".
        const ym = ymAusAuswahl(f.Monat_Auswahl) ||
          (/^\d{4}-\d{2}/.test(String(f.Monat || '')) ? String(f.Monat).slice(0, 7) : '');
        const la = (f.Lohnabrechnung || [])[0] || null;  // Lohnabrechnung (Büro-Upload)
        return {
          id: r.id,
          ym,
          monat: /^\d{4}-\d{2}$/.test(ym) ? `${ym.slice(5, 7)}.${ym.slice(0, 4)}` : ym,
          summe: f.Summe_Stunden || '',
          lohnabrechnung: la ? { name: la.filename, url: la.url } : null,
        };
      })
      // In der App erscheint eine Abrechnung NUR, wenn das Büro die Lohnabrechnung
      // manuell hochgeladen hat. Der Stundenzettel (Feld Datei) wird nie gelesen/
      // ausgeliefert - er bleibt PC/Airtable-intern.
      .filter((z) => z.lohnabrechnung);

    liste.sort((a, b) => b.ym.localeCompare(a.ym));
    res.status(200).json(liste.map(({ ym, ...rest }) => rest));
  } catch (e) {
    sendError(res, e, 'api/lohn-liste');
  }
}
