// Abrechnungszeitraum der Stundenzettel – EINE Regel für Server (Stundenzettel, Monatslauf) und
// Mitarbeiter-App (Reiter „Lohn / Zeit“). Reine Datumslogik ohne Abhängigkeiten: Die Datei wird
// auch ins App-Bundle übernommen (src/App.tsx) – hier nie etwas Server-Spezifisches importieren
// (tests/abrechnung.test.mjs prüft das). Typen für die App: api/_abrechnung.d.ts.
//
// Vorgabe Pflegedienst (01.11.2026): Ein Abrechnungsmonat läuft vom 27. des Vormonats bis zum 26.
// und heißt nach dem Monat, in dem er endet („Dezember 2026“ = 27.11.–26.12.2026). Am 27. früh ist
// der Zettel fertig (Monatslauf). Bis Oktober 2026 galten Kalendermonate; der Übergangsmonat
// November 2026 läuft vom 01.11. bis 26.11. – so zählt kein Tag doppelt und keiner fehlt.
// Alle Daten sind ISO-Kalenderdaten ('YYYY-MM-DD', deutsche Zeit), Monate 'YYYY-MM'.

export const ERSTER_STICHTAG_MONAT = '2026-11'; // erster Abrechnungsmonat, der am 26. endet
export const STICHTAG = 26;                     // letzter Tag eines Abrechnungsmonats

const pad = (n) => String(n).padStart(2, '0');
const istMonat = (ym) => typeof ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
const istDatum = (d) => typeof d === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d);

// Letzter Kalendertag eines Monats (28–31).
const letzterTag = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

/** 'YYYY-MM' um n Monate verschieben (n darf negativ sein). */
export function monatPlus(ym, n) {
  const index = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${pad((((index % 12) + 12) % 12) + 1)}`;
}

/**
 * Zeitraum eines Abrechnungsmonats (beide Tage einschließlich).
 * @param {string} ym 'YYYY-MM' – der Monat, in dem der Zeitraum endet
 * @returns {{von: string, bis: string}}
 */
export function abrechnungszeitraum(ym) {
  if (!istMonat(ym)) throw new Error('Ungültiger Abrechnungsmonat');
  if (ym < ERSTER_STICHTAG_MONAT) return { von: `${ym}-01`, bis: `${ym}-${pad(letzterTag(ym))}` };
  const bis = `${ym}-${pad(STICHTAG)}`;
  if (ym === ERSTER_STICHTAG_MONAT) return { von: `${ym}-01`, bis };
  return { von: `${monatPlus(ym, -1)}-${pad(STICHTAG + 1)}`, bis };
}

/** Abrechnungsmonat ('YYYY-MM'), zu dem ein Datum gehört; '' bei ungültigem Datum. */
export function abrechnungsmonatFuer(datum) {
  if (!istDatum(datum)) return '';
  const ym = datum.slice(0, 7);
  if (ym < ERSTER_STICHTAG_MONAT) return ym;
  return Number(datum.slice(8, 10)) > STICHTAG ? monatPlus(ym, 1) : ym;
}

/** Liegt das Datum ('YYYY-MM-DD') im Zeitraum? Ungültige Daten liegen nie darin. */
export function imZeitraum(datum, zeitraum) {
  return istDatum(datum) && !!zeitraum && datum >= zeitraum.von && datum <= zeitraum.bis;
}

/** „01.11.–26.11.2026“; über den Jahreswechsel „27.12.2026–26.01.2027“. */
export function zeitraumText(zeitraum) {
  const tag = (iso, mitJahr) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${mitJahr ? iso.slice(0, 4) : ''}`;
  const gleichesJahr = zeitraum.von.slice(0, 4) === zeitraum.bis.slice(0, 4);
  return `${tag(zeitraum.von, !gleichesJahr)}–${tag(zeitraum.bis, true)}`;
}

/** Beginnt an diesem Tag ein neuer Abrechnungsmonat? (Dann schließt der Monatslauf den vorigen ab.) */
export function ersterTagDesZeitraums(heute) {
  const ym = abrechnungsmonatFuer(heute);
  return !!ym && abrechnungszeitraum(ym).von === heute;
}

/** Jüngster abgeschlossener Abrechnungsmonat am Tag `heute` – der vor dem laufenden. */
export function abgeschlossenerMonat(heute) {
  const ym = abrechnungsmonatFuer(heute);
  if (!ym) throw new Error('Ungültiges Datum');
  return monatPlus(ym, -1);
}

// Urlaub, Gleitzeit, Krank, Abwesend – wie in üblichen Betrieben (Vorgabe Karl 07.11.2026):
// - Urlaub:    Das Büro trägt die Stunden des Tages ein (Spalte „Stunden Urlaub/Gleitzeit“).
//              Bezahlt – zählt auf dem Stundenzettel zur Monatssumme.
// - Gleitzeit: Das Büro trägt die Stunden ein. Freizeitausgleich aus dem Zeitkonto – steht auf dem
//              Stundenzettel, zählt aber NICHT zur Monatssumme (die Stunden wurden schon gearbeitet,
//              sonst wären sie doppelt bezahlt).
// - Krank:     nur der Tag, keine Stunden („–“) – die Lohnfortzahlung rechnet das Lohnbüro.
// - Abwesend und jede andere Art: nur der Tag, keine Stunden („–“).
// Stunden gelten genau so, wie eingetragen (ganze Minuten, kein 15-Minuten-Takt, z. B. 7:42).
// Von/Bis einer Abwesenheit ist nur das Zeitfenster und zählt nie. Keine Art zählt je zu den
// geplanten, verplanten oder verkauften Stunden. Ob eine Zeile eine Abwesenheit ist (eigene Zeile
// ohne Klient), prüft der Aufrufer (api/_zeitkonto.js, src/App.tsx).
export const ABWESENHEIT_STUNDEN_FELD = 'Stunden Urlaub/Gleitzeit';
export const ABWESENHEIT_STUNDEN_MAX_MIN = 24 * 60; // mehr als ein ganzer Tag ist ein Tippfehler
export const ABWESENHEIT_MIT_STUNDEN = ['Urlaub', 'Gleitzeit']; // hier trägt das Büro Stunden ein
export const ABWESENHEIT_BEZAHLT = ['Urlaub'];                  // diese Stunden zählen zur Monatssumme

const artText = (a) => String(a || '').trim();
/** Trägt das Büro für diese Art Stunden ein (Urlaub, Gleitzeit)? */
export const abwesenheitMitStunden = (a) => ABWESENHEIT_MIT_STUNDEN.includes(artText(a));
/** Zählen die Stunden dieser Art zur Monatssumme (nur Urlaub)? */
export const abwesenheitBezahlt = (a) => ABWESENHEIT_BEZAHLT.includes(artText(a));

/**
 * Stunden eines Abwesenheitstags laut Spalte „Stunden Urlaub/Gleitzeit“ (Airtable-Dauer in Sekunden).
 * @param {object} fields  Airtable-Felder der Dienstplan-Zeile
 * @param {string} abwesenheitsArt  z. B. „Urlaub“, „Gleitzeit“, „Krank“
 * @returns {number|null}  Minuten; null = Art ohne Stunden (Krank, Abwesend) oder nicht/ungültig eingetragen
 */
export function abwesenheitsMinuten(fields, abwesenheitsArt) {
  if (!abwesenheitMitStunden(abwesenheitsArt)) return null;
  const v = fields && typeof fields === 'object' ? fields[ABWESENHEIT_STUNDEN_FELD] : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  const min = Math.round(v / 60);
  return min <= ABWESENHEIT_STUNDEN_MAX_MIN ? min : null;
}
