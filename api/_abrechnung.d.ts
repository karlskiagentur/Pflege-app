// Typen zu api/_abrechnung.js (wird auch von src/App.tsx genutzt). Bei jeder neuen Funktion dort
// hier ergänzen – tests/abrechnung.test.mjs prüft, dass alle Exporte deklariert sind.

/** Zeitraum eines Abrechnungsmonats, ISO-Daten ('YYYY-MM-DD'), beide einschließlich. */
export interface Zeitraum {
  von: string;
  bis: string;
}

export declare const ERSTER_STICHTAG_MONAT: string;
export declare const STICHTAG: number;
export declare function monatPlus(ym: string, n: number): string;
export declare function abrechnungszeitraum(ym: string): Zeitraum;
export declare function abrechnungsmonatFuer(datum: string): string;
export declare function imZeitraum(datum: unknown, zeitraum: Zeitraum | null | undefined): boolean;
export declare function zeitraumText(zeitraum: Zeitraum): string;
export declare function ersterTagDesZeitraums(heute: string): boolean;
export declare function abgeschlossenerMonat(heute: string): string;

/** Spalte mit den Stunden eines Urlaubs-, Gleitzeit- oder Krankheitstags. */
export declare const ABWESENHEIT_STUNDEN_FELD: string;
export declare const ABWESENHEIT_STUNDEN_MAX_MIN: number;
/** Arten, zu denen immer Stunden gehören (Urlaub, Gleitzeit) – fehlen sie, zählt der Tag 0:00. */
export declare const ABWESENHEIT_MIT_STUNDEN: string[];
/** Arten, zu denen das Büro Stunden eintragen kann, aber nicht muss (Krank). */
export declare const ABWESENHEIT_STUNDEN_FREIWILLIG: string[];
/** Arten, deren eingetragene Stunden zur Monatssumme zählen (Urlaub, Krank). */
export declare const ABWESENHEIT_BEZAHLT: string[];
export declare function abwesenheitMitStunden(art: unknown): boolean;
export declare function abwesenheitStundenFreiwillig(art: unknown): boolean;
export declare function abwesenheitBezahlt(art: unknown): boolean;
/** Minuten laut „Stunden Urlaub/Gleitzeit“; null = Art ohne Stunden, nicht (gültig) eingetragen oder Krank mit 0:00. */
export declare function abwesenheitsMinuten(fields: unknown, abwesenheitsArt: unknown): number | null;
/** „1 Einsatz abgesagt“ / „3 Einsätze abgesagt“ – Zusatz zu einem Abwesenheitstag aus abgesagten Einsätzen. */
export declare function einsaetzeAbgesagtText(anzahl: number): string;

/** Spalte „Abrechnen ohne Lohn“: Einsatz wird berechnet, ist aber keine Arbeitszeit. */
export declare const ABRECHNEN_OHNE_LOHN_FELD: string;
/** Feldnamen eines Einsatzes, die „Abrechnen ohne Lohn“ bedeuten (auch umbenannt mit „ohne Lohn“). */
export declare function ohneLohnFelder(fields: unknown): string[];
/** true, wenn „Abrechnen ohne Lohn“ angekreuzt ist (nur ein gesetztes Ankreuzfeld zählt). */
export declare function abrechnenOhneLohn(fields: unknown): boolean;
