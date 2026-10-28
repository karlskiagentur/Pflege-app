// „Neu“-Markierungen in Mitarbeiter- und Klienten-App: Was hat sich seit dem letzten Blick
// geändert? Alles läuft lokal auf dem Gerät (localStorage) - ohne zusätzliche Abfragen,
// ohne Airtable-Automationen. Gemerkt werden nur IDs und Fingerabdrücke, keine Namen.
//
// Ablauf: Die App zeigt alles, was neu ist, mit „NEU“ an. Verlässt man die Ansicht (anderer
// Reiter oder App im Hintergrund), gilt es als gesehen. Beim allerersten Laden auf einem
// Gerät wird der Stand übernommen, ohne alles als neu zu markieren (frische Mitteilungen
// und Lohnabrechnungen der letzten Tage bleiben aber neu).

// Ziele, die ein Tipp auf einen Push öffnet (gleiche Liste wie api/_push.js).
export type PushZiel = 'plan' | 'lohn' | 'nachrichten' | 'termine' | 'dokumente';
const ZIELE: PushZiel[] = ['plan', 'lohn', 'nachrichten', 'termine', 'dokumente'];

/** Ziel aus der Adresse (/?ziel=plan) - unbekannte Werte werden ignoriert. */
export function zielAusAdresse(suche: string): PushZiel | null {
  try {
    const z = new URLSearchParams(suche).get('ziel');
    return z && (ZIELE as string[]).includes(z) ? (z as PushZiel) : null;
  } catch {
    return null;
  }
}
export const istPushZiel = (z: unknown): z is PushZiel => typeof z === 'string' && (ZIELE as string[]).includes(z);

// --- Speicher (localStorage kann fehlen, voll oder gesperrt sein: nie abstürzen) ---------
export function ladeJson<T>(schluessel: string, ersatz: T): T {
  try {
    const roh = localStorage.getItem(schluessel);
    return roh ? (JSON.parse(roh) as T) : ersatz;
  } catch {
    return ersatz;
  }
}
export function speichereJson(schluessel: string, wert: unknown): void {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch { /* nur Komfort */ }
}

// --- Einsätze (Mitarbeiter-Plan) --------------------------------------------------------
export type EinsatzMarke = 'neu' | 'geaendert' | 'abgesagt';

const feld = (t: any, name: string): string => {
  const v = t && t.fields ? t.fields[name] : undefined;
  const x = Array.isArray(v) ? v[0] : v;
  if (x && typeof x === 'object') return String(x.name ?? x.id ?? '');
  return x == null ? '' : String(x);
};

// Kurzer Prüfwert (FNV-1a, 32 Bit): Gemerkt wird nur dieser Wert, nie Namen oder Adressen.
function pruefwert(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Fingerabdruck der Angaben, die für den Mitarbeiter zählen: "Status|Prüfwert". */
export function einsatzSignatur(t: any): string {
  const angaben = [
    feld(t, 'Uhrzeit'), feld(t, 'Datum'), feld(t, 'Von'), feld(t, 'Bis'), feld(t, 'Tätigkeit'),
    feld(t, 'Patient_Name'), feld(t, 'Adresse_Klient'), feld(t, 'Hervorhebung'), feld(t, 'Pfleger_Ersatz_Name'),
  ].join('\u0001');
  return `${feld(t, 'Status')}|${pruefwert(angaben)}`;
}

/** Zeitpunkt eines Einsatzes (ms) - Uhrzeit, sonst Datum (Tagesbeginn); 0 = unbekannt. */
export function einsatzZeit(t: any): number {
  const u = Date.parse(feld(t, 'Uhrzeit'));
  if (Number.isFinite(u)) return u;
  const d = Date.parse(`${feld(t, 'Datum')}T00:00:00`);
  return Number.isFinite(d) ? d : 0;
}

/** Stand zum Merken: nur heutige und künftige Einsätze (hält den Speicher klein). */
export function einsatzStand(termine: any[], ab: number): Record<string, string> {
  const stand: Record<string, string> = {};
  for (const t of termine || []) {
    if (t && t.id && einsatzZeit(t) >= ab) stand[t.id] = einsatzSignatur(t);
  }
  return stand;
}

/**
 * Markierungen je Einsatz-ID gegenüber dem gemerkten Stand. Ohne Stand (erste Nutzung auf
 * diesem Gerät) gibt es keine Markierungen. Vergangene Einsätze werden nie markiert.
 */
export function einsatzMarken(termine: any[], gemerkt: Record<string, string> | null, ab: number): Record<string, EinsatzMarke> {
  const marken: Record<string, EinsatzMarke> = {};
  if (!gemerkt) return marken;
  for (const t of termine || []) {
    if (!t || !t.id || einsatzZeit(t) < ab) continue;
    const jetzt = einsatzSignatur(t);
    const vorher = gemerkt[t.id];
    if (vorher === undefined) { marken[t.id] = 'neu'; continue; }
    if (vorher === jetzt) continue;
    const warAbgesagt = vorher.split('|')[0] === 'Abgesagt';
    marken[t.id] = feld(t, 'Status') === 'Abgesagt' && !warAbgesagt ? 'abgesagt' : 'geaendert';
  }
  return marken;
}

// --- Listen mit Schlüssel (Mitteilungen, Lohnabrechnungen) ---------------------------------
/**
 * Neue Schlüssel: alle, die nicht als gesehen gemerkt sind. Ohne gemerkte Liste (erste
 * Nutzung) gelten nur „frische“ Einträge als neu (Regel kommt vom Aufrufer).
 */
export function neueSchluessel<T>(liste: T[], schluessel: (x: T) => string, gesehen: string[] | null, frisch: (x: T) => boolean): Set<string> {
  const neu = new Set<string>();
  const bekannt = new Set(gesehen || []);
  for (const x of liste || []) {
    const k = schluessel(x);
    if (!k || bekannt.has(k)) continue;
    if (gesehen === null && !frisch(x)) continue;
    neu.add(k);
  }
  return neu;
}

/** Gesehen-Liste fortschreiben (höchstens 300 Einträge, neueste zuletzt). */
export function gesehenErgaenzen(gesehen: string[] | null, neu: string[]): string[] {
  const alle = [...(gesehen || []).filter((k) => !neu.includes(k)), ...neu];
  return alle.slice(-300);
}

/** "dd.mm.yyyy" oder ISO -> ms (0 = unbekannt). */
export function datumMs(wert: string): number {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(wert || ''));
  if (m) return Date.parse(`${m[3]}-${m[2]}-${m[1]}T12:00:00`) || 0;
  const x = Date.parse(String(wert || ''));
  return Number.isFinite(x) ? x : 0;
}

/** Datum + Uhrzeit für die Anzeige, z. B. "Mi, 28.10., 14:05". */
export function anzeigeZeit(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
