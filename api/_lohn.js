// Lohnabrechnungen der Mitarbeiter (Tabelle "Lohnabrechnung").
// Das Büro lädt je Mitarbeiter und Monat eine Datei hoch (Interface-Seite
// "Mitarbeiter (Lohnabrechnung)"); sie erscheint sofort in der Mitarbeiter-App unter
// "Lohn / Zeit", der Mitarbeiter bekommt einen Push. Den Monat wählt das Büro im
// Auswahlfeld "Monat" ("Oktober 2026"); ältere Einträge nutzen noch das Datum "Zeitraum".
//
// Aufbewahrung (Vorgabe Pflegedienst, 22.10.2026):
// 1. Die Datei steht 3 Monate ab dem Hochladen (Berliner Kalendertag) bereit.
// 2. 7 Tage vor der Löschung bekommt der Mitarbeiter eine Erinnerung per Push.
// 3. Danach wird die Datei automatisch gelöscht. Der Eintrag bleibt als Nachweis erhalten
//    (Status "Archiviert", Datei_Gelöscht_Am) - nur die Datei verschwindet.
// 4. Gelöscht wird nie ohne Vorwarnung: frühestens 7 Tage nach der Erinnerung. Fällt der
//    tägliche Lauf einmal aus, verschiebt sich die Löschung entsprechend.
// 5. Setzt das Büro den Status selbst auf "Archiviert" (z. B. falsche Datei), verschwindet
//    der Eintrag sofort aus der App; die Datei wird beim nächsten Tageslauf gelöscht.
// 6. Ersetzt oder ergänzt das Büro die Datei eines Eintrags (z. B. Korrekturabrechnung),
//    gilt sie als neu hochgeladen: neue 3 Monate, eigene Erinnerung vor der Löschung und -
//    stammt die letzte Meldung von einem früheren Tag - ein neuer Push beim Tageslauf.
//
// Routen: lohn-liste (App-Liste), lohn-download (Datei), push-event type "lohnabrechnung"
// (Push beim Hochladen, ausgelöst von der Airtable-Automation), lohn-aufbewahrung (Cron).

import { airtable, fetchAll, TABLES } from './_lib.js';
import { pushAnMitarbeiter } from './_push.js';

export const LOHN = 'tblMoak6mpdJtTM8S';   // Tabelle "Lohnabrechnung" (ID -> umbenenn-fest)
export const ARCHIVIERT = 'Archiviert';
export const AUFBEWAHRUNG_MONATE = 3;
export const ERINNERUNG_TAGE = 7;
export const NACHHOL_TAGE = 3;             // verpasster Upload-Push wird bis zu 3 Tage nachgeholt
const TITEL = 'Wunschlos Pflege';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// --- Datum (Kalendertage in Europe/Berlin, Format YYYY-MM-DD) -----------------------

export function berlinDatum(zeitpunkt) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(zeitpunkt));
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function plusTage(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monate addieren; gibt es den Tag im Zielmonat nicht, gilt dessen letzter Tag
// (30.11. + 3 Monate = 28.02. bzw. 29.02.) - wie DATEADD in Airtable.
export function plusMonate(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const ziel = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const letzter = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0, 12)).getUTCDate();
  ziel.setUTCDate(Math.min(d, letzter));
  return ziel.toISOString().slice(0, 10);
}

export function tageZwischen(von, bis) {
  return Math.round((Date.parse(`${bis}T12:00:00Z`) - Date.parse(`${von}T12:00:00Z`)) / 86400000);
}

export const datumDe = (ymd) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
const spaeter = (a, b) => (a > b ? a : b); // YYYY-MM-DD lässt sich als Text vergleichen

// Airtable liefert Select-/Link-Werte mal als Text, mal als Objekt, mal als Array.
const text = (v) => {
  if (Array.isArray(v)) return text(v[0]);
  if (v && typeof v === 'object') return String(v.name || '');
  return v === undefined || v === null ? '' : String(v);
};
const ersterLink = (v) => (Array.isArray(v) ? v[0] : v) || null;

// "2026-10-01" (beliebiger Tag des Monats) -> "Oktober 2026"; ohne Zeitraum leer.
export function monatName(zeitraum) {
  const m = /^(\d{4})-(\d{2})/.exec(String(zeitraum || ''));
  return m ? `${MONATE[Number(m[2]) - 1]} ${m[1]}` : '';
}

// Monat eines Eintrags: bevorzugt aus der Auswahl "Monat" ("Oktober 2026"), sonst aus dem
// Datum "Zeitraum" (ältere Einträge). Ergebnis { name: 'Oktober 2026', ym: '2026-10' } oder
// leere Werte, wenn keins von beiden passt.
export function monatDesEintrags(f) {
  const a = /^(\S+)\s+(\d{4})$/.exec(text(f && f.Monat).trim());
  const i = a ? MONATE.indexOf(a[1]) : -1;
  if (i >= 0) return { name: `${MONATE[i]} ${a[2]}`, ym: `${a[2]}-${String(i + 1).padStart(2, '0')}` };
  const d = /^(\d{4})-(\d{2})/.exec(String((f && f.Zeitraum) || ''));
  return d ? { name: monatName(f.Zeitraum), ym: `${d[1]}-${d[2]}` } : { name: '', ym: '' };
}

