import { timingSafeEqual } from 'node:crypto';
import { airtable, fetchAll, sendError, reportError, esc, TABLES } from './_lib.js';
import { wochenBereich, wocheZuDatum, BESUCHE_FELDER } from './_dienstplan.js';
import { baueWoche, erstelleWochenuebersichtPdf, mitAnrede } from './_wochenuebersicht.js';
import { neuesteZuerst } from './stundenzettel.js';

// Interner Hook (Airtable-Automation "Status = Erstellen" -> Webhook), KEIN Session-Token-Flow:
// Auth über das gemeinsame Secret im Header X-Hook-Secret (gleiche Env wie der Stundenzettel).
// Erzeugt den Wochendienstplan ALLER Mitarbeiter als PDF (A4 quer) und hängt ihn an die Zeile
// der Tabelle "Wochendienstplan". Layout und Fachregeln: api/_wochenuebersicht.js.
//
// Der Endpoint liefert NIE Daten zurück, nur Status-JSON (das Blatt ist vertraulich).

const WOCHENPLAN = 'Wochendienstplan';  // Tabellenname (die ID trägt Claude nach dem Anlegen nach)
const DATEI_FELD = 'Datei';             // Anhang-Feld (uploadAttachment akzeptiert Feldnamen)

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_TOKEN = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;

/** Zeitkonstanter Vergleich des Hook-Secrets; fehlendes Env lehnt ebenfalls ab (nie offen). */
export function hookErlaubt(req) {
  const soll = String(process.env.STUNDENZETTEL_SECRET || '');
  const ist = String((req.headers && (req.headers['x-hook-secret'] || req.headers['X-Hook-Secret'])) || '');
  return soll.length >= 16 && ist.length === soll.length
    && timingSafeEqual(Buffer.from(ist), Buffer.from(soll));
}

/** "2026-11-09" + KW 46/2026 -> Dateiname "Wochendienstplan_2026-KW46.pdf" */
export const dateiname = (bereich) => `Wochendienstplan_${bereich.jahr}-KW${String(bereich.kw).padStart(2, '0')}.pdf`;

/** Airtable-Formel: alle Besuche der Woche (Datum im Bereich; ohne Mitarbeiter-Filter). */
export function wochenFormel(bereich) {
  const ab = `DATETIME_PARSE('${bereich.montag}', 'YYYY-MM-DD')`;
  const bis = `DATETIME_PARSE('${bereich.sonntag}', 'YYYY-MM-DD')`;
  return `AND({Datum}, IS_AFTER({Datum}, DATEADD(${ab}, -1, 'days')), IS_BEFORE({Datum}, DATEADD(${bis}, 1, 'days')))`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }
  if (!hookErlaubt(req)) { res.status(401).json({ status: 'error' }); return; }

  const recordId = String((req.body && req.body.recordId) || '');
  if (!/^rec[A-Za-z0-9]{14,}$/.test(recordId)) {
    res.status(400).json({ status: 'error', message: 'recordId nötig' }); return;
  }

  try {
    // 1) Zeile der Tabelle "Wochendienstplan": Feld "Woche" (Datum) bestimmt die Woche;
    //    leer = laufende Woche.
    const zeile = await airtable(`${WOCHENPLAN}/${recordId}`);
    const zf = zeile.fields || {};
    const woche = String(zf.Woche || '').slice(0, 10);
    const bereich = /^\d{4}-\d{2}-\d{2}$/.test(woche) ? wocheZuDatum(woche) : wochenBereich(Date.now(), 0);

    // 2) Besuche der Woche (alle Mitarbeiter) + Personal. Nur die Felder, die das Blatt braucht.
    const felder = [...BESUCHE_FELDER, 'Pfleger_ID', 'Dauer_Ist', 'Ist_Stunden_Monat']
      .map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join('&');
    const [besuche, personal] = await Promise.all([
      fetchAll(TABLES.BESUCHE, `filterByFormula=${encodeURIComponent(wochenFormel(bereich))}&${felder}`),
      fetchAll(TABLES.PERSONAL, 'fields%5B%5D=Name&fields%5B%5D=Aktiv'),
    ]);

    // Anrede der Klienten (für „Fr./Hr. Nachname“ auf dem Blatt) – nur dieses eine Feld, nur
    // gelesen. Scheitert die Abfrage, entsteht das Blatt trotzdem (dann mit vollem Namen) und
    // der Betreiber bekommt einen Alarm.
    let patienten = [];
    try {
      patienten = (await fetchAll(TABLES.PATIENTEN, 'fields%5B%5D=Anrede')) || [];
    } catch (e) {
      try { reportError('api/wochenuebersicht', 'Anrede der Klienten nicht lesbar - Blatt mit vollem Namen erzeugt', { status: e && e.status }); } catch (_) { /* Alarm darf das Blatt nicht verhindern */ }
    }

    const jetzt = Date.now();
    const daten = baueWoche(mitAnrede(besuche, patienten), personal, bereich, jetzt);
    const stand = new Date(jetzt).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Berlin',
    });
    const bytes = await erstelleWochenuebersichtPdf({ ...daten, stand });

    // 3) PDF anhängen (uploadAttachment hängt hinten an, frühere Fassungen bleiben erhalten)
    const vorher = zf[DATEI_FELD] || [];
    const name = dateiname(bereich);
    const up = await fetch(`https://content.airtable.com/v0/${BASE}/${recordId}/${DATEI_FELD}/uploadAttachment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf', filename: name, file: Buffer.from(bytes).toString('base64') }),
    });
    if (!up.ok) {
      const e = new Error('Upload fehlgeschlagen');
      e.status = up.status;
      e.detail = await up.json().catch(() => ({}));
      throw e;
    }
    const nachher = (await up.json().catch(() => ({})))?.fields?.[DATEI_FELD] || [];

    // 4) Ergebnis in die Zeile schreiben: Titel, Stand, Status. Die neue Fassung nach vorne
    //    (uploadAttachment hängt hinten an; frühere bleiben als Anhang erhalten).
    const fields = {
      Titel: `Wochendienstplan KW ${bereich.kw}/${bereich.jahr}`,
      Stand: stand,
      Status: 'Erstellt',
    };
    const sortiert = neuesteZuerst(vorher, nachher);
    if (sortiert) fields[DATEI_FELD] = sortiert;
    await airtable(`${WOCHENPLAN}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    });

    // Bewusst keine Plandaten in der Antwort - nur Status (das Blatt ist vertraulich).
    res.status(200).json({
      status: 'success', kw: bereich.kw, jahr: bereich.jahr,
      mitarbeiter: daten.mitarbeiter.length, seiten: Math.max(1, Math.ceil(daten.mitarbeiter.length / 4)),
    });
  } catch (e) {
    // Status -> Fehler (best effort), dann Standard-Fehlerpfad (Alarm-Mail, 429 -> 503,
    // keine Airtable-Details an den Aufrufer).
    try {
      await airtable(`${WOCHENPLAN}/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { Status: 'Fehler' }, typecast: true }),
      });
    } catch (_) { /* Statuspflege darf den Fehlerpfad nicht stören */ }
    sendError(res, e, 'api/wochenuebersicht');
  }
}
