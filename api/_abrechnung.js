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

// Urlaub, Gleitzeit, Krank, Abwesend – wie in üblichen Betrieben (Vorgabe Karl 07.11.2026; Krank mit
// Stunden: Wunsch Geschäftsleitung 25.11.2026):
// - Urlaub:    Das Büro trägt die Stunden des Tages ein (Spalte „Stunden Urlaub/Gleitzeit“).
//              Bezahlt – zählt auf dem Stundenzettel zur Monatssumme.
// - Gleitzeit: Das Büro trägt die Stunden ein. Freizeitausgleich aus dem Zeitkonto – steht auf dem
//              Stundenzettel, zählt aber NICHT zur Monatssumme (die Stunden wurden schon gearbeitet,
//              sonst wären sie doppelt bezahlt).
// - Krank:     Der Tag steht immer auf dem Stundenzettel. Stunden nur, wenn das Büro sie einträgt
//              (dieselbe Spalte; üblich bei Teil- und Vollzeit): Dann stehen sie da und zählen zur
//              Monatssumme. Ohne Eintrag (üblich beim Minijob) oder mit 0:00 bleibt es beim Tag („–“)
//              – die Lohnfortzahlung rechnet dann das Lohnbüro.
// - Abwesend und jede andere Art: nur der Tag, keine Stunden („–“).
// Stunden gelten genau so, wie eingetragen (ganze Minuten, kein 15-Minuten-Takt, z. B. 7:42).
// Von/Bis einer Abwesenheit ist nur das Zeitfenster und zählt nie. Keine Art zählt je zu den
// geplanten, verplanten oder verkauften Stunden. Welche Zeile eine Abwesenheit ist (eigene Zeile
// ohne Klient oder abgesagter Einsatz mit dieser Auswahl), prüft der Aufrufer (api/_zeitkonto.js,
// src/App.tsx).
export const ABWESENHEIT_STUNDEN_FELD = 'Stunden Urlaub/Gleitzeit';
export const ABWESENHEIT_STUNDEN_MAX_MIN = 24 * 60; // mehr als ein ganzer Tag ist ein Tippfehler
export const ABWESENHEIT_MIT_STUNDEN = ['Urlaub', 'Gleitzeit'];   // hier gehören Stunden hin – fehlen sie, zählt der Tag 0:00
export const ABWESENHEIT_STUNDEN_FREIWILLIG = ['Krank'];          // Stunden nur, wenn das Büro sie einträgt; sonst nur der Tag
export const ABWESENHEIT_BEZAHLT = ['Urlaub', 'Krank'];           // eingetragene Stunden zählen zur Monatssumme

const artText = (a) => String(a || '').trim();
/** Gehören zu dieser Art immer Stunden (Urlaub, Gleitzeit)? Fehlen sie, zählt der Tag 0:00. */
export const abwesenheitMitStunden = (a) => ABWESENHEIT_MIT_STUNDEN.includes(artText(a));
/** Kann das Büro zu dieser Art Stunden eintragen, muss es aber nicht (Krank)? */
export const abwesenheitStundenFreiwillig = (a) => ABWESENHEIT_STUNDEN_FREIWILLIG.includes(artText(a));
/** Zählen eingetragene Stunden dieser Art zur Monatssumme (Urlaub, Krank)? */
export const abwesenheitBezahlt = (a) => ABWESENHEIT_BEZAHLT.includes(artText(a));

/**
 * Stunden eines Abwesenheitstags laut Spalte „Stunden Urlaub/Gleitzeit“ (Airtable-Dauer in Sekunden).
 * @param {object} fields  Airtable-Felder der Dienstplan-Zeile
 * @param {string} abwesenheitsArt  z. B. „Urlaub“, „Gleitzeit“, „Krank“
 * @returns {number|null}  Minuten; null = Art ohne Stunden (Abwesend), nicht/ungültig eingetragen
 *   oder – nur bei Krank – 0:00 (dann gilt: nur der Tag)
 */