// --- Fachlicher Zustand eines Eintrags --------------------------------------------

export function lohnZustand(rec, jetzt) {
  const f = (rec && rec.fields) || {};
  const dateien = (Array.isArray(f.Datei) ? f.Datei : []).filter((a) => a && a.url);
  const archiviert = text(f.Status) === ARCHIVIERT;
  // Hochgeladen_Am = "zuletzt geändert" des Felds Datei; Rückfall: Anlagezeitpunkt.
  const basis = f.Hochgeladen_Am || (rec && rec.createdTime) || null;
  const hochgeladen = basis ? berlinDatum(basis) : null;
  const heute = berlinDatum(jetzt);
  const geplant = hochgeladen ? plusMonate(hochgeladen, AUFBEWAHRUNG_MONATE) : null;
  // Vermerke gelten nur für die aktuelle Datei (Regel 6). Eine Erinnerung wird nie vor
  // "geplant - 7 Tage" gesendet; eine ältere gehört also zu einer ersetzten Datei. Ein Push
  // zählt ab dem Upload-Tag. Verglichen wird nach Kalendertagen, damit Sekunden-Abstände
  // zwischen Zeitstempeln nichts auslösen.
  const erinnertAm = f.Erinnerung_Gesendet_Am ? berlinDatum(f.Erinnerung_Gesendet_Am) : null;
  const erinnert = erinnertAm && geplant && erinnertAm >= plusTage(geplant, -ERINNERUNG_TAGE) ? erinnertAm : null;
  const gepushtAm = f.Push_Gesendet_Am ? berlinDatum(f.Push_Gesendet_Am) : null;
  const loeschung = geplant && erinnert ? spaeter(geplant, plusTage(erinnert, ERINNERUNG_TAGE)) : geplant;
  const monat = monatDesEintrags(f);
  return {
    id: rec && rec.id,
    mitarbeiterId: ersterLink(f.Mitarbeiter),
    monatYm: monat.ym,
    monat: monat.name,
    dateien,
    archiviert,
    hochgeladen,
    heute,
    geplant,
    erinnert,
    loeschung,
    sichtbar: dateien.length > 0 && !archiviert,
    pushGesendet: Boolean(gepushtAm && (!hochgeladen || gepushtAm >= hochgeladen)),
  };
}

// Eintrag für die Mitarbeiter-App (ohne Datei-URLs: Download nur über lohn-download).
export function lohnFuerApp(rec, jetzt) {
  const z = lohnZustand(rec, jetzt);
  if (!z.sichtbar) return null;
  const tage = z.loeschung ? tageZwischen(z.heute, z.loeschung) : null;
  return {
    id: z.id,
    titel: z.monat ? `Lohnabrechnung ${z.monat}` : `Lohnabrechnung vom ${datumDe(z.hochgeladen)}`,
    monat: z.monat,
    dateien: z.dateien.map((a, nr) => ({ nr, name: String(a.filename || `Lohnabrechnung_${nr + 1}.pdf`) })),
    bereitgestellt: z.hochgeladen ? datumDe(z.hochgeladen) : '',
    loeschungAm: z.loeschung ? datumDe(z.loeschung) : '',
    tageBisLoeschung: tage,
    bald: tage !== null && tage <= ERINNERUNG_TAGE,
    sortierung: `${z.monatYm || (z.hochgeladen || '').slice(0, 7)}|${z.hochgeladen || ''}`,
  };
}

const uploadText = (z) =>
  `Neue Lohnabrechnung${z.monat ? ` für ${z.monat}` : ''} verfügbar – jetzt in der App unter „Lohn / Zeit“ ansehen.`;
const erinnerungText = (z, loeschAm) =>
  `Ihre Lohnabrechnung${z.monat ? ` ${z.monat}` : ''} wird am ${datumDe(loeschAm)} automatisch gelöscht. ` +
  'Bitte vorher in der App unter „Lohn / Zeit“ herunterladen.';

// Datensatz laden; 404 -> null (fachlich leer), echte Fehler werfen weiter.
async function ladeOderNull(pfad) {
  try {
    return await airtable(pfad);
  } catch (e) {
    if (e && e.status === 404) return null;
    throw e;
  }
}

