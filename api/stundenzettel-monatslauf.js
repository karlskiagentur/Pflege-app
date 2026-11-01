import { airtable, fetchAll, sendError, esc, cronErlaubt, TABLES } from './_lib.js';
import { abgeschlossenerMonat, abrechnungszeitraum, ersterTagDesZeitraums, imZeitraum, zeitraumText } from './_abrechnung.js';

// Vercel-Cron (täglich): Am ersten Tag eines Abrechnungsmonats wird der vorige abgeschlossen –
// seit November 2026 am 27. (Zeitraum 27. bis 26., api/_abrechnung.js; der Übergangsmonat
// November 2026 läuft vom 01.11. bis 26.11. und wird am 27.11. abgeschlossen). Erst dann liegen
// alle Termine des Zeitraums in der Vergangenheit (Regel: auf dem Stundenzettel zählt nur
// Vergangenes - siehe api/_zeitkonto.js).
// - Je aktivem Mitarbeiter mit Einsätzen im Zeitraum wird eine Stundenzettel-Zeile mit Status
//   "Erstellen" angelegt; die Airtable-Automation "Stundenzettel erstellen" erzeugt das PDF.
// - Bereits vorhandene Zeilen des Monats ohne finalen Zettel (nur VORLÄUFIG, während des
//   Zeitraums erstellt, oder aus der Vorversion) oder mit Status "Fehler" werden neu erzeugt
//   (Status -> "Erstellen"). Frühere Fassungen bleiben als Anhang erhalten (archivieren statt löschen).
// Manuelles Erstellen durch das Büro (Status setzen) bleibt jederzeit möglich.
const ZETTEL = 'tblmlg9ZNrtwRxmXx';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Heutiges Datum in Europe/Berlin als 'YYYY-MM-DD'.
function berlinHeute() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export default async function handler(req, res) {
  // Auth: nur Vercel-Cron mit CRON_SECRET (fehlt das Secret in Vercel -> Alarm), siehe _lib.js.
  if (!cronErlaubt(req, res, 'api/stundenzettel-monatslauf')) return;
  try {
    const heute = berlinHeute();
    const force = req.query && req.query.force === '1'; // manueller Lauf an einem anderen Tag
    if (!ersterTagDesZeitraums(heute) && !force) {
      res.status(200).json({ status: 'skipped', grund: 'kein Abrechnungsstichtag', tag: heute }); return;
    }

    // Abzuschließen ist der Abrechnungsmonat vor dem laufenden.
    const monatKey = abgeschlossenerMonat(heute);                                         // "2026-12"
    const monatName = `${MONATE[Number(monatKey.slice(5, 7)) - 1]} ${monatKey.slice(0, 4)}`; // "Dezember 2026" (= Monat_Auswahl)
    const zeitraum = abrechnungszeitraum(monatKey);                                       // 27.11.–26.12.2026

    // Aktive Mitarbeiter
    const personal = await fetchAll(TABLES.PERSONAL, 'fields%5B%5D=Aktiv');
    const aktive = personal.filter((p) => p.fields && p.fields.Aktiv);

    // Nur wer im Zeitraum mindestens einen (nicht abgesagten) Einsatz im Dienstplan hatte,
    // bekommt einen Stundenzettel (sonst entstünden 0-Stunden-Zettel für alle, die noch
    // nicht über den digitalen Dienstplan laufen). Grob über {Monat} (der Zeitraum berührt
    // höchstens zwei Kalendermonate), genau über das Datum.
    const monate = [...new Set([zeitraum.von.slice(0, 7), zeitraum.bis.slice(0, 7)])];
    const formel = `AND(OR(${monate.map((m) => `{Monat} = '${esc(m)}'`).join(', ')}), {Status} != 'Abgesagt')`;
    const einsaetze = await fetchAll(
      TABLES.BESUCHE,
      `filterByFormula=${encodeURIComponent(formel)}&fields%5B%5D=Pfleger_ID&fields%5B%5D=Datum`
    );
    const mitEinsatz = new Set(einsaetze
      .filter((b) => imZeitraum(b.fields && b.fields.Datum, zeitraum))
      .flatMap((b) => (b.fields && b.fields.Pfleger_ID) || []).map(String));
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
      status: 'ok', monat: monatName, zeitraum: zeitraumText(zeitraum), aktive: aktive.length,
      mitEinsatz: zuErstellen.length, ohneEinsatz: aktive.length - zuErstellen.length, angelegt, neuErzeugt,
    });
  } catch (e) {
    sendError(res, e, 'api/stundenzettel-monatslauf');
  }
}
