// Typen für den gemeinsam genutzten Rechenkern (Server und App) – nur, was die App daraus braucht.
// Die Regeln selbst stehen in api/_zeitkonto.js.

/** Abwesenheitstag aus abgesagten Einsätzen (Regel 7), dessen eingetragene Stunden zur Monatssumme zählen. */
export interface BezahlterAusfallTag {
  id: string;
  /** Tag (JJJJ-MM-TT) */
  datum: string;
  /** Auswahl in „Abwesend/Urlaub“, z. B. „Krank“ */
  art: string;
  /** eingetragene Stunden in Minuten (immer > 0) */
  min: number;
  /** so viele abgesagte Einsätze stehen hinter dem Tag */
  einsaetze: number;
  /** Zeitfenster = Spanne der ausgefallenen Einsätze ('' wenn ein Einsatz keine Uhrzeit hat) */
  von: string;
  bis: string;
}

/** Regel 7 für die Ansicht „Zeit“ der Mitarbeiter-App: rohe Dienstplan-Zeilen EINES Mitarbeiters hinein. */
export declare function bezahlteAusfallTage(zeilen: unknown): BezahlterAusfallTag[];
