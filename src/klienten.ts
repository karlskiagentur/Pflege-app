// „Meine Klienten“ der Mitarbeiter-App (Reiter „Adressen“, Wunsch Pflegedienst 27.11.2026):
// die Adressen aller Klienten, bei denen die Pflegekraft zuletzt im Einsatz war oder eingeplant
// ist - unabhängig davon, ob der einzelne Einsatz heute, in der Zukunft oder in der Vergangenheit
// liegt. Bisher stand die Adresse nur am heutigen Einsatz.
//
// Quelle sind ausschließlich die Einsätze, die /api/ma-termine dieser Pflegekraft ohnehin liefert
// (Anmeldung per Session-Token, nur eigene Einsätze). Es gibt keinen zusätzlichen Abruf, und es
// wird nichts auf dem Gerät gespeichert. Regeln:
//   1. Nur Einsätze MIT Klient (Urlaub/Abwesenheit-Zeilen haben keinen).
//   2. Abgesagte Einsätze zählen nicht - dort war bzw. kommt die Pflegekraft nicht hin.
//   3. Nur Einsätze der letzten KLIENTEN_TAGE_ZURUECK Tage und alle künftigen: Endet die
//      Betreuung, verschwindet die Adresse von selbst (Erforderlichkeit, Datensparsamkeit).
//      Die Grenze gilt hier noch einmal, weil der Server im Ausnahmefall (Zeitfenster-Formel
//      abgelehnt oder leeres Ergebnis) auch ältere Einsätze liefert.
//   4. Lieber keine Adresse als eine falsche: Hängen an einem Einsatz mehrere Klienten und passt
//      die Zahl der gelieferten Adressen nicht dazu, wird aus diesem Einsatz keine übernommen.

// Wie FENSTER_TAGE in api/ma-termine.js (dort maßgeblich für den Abruf; ein Test hält beide gleich).
export const KLIENTEN_TAGE_ZURUECK = 70;
const TAG_MS = 24 * 60 * 60 * 1000;

export interface KlientEintrag {
  id: string;                 // Datensatz des Klienten (ohne Verknüpfung: Ersatzschlüssel aus dem Namen)
  name: string;
  adresse: string;            // einzeilig; '' = im Büro noch keine Anschrift hinterlegt
  naechsterMs: number | null; // nächster Einsatz: ab jetzt, oder heute mit noch offener Ist-Zeit
  letzterMs: number | null;   // letzter Einsatz davor
}

// „Heute“ und „jetzt“ kommen vom Aufrufer (Ortszeit des Geräts) - so bleibt die Regel prüfbar.
export interface KlientenZeit { heuteBeginnMs: number; jetztMs: number }

