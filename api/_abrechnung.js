// Abrechnungszeitraum der Stundenzettel – EINE Regel für Server (Stundenzettel, Monatslauf) und
// Mitarbeiter-App (Reiter „Lohn / Zeit“). Reine Datumslogik ohne Abhängigkeiten: Die Datei wird
// auch ins App-Bundle übernommen (src/App.tsx) – hier nie etwas Server-Spezifisches importieren
// (tests/abrechnung.test.mjs prüft das). Typen für die App: api/_abrechnung.d.ts.
//
// Vorgabe Pflegedienst (02.11.2026): Ein Abrechnungsmonat läuft vom 27. des Vormonats bis zum 26.
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
