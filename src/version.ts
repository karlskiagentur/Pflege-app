// Neue App-Version in der Mitarbeiter-App ohne Abmelden (Wunsch Karl 27.11.2026: „nur App schließen und
// wieder öffnen“).
//
// Hintergrund: Holt eine Pflegekraft die App nur aus dem Hintergrund zurück, läuft der alte Stand im
// Speicher weiter. Der Versions-Check in App.tsx erkennt die neue Version (Name des Haupt-Bundles in
// index.html). Dann gilt für die Mitarbeiter-Ansicht:
//   - Ist gerade nichts in Arbeit (keine Eingabe, kein Dialog, nichts wird gespeichert), startet die App
//     von selbst neu - höchstens einmal je neuer Version (Schutz vor einer Neustart-Schleife) - und
//     öffnet danach denselben Reiter wieder.
//   - Sonst erscheint der Hinweis „Neue Version verfügbar – hier tippen“ wie in der Klienten-App. So geht
//     keine angefangene Eingabe verloren (Grundsatz seit Juli 2026: kein Neuladen über eine Eingabe hinweg).
// Die Klienten-Ansicht bleibt wie bisher: nur der Hinweis.
// Im Gerätespeicher stehen dafür nur zwei technische Werte für die laufende Sitzung (Bundle-Name, Reiter).

// Haupt-Bundle einer index.html bzw. eines <script src>: „/assets/index-<Prüfwert>.js“, sonst ''.
export const bundleAus = (text: unknown): string => {
  const m = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(typeof text === 'string' ? text : '');
  return m ? m[0] : '';
};

// Was in der Mitarbeiter-Ansicht gerade offen ist (aus dem Zustand von App.tsx).
export interface MaArbeitsstand {
  dauerInput: Record<string, unknown> | null;   // Ist-Zeit eingetippt, noch nicht gespeichert
  dauerConfirm: unknown;                        // Dialog „Ist-Zeit bestätigen“ offen
  dauerSaving: unknown;                         // Ist-Zeit wird gespeichert
  meldungOffen: unknown;                        // „Problem melden“ offen
  meldungSending: unknown;
  urlaubVon: unknown;                           // Urlaubsantrag angefangen
  urlaubBis: unknown;
  urlaubNotiz: unknown;
  urlaubSending: unknown;
  lohnVorschau: unknown;                        // Lohnabrechnung in der Vorschau offen
  activeModal: unknown;                         // ein anderes Fenster offen (z. B. Lohn-Auswahl)
  pushLaedt: unknown;                           // Benachrichtigungen werden gerade eingerichtet
}

const gesetzt = (v: unknown): boolean => (typeof v === 'string' ? v.trim() !== '' : v !== null && v !== undefined && v !== false);

// true = die Pflegekraft ist gerade mitten in etwas -> kein automatischer Neustart.
// Unbekannter Zustand gilt als „in Arbeit“ (lieber der Hinweis als eine verlorene Eingabe).
export function maInArbeit(s: Partial<MaArbeitsstand> | null | undefined): boolean {
  if (!s || typeof s !== 'object') return true;
  const eingaben = s.dauerInput;
  if (eingaben === undefined || (eingaben !== null && typeof eingaben !== 'object')) return true;
  if (eingaben && Object.keys(eingaben).length > 0) return true;
  return [s.dauerConfirm, s.dauerSaving, s.meldungOffen, s.meldungSending, s.urlaubVon, s.urlaubBis, s.urlaubNotiz,
    s.urlaubSending, s.lohnVorschau, s.activeModal, s.pushLaedt].some(gesetzt);
}

type Speicher = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Sitzungsspeicher des Browsers, oder null, wenn er gesperrt ist (privater Modus, Einstellungen).
export function sitzungsSpeicher(): Speicher | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

// Höchstens ein automatischer Neustart je Version: Bekommt das Gerät trotz Neustart den alten Stand
// (z. B. ein Zwischenspeicher im Netz), bleibt es beim Hinweis. Ohne nutzbaren Speicher kein Neustart.
export const NEUSTART_SCHLUESSEL = 'wl_neustart_fuer';
export function neustartVormerken(ziel: string, speicher: Speicher | null | undefined): boolean {
  if (!bundleAus(ziel) || !speicher) return false;
  try {
    if (speicher.getItem(NEUSTART_SCHLUESSEL) === ziel) return false;
    speicher.setItem(NEUSTART_SCHLUESSEL, ziel);
    return speicher.getItem(NEUSTART_SCHLUESSEL) === ziel;
  } catch {
    return false;
  }
}

// Reiter der Mitarbeiter-App: Nach dem automatischen Neustart öffnet die App denselben Reiter wieder
// (einmalig; danach wie gewohnt „Übersicht“ beim Start).
export const MA_REITER = ['uebersicht', 'tagesplan', 'adressen', 'urlaub', 'lohn'] as const;
export type MaReiter = typeof MA_REITER[number];
export const REITER_SCHLUESSEL = 'wl_ma_reiter';
const istReiter = (r: unknown): r is MaReiter => typeof r === 'string' && (MA_REITER as readonly string[]).includes(r);

export function reiterMerken(reiter: unknown, speicher: Speicher | null | undefined): void {
  if (!istReiter(reiter) || !speicher) return;
  try { speicher.setItem(REITER_SCHLUESSEL, reiter); } catch { /* dann startet die App in der Übersicht */ }
}

export function reiterNachNeustart(speicher: Speicher | null | undefined): MaReiter | null {
  if (!speicher) return null;
  try {
    const r = speicher.getItem(REITER_SCHLUESSEL);
    if (r !== null) speicher.removeItem(REITER_SCHLUESSEL);
    return istReiter(r) ? r : null;
  } catch {
    return null;
  }
}