// Route in Google Maps zu einer Adresse (Maps-URLs, „dir“ mit api=1): öffnet auf dem Handy die
// Google-Maps-App, ohne App Google Maps im Browser; Start ist der eigene Standort.
// encodeURIComponent schützt Umlaute, Kommas und /-Hausnummern.
export const mapsUrl = (adresse: string): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(String(adresse).replace(/\n/g, ', '))}`;

// Airtable liefert Nachschlagefelder als Liste, einfache Felder als Wert. Die Reihenfolge bleibt
// erhalten (leere Werte werden zu ''), damit Klient, Name und Adresse zueinander passen.
const werte = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
  .map((x) => (x === undefined || x === null || typeof x === 'object' ? '' : String(x).trim()));
const erster = (v: unknown): string => werte(v).find(Boolean) || '';
const felder = (t: unknown): Record<string, unknown> => {
  if (!t || typeof t !== 'object') return {};
  const f = (t as { fields?: unknown }).fields;
  return f && typeof f === 'object' ? (f as Record<string, unknown>) : (t as Record<string, unknown>);
};
const einzeilig = (s: string): string => s.replace(/\s*\n\s*/g, ', ').trim();

// Zeitpunkt eines Einsatzes wie im Plan der App: das Systemfeld „Uhrzeit“ (aus Datum + Von).
// Ohne Uhrzeit steht ein Einsatz auch im Plan nirgends - er zählt dann hier ebenfalls nicht.
const zeitpunkt = (f: Record<string, unknown>): number => Date.parse(erster(f.Uhrzeit));

// Sortierschlüssel „Nachname Vorname“: Die Namen stehen als „Vorname Nachname“ im Dienstplan,
// gesucht wird im Alltag nach dem Nachnamen („Frau Mustermann“).
const sortierName = (name: string): string => {
  const teile = name.split(/\s+/).filter(Boolean);
  return teile.length > 1 ? `${teile[teile.length - 1]} ${teile.slice(0, -1).join(' ')}` : name;
};

export function klientenAusEinsaetzen(einsaetze: unknown, zeit: KlientenZeit): KlientEintrag[] {
  const z: Partial<KlientenZeit> = zeit && typeof zeit === 'object' ? zeit : {};
  const heuteBeginnMs = typeof z.heuteBeginnMs === 'number' ? z.heuteBeginnMs : NaN;
  // Ohne gültiges „heute“ lässt sich Regel 3 nicht prüfen - dann lieber keine Liste als eine zu große.
  if (!Number.isFinite(heuteBeginnMs)) return [];
  const jetztMs = typeof z.jetztMs === 'number' && Number.isFinite(z.jetztMs) ? z.jetztMs : heuteBeginnMs;
  const ab = heuteBeginnMs - KLIENTEN_TAGE_ZURUECK * TAG_MS;
  const nachId = new Map<string, KlientEintrag & { adresseVonMs: number }>();
  for (const t of Array.isArray(einsaetze) ? einsaetze : []) {
    const f = felder(t);
    if (erster(f.Status) === 'Abgesagt') continue;                 // Regel 2
    const ms = zeitpunkt(f);
    if (!Number.isFinite(ms) || ms < ab) continue;                 // Regel 3
    const ids = werte(f.Patient).filter(Boolean);
    const namen = werte(f.Patient_Name);
    const adressen = werte(f.Adresse_Klient);
    // Üblich ist genau ein Klient je Einsatz. Bei mehreren zählt die Position - aber nur, wenn
    // Namen bzw. Adressen vollzählig geliefert wurden (Regel 4).
    const anzahl = Math.max(ids.length, ids.length === 0 && namen.some(Boolean) ? 1 : 0);
    // Ein heutiger Einsatz, dessen Ist-Zeit schon erfasst ist, liegt hinter der Pflegekraft. Der Status
    // „Bestätigt“ zählt hier nicht - das ist die Terminbestätigung des Klienten (api/service-submit.js).
    const istErfasst = erster(f.Erledigt_Am) !== '' || Number(erster(f.Dauer_Ist)) > 0;
    const kommtNoch = ms >= jetztMs || (ms >= heuteBeginnMs && !istErfasst);
    for (let i = 0; i < anzahl; i += 1) {                          // Regel 1: ohne Klient kein Durchlauf
      const name = anzahl === 1 ? namen.find(Boolean) || '' : namen.length === anzahl ? namen[i] : '';
      const adresse = einzeilig(anzahl === 1 ? adressen.find(Boolean) || '' : adressen.length === anzahl ? adressen[i] : '');
      const id = ids[i] || `name:${name}`;
      let k = nachId.get(id);
      if (!k) {
        k = { id, name, adresse: '', naechsterMs: null, letzterMs: null, adresseVonMs: -Infinity };
        nachId.set(id, k);
      }
      if (!k.name && name) k.name = name;
      // Anschrift des jüngsten Einsatzes mit Anschrift (alle zeigen dieselbe aus dem Stammblatt).
      if (adresse && ms > k.adresseVonMs) { k.adresse = adresse; k.adresseVonMs = ms; }
      if (kommtNoch) { if (k.naechsterMs === null || ms < k.naechsterMs) k.naechsterMs = ms; }
      else if (k.letzterMs === null || ms > k.letzterMs) k.letzterMs = ms;
    }
  }
  return [...nachId.values()]
    .map(({ id, name, adresse, naechsterMs, letzterMs }) => ({ id, name, adresse, naechsterMs, letzterMs }))
    .sort((a, b) => sortierName(a.name).localeCompare(sortierName(b.name), 'de', { sensitivity: 'base' })
      || a.id.localeCompare(b.id));
}

// Für die Anzeige: wirft nie. Ein unerwarteter Fehler in den Daten darf die Mitarbeiter-App nicht
// zum Absturz bringen - der Reiter zeigt dann einen Hinweis, und der Fehler wird gemeldet.
export function klientenSicher(einsaetze: unknown, zeit: KlientenZeit): { klienten: KlientEintrag[]; fehler: unknown } {
  try {
    return { klienten: klientenAusEinsaetzen(einsaetze, zeit), fehler: null };
  } catch (e) {
    return { klienten: [], fehler: e || new Error('Klientenliste nicht berechenbar') };
  }
}
