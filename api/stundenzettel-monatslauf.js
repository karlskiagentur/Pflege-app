import { airtable, fetchAll, sendError, esc, TABLES } from './_lib.js';

// Vercel-Cron (täglich): legt am LETZTEN Tag des Monats je aktivem Mitarbeiter eine
// Stundenzettel-Zeile mit Status "Erstellen" an. Die bestehende Airtable-Automation
// "Stundenzettel erstellen" (Status = Erstellen) erzeugt daraus je Zeile das PDF ins
// Feld Datei. Manuelles Erstellen (Büro setzt Status) bleibt unberührt.
const ZETTEL = 'tblmlg9ZNrtwRxmXx';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Heutiges Datum in Europe/Berlin als {y, m, d} (m: 1-12).
function berlinHeute() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t) => Number(p.find((x) => x.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export default async function handler(req, res) {
  // Auth: Vercel-Cron schickt "Authorization: Bearer <CRON_SECRET>" (wenn CRON_SECRET
  // gesetzt ist). Fehlt das Secret oder passt es nicht -> ablehnen (fail closed).
  const secret = process.env.CRON_SECRET;
  if (!secret || String(req.headers.authorization || '') !== `Bearer ${secret}`) {
    res.status(401).json({ status: 'error' }); return;
  }
  try {
    const { y, m, d } = berlinHeute();
    const letzterTag = new Date(Date.UTC(y, m, 0)).getUTCDate(); // Tag 0 des Folgemonats = letzter Tag von m
    const force = req.query && req.query.force === '1';          // manueller Testlauf trotz Nicht-Monatsende
    if (d !== letzterTag && !force) {
      res.status(200).json({ status: 'skipped', grund: 'nicht der letzte Tag des Monats', tag: d, letzterTag }); return;
    }

    const monatName = `${MONATE[m - 1]} ${y}`; // "August 2026" (passt zu Monat_Auswahl)

    // Aktive Mitarbeiter
    const personal = await fetchAll(TABLES.PERSONAL, 'fields%5B%5D=Aktiv');
    const aktive = personal.filter((p) => p.fields && p.fields.Aktiv);

    // Doppel-Schutz: Mitarbeiter, die für diesen Monat schon eine Zeile haben, überspringen.
    const vorhanden = await fetchAll(ZETTEL, `filterByFormula=${encodeURIComponent(`{Monat_Auswahl} = '${esc(monatName)}'`)}`);
    const schonDa = new Set(vorhanden.flatMap((z) => (z.fields && z.fields.Mitarbeiter_ID) || []).map(String));

    let angelegt = 0;
    for (const ma of aktive) {
      if (schonDa.has(String(ma.id))) continue;
      await airtable(ZETTEL, {
        method: 'POST',
        body: JSON.stringify({
          fields: { Mitarbeiter: [ma.id], Monat_Auswahl: monatName, Status: 'Erstellen' },
          typecast: true, // legt die Monats-Option an, falls noch nicht vorhanden
        }),
      });
      angelegt++;
    }

    res.status(200).json({ status: 'ok', monat: monatName, aktive: aktive.length, angelegt });
  } catch (e) {
    sendError(res, e, 'api/stundenzettel-monatslauf');
  }
}
