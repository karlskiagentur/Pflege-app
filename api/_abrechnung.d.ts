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
