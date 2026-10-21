import { airtable, fetchAll, sendError, esc, TABLES } from './_lib.js';

// Vercel-Cron (täglich): am 1. eines Monats wird der VORMONAT abgeschlossen. Erst dann liegen
// alle Termine des Monats in der Vergangenheit (Regel: auf dem Stundenzettel zählt nur
// Vergangenes - siehe api/_zeitkonto.js).
// - Je aktivem Mitarbeiter mit Einsätzen im Vormonat wird eine Stundenzettel-Zeile mit Status
//   "Erstellen" angelegt; die Airtable-Automation "Stundenzettel erstellen" erzeugt das PDF.
// - Bereits vorhandene Zeilen des Vormonats ohne finalen Zettel (nur VORLÄUFIG, während des
//   Monats erstellt, oder aus der Vorversion) oder mit Status "Fehler" werden neu erzeugt
//   (Status -> "Erstellen"). Frühere Fassungen bleiben als Anhang erhalten (archivieren statt löschen).
// Manuelles Erstellen durch das Büro (Status setzen) bleibt jederzeit möglich.
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
    const force = req.query && req.query.force === '1'; // manueller Testlauf an einem anderen Tag
    if (d !== 1 && !force) {
      res.status(200).json({ status: 'skipped', grund: 'nicht der 1. des Monats', tag: d }); return;
    }

    // Abzuschließender Monat = Vormonat
    const vy = m === 1 ? y - 1 : y;
    const vm = m === 1 ? 12 : m - 1;
    const monatName = `${MONATE[vm - 1]} ${vy}`;                 // "Oktober 2026" (passt zu Monat_Auswahl)
    const monatKey = `${vy}-${String(vm).padStart(2, '0')}`;     // passt zur Formel {Monat} (YYYY-MM)

    // Aktive Mitarbeiter
    const personal = await fetchAll(TABLES.PERSONAL, 'fields%5B%5D=Aktiv');
    const aktive = personal.filter((p) => p.fields && p.fields.Aktiv);

    // Nur wer im Monat mindestens einen (nicht abgesagten) Einsatz im Dienstplan hatte,
    // bekommt einen Stundenzettel (sonst entstünden 0-Stunden-Zettel für alle, die noch
    // nicht über den digitalen Dienstplan laufen).
    const einsaetze = await fetchAll(
      TABLES.BESUCHE,
      `filterByFormula=${encodeURIComponent(`AND({Monat} = '${monatKey}', {Status} != 'Abgesagt')`)}&fields%5B%5D=Pfleger_ID`
    );
    const mitEinsatz = new Set(einsaetze.flatMap((b) => (b.fields && b.fields.Pfleger_ID) || []).map(String));
    const zuErstellen = aktive.filter((p) => mitEinsatz.has(String(p.id)));

    // Vorhandene Zeilen des Monats: fertige (finaler Zettel vorhanden) bleiben unberührt,
    // vorläufige/fehlgeschlagene werden neu erzeugt, laufende ("Erstellen") abgewartet.
    // Fertig = Datei "Stundenzettel_YYYY-MM_final.pdf". Zettel der Vorversion hießen auch
    // mitten im Monat "Stundenzettel_YYYY-MM.pdf" - die gelten bewusst NICHT als fertig.
    const vorhanden = await fetchAll(ZETTEL, `filterByFormula=${encodeURIComponent(`{Monat_Auswahl} = '${esc(monatName)}'`)}`);
    const schonDa = new Set(vorhanden.flatMap((z) => (z.fields && z.fields.Mitarbeiter_ID) || []).map(String));
    const finalName = `Stundenzettel_${monatKey}_final.pdf`;
    let neuErzeugt = 0;
    for (const z of vorhanden) {
      const f = z.fields || {};
      if (f.Status === 'Erstellen') continue;
      const hatFinal = (f.Datei || []).some((a) => a && a.filename === finalName);
      if (hatFinal && f.Status === 'Erstellt') continue;
      await airtable(`${ZETTEL}/${z.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { Status: 'Erstellen' }, typecast: true }),
      });
      neuErzeugt++;
    }

    let angelegt = 0;
    for (const ma of zuErstellen) {
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

    res.status(200).json({
      status: 'ok', monat: monatName, aktive: aktive.length,
      mitEinsatz: zuErstellen.length, ohneEinsatz: aktive.length - zuErstellen.length, angelegt, neuErzeugt,
    });
  } catch (e) {
    sendError(res, e, 'api/stundenzettel-monatslauf');
  }
}