export function abwesenheitsMinuten(fields, abwesenheitsArt) {
  const freiwillig = abwesenheitStundenFreiwillig(abwesenheitsArt);
  if (!abwesenheitMitStunden(abwesenheitsArt) && !freiwillig) return null;
  const v = fields && typeof fields === 'object' ? fields[ABWESENHEIT_STUNDEN_FELD] : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  const min = Math.round(v / 60);
  if (min > ABWESENHEIT_STUNDEN_MAX_MIN) return null;
  // Urlaub/Gleitzeit: 0:00 ist ein bewusster Eintrag. Krank: 0:00 heißt „keine Stunden“ (nur der Tag).
  return freiwillig && min === 0 ? null : min;
}

/**
 * Zusatz zu einem Abwesenheitstag, der aus abgesagten Einsätzen stammt (Regel 7 in api/_zeitkonto.js),
 * z. B. „3 Einsätze abgesagt“ – derselbe Wortlaut auf dem Stundenzettel und in der App.
 * @param {number} anzahl
 * @returns {string}
 */
export const einsaetzeAbgesagtText = (anzahl) => `${anzahl} ${anzahl === 1 ? 'Einsatz' : 'Einsätze'} abgesagt`;

// „Abrechnen ohne Lohn“ (Wunsch Geschäftsleitung 23.11.2026): Das Büro kreuzt die Spalte an einem
// Einsatz MIT Klient an, wenn der Einsatz dem Klienten berechnet wird, die Mitarbeiterin dafür aber
// keine Stunden bekommt – z. B. hat der Klient kurzfristig abgesagt und sie war stattdessen bei
// einem anderen Klienten, oder zwei Einsätze laufen gleichzeitig.
// - Planung/Abrechnung: Der Einsatz bleibt ein Einsatz. Er zählt weiter zu „Geplant (Std.)“ und den
//   verplanten Stunden, steht im Wochendienstplan mit der geplanten Zeit und gilt als geklärt (nicht
//   mehr „offen“).
// - Lohn: Er ist NIE Arbeitszeit – keine Ist-Zeit (auch keine schon eingetragene), keine
//   Kunden-Anfahrt, nicht unter „nicht bestätigt“; in der App gibt es dafür keine Zeiterfassung.
// - Ohne Haken ändert sich nichts. An einer Zeile ohne Klient hat der Haken keine Bedeutung – das
//   prüft der Aufrufer (api/_zeitkonto.js, src/App.tsx).
// - Abgesagt + Haken (Hinweis Geschäftsleitung 24.11.2026, z. B. kurzfristige Absage, die berechnet
//   wird): Für die Mitarbeiterin bleibt der Einsatz abgesagt – „Abgesagt“ geht dort vor (Stundenzettel,
//   Wochenplan je Mitarbeiter, App). Abgerechnet wird er trotzdem: Der Wochendienstplan aller
//   Mitarbeiter, von dem das Büro die Stunden der Klienten in die Abrechnung überträgt, zeigt ihn mit *
//   (api/_wochenuebersicht.js).
export const ABRECHNEN_OHNE_LOHN_FELD = 'Abrechnen ohne Lohn';
// Zweite Sicherung: Wird die Spalte in Airtable umbenannt und behält „ohne Lohn“ im Namen (z. B.
// „Berechnen ohne Lohn“), gilt sie weiter – überall, wo alle Felder gelesen werden (Stundenzettel,
// Apps). So zählt ein markierter Einsatz nie versehentlich als Arbeitszeit und die Markierung geht
// nie an Klienten.
const OHNE_LOHN_MUSTER = /ohne[\s_-]*lohn/i;

/**
 * Namen der Felder eines Einsatzes, die „Abrechnen ohne Lohn“ bedeuten (für das Lesen und für das
 * Entfernen aus Antworten an Klienten).
 * @param {object} fields  Airtable-Felder der Dienstplan-Zeile
 * @returns {string[]}
 */
export function ohneLohnFelder(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  return Object.keys(f).filter((k) => k === ABRECHNEN_OHNE_LOHN_FELD || OHNE_LOHN_MUSTER.test(k));
}

/**
 * Ist „Abrechnen ohne Lohn“ angekreuzt? Nur ein gesetztes Ankreuzfeld (true) zählt – Texte, Zahlen
 * oder ein leeres Feld nie.
 * @param {object} fields  Airtable-Felder der Dienstplan-Zeile
 * @returns {boolean}
 */
export function abrechnenOhneLohn(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  return ohneLohnFelder(f).some((k) => f[k] === true);
}