const patch = (id, fields) =>
  airtable(`${LOHN}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields, typecast: true }) });

/**
 * Push beim Hochladen (ausgelöst von der Airtable-Automation über api/push-event).
 * Wirkt nur einmal je Eintrag (Push_Gesendet_Am) und nur für frische Uploads -
 * ein erneuter oder fremder Aufruf kann also keine weiteren Nachrichten erzeugen.
 */
export async function lohnUploadPush(recordId, jetzt) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(recordId || ''))) return { status: 'skipped', grund: 'Ungültige ID' };
  const rec = await ladeOderNull(`${LOHN}/${recordId}`);
  if (!rec) return { status: 'skipped', grund: 'Lohnabrechnung nicht gefunden' };
  const z = lohnZustand(rec, jetzt);
  if (z.pushGesendet) return { status: 'skipped', grund: 'Bereits benachrichtigt' };
  if (!z.sichtbar) return { status: 'skipped', grund: 'Keine Datei oder archiviert' };
  if (!z.mitarbeiterId) return { status: 'skipped', grund: 'Kein Mitarbeiter zugeordnet' };
  if (!z.hochgeladen || tageZwischen(z.hochgeladen, z.heute) > NACHHOL_TAGE) {
    return { status: 'skipped', grund: 'Upload zu alt' };
  }
  // Marker zuerst setzen: verhindert Doppel-Pushs bei zeitgleichen Auslösungen.
  await patch(recordId, { Push_Gesendet_Am: new Date(jetzt).toISOString() });
  const personal = await ladeOderNull(`${TABLES.PERSONAL}/${z.mitarbeiterId}`);
  if (!personal) return { status: 'skipped', grund: 'Mitarbeiter nicht gefunden' };
  const r = await pushAnMitarbeiter(personal, TITEL, uploadText(z));
  return r.gesendet ? { status: 'ok', gesendet: 1 } : { status: 'skipped', grund: r.grund, code: r.code };
}

/**
 * Täglicher Lauf (Vercel-Cron): Erinnerung 7 Tage vorher, Löschung nach 3 Monaten,
 * vom Büro archivierte Dateien löschen, verpasste Upload-Pushs nachholen.
 * Fehler einzelner Einträge brechen den Lauf nicht ab, sie werden gesammelt.
 */
export async function lohnAufbewahrung(jetzt) {
  const felder = ['Mitarbeiter', 'Monat', 'Zeitraum', 'Datei', 'Status', 'Hochgeladen_Am', 'Push_Gesendet_Am', 'Erinnerung_Gesendet_Am'];
  const records = await fetchAll(LOHN, felder.map((n) => `fields%5B%5D=${encodeURIComponent(n)}`).join('&'));
  const jetztIso = new Date(jetzt).toISOString();
  const ergebnis = { geprueft: 0, erinnert: 0, geloescht: 0, nachgeholt: 0, zustellung: [], fehler: [] };

  const personalCache = new Map();
  const personal = async (id) => {
    if (!personalCache.has(id)) personalCache.set(id, await ladeOderNull(`${TABLES.PERSONAL}/${id}`));
    return personalCache.get(id);
  };
  const pushen = async (z, textFuerPush) => {
    const p = z.mitarbeiterId ? await personal(z.mitarbeiterId) : null;
    const r = p ? await pushAnMitarbeiter(p, TITEL, textFuerPush) : { gesendet: false, grund: 'Kein Mitarbeiter' };
    if (!r.gesendet) ergebnis.zustellung.push({ id: z.id, grund: r.grund, code: r.code });
  };

  for (const rec of records) {
    try {
      const z = lohnZustand(rec, jetzt);
      if (z.dateien.length === 0) continue; // nichts (mehr) zu tun
      ergebnis.geprueft += 1;
      if (z.archiviert) {
        await patch(z.id, { Datei: [], 'Datei_Gelöscht_Am': jetztIso });
        ergebnis.geloescht += 1;
      } else if (!z.geplant) {
        // ohne Datum keine Fristen (kommt praktisch nicht vor: createdTime fehlt nie)
      } else if (!z.erinnert && z.heute >= plusTage(z.geplant, -ERINNERUNG_TAGE)) {
        // Erinnerung: erst senden, dann vermerken (fällt der Versand technisch aus,
        // wird er morgen wiederholt - und die Löschung wartet entsprechend).
        const loeschAm = spaeter(z.geplant, plusTage(z.heute, ERINNERUNG_TAGE));
        await pushen(z, erinnerungText(z, loeschAm));
        const fields = { Erinnerung_Gesendet_Am: jetztIso };
        if (!z.pushGesendet) fields.Push_Gesendet_Am = jetztIso;
        await patch(z.id, fields);
        ergebnis.erinnert += 1;
      } else if (z.erinnert && z.heute >= z.loeschung) {
        await patch(z.id, { Datei: [], Status: ARCHIVIERT, 'Datei_Gelöscht_Am': jetztIso });
        ergebnis.geloescht += 1;
      } else if (!z.pushGesendet && z.mitarbeiterId && tageZwischen(z.hochgeladen, z.heute) <= NACHHOL_TAGE) {
        // Upload-Push nachholen (z. B. Automation aus): Marker zuerst, wie beim Hochladen.
        await patch(z.id, { Push_Gesendet_Am: jetztIso });
        await pushen(z, uploadText(z));
        ergebnis.nachgeholt += 1;
      }
    } catch (e) {
      ergebnis.fehler.push({ id: rec && rec.id, meldung: String((e && e.message) || e) });
    }
  }
  return ergebnis;
}
