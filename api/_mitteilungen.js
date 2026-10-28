// Mitteilungen des Pflegedienstes (Tabelle "Mitteilungen", Interface-Seite "✉️ Mitteilungen").
//
// Ablauf: Das Büro stellt eine Mitteilung auf Status "Senden" -> Automation "Push bei
// Mitteilung senden" -> /api/push-event (type "mitteilung"). Der Server legt den
// gesendeten Text und den Zeitpunkt in der Mitteilung ab (Gesendeter_Text, Gesendet_Am),
// setzt "Gesendet" und schickt erst dann die Pushs. Ab da steht die Mitteilung in der
// Mitarbeiter- bzw. Klienten-App (30 Tage) - auch bei allen, die keine Pushs empfangen.
//
// Wer sie sieht:
//   Mitarbeiter: Zielgruppe "Alle Mitarbeiter"/"Alle gesamt" oder als Ausfall-/Ersatz-
//                Mitarbeiter verknüpft.
//   Klient:      Zielgruppe "Alle Patienten"/"Alle gesamt" oder als betroffener Patient
//                verknüpft.

import { fetchAll } from './_lib.js';

export const MITTEILUNGEN = 'tblQYvzkhvBnDyXdv';
export const ANZEIGE_TAGE = 30;   // so lange bleibt eine Mitteilung in der App sichtbar
const MAX_IN_APP = 30;

const val = (v) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
const txt = (v) => {
  const x = val(v);
  return String(x && typeof x === 'object' && 'name' in x ? x.name : x);
};
const ids = (v) => (Array.isArray(v) ? v : v ? [v] : [])
  .map((x) => (x && typeof x === 'object' ? x.id : x))
  .filter(Boolean)
  .map(String);

// Alt-Optionen der Zielgruppe tolerant auf die gültigen abbilden ("Error darf nie
// entstehen": eine falsch gewählte Alt-Option darf den Versand nicht ins Leere laufen lassen).
export function zielgruppeNormal(roh) {
  const z = txt(roh).trim();
  if (z === 'Patienten') return 'Alle Patienten';
  if (z === 'Mitarbeiter') return 'Alle Mitarbeiter';
  if (z === 'Alle (Broadcast)') return 'Alle gesamt';
  return z;
}

/**
 * Text der Mitteilung, wie er per Push verschickt und in den Apps angezeigt wird.
 * Ausfall: "Mitarbeiter/in A fällt aus, deshalb kommt Mitarbeiter/in B" - Namen aus den
 * verknüpften Mitarbeitern (Kurzform "Vorname N."), die alten Textfelder sind nur Rückfall;
 * ein zusätzlicher Text im Feld "Nachricht" wird angehängt. Sonst: das Feld "Nachricht".
 */
export function mitteilungText(fields, namen = {}) {
  const f = fields || {};
  const nachricht = txt(f.Nachricht).trim();
  if (txt(f.Typ) === 'Ausfall') {
    const ausfall = (namen.ausfall || []).join(', ') || txt(f.Mitarbeiter_Ausfall).trim();
    const ersatz = (namen.ersatz || []).join(', ') || txt(f.Mitarbeiter_Ersatz).trim();
    const wer = ausfall ? `Mitarbeiter/in ${ausfall}` : 'Ein/e Mitarbeiter/in';
    const satz = ersatz ? `${wer} fällt aus, deshalb kommt Mitarbeiter/in ${ersatz}` : `${wer} fällt aus.`;
    if (!nachricht) return satz;
    return `${satz}${/[.!?]$/.test(satz) ? '' : '.'} ${nachricht}`;
  }
  return nachricht;
}

/** Überschrift in der App: Titel der Mitteilung, sonst nach Typ. */
export function mitteilungTitel(fields) {
  const f = fields || {};
  const titel = txt(f.Titel).trim();
  if (titel) return titel;
  return txt(f.Typ) === 'Ausfall' ? 'Personaländerung' : 'Mitteilung vom Pflegedienst';
}

/** Darf diese Person die (gesendete) Mitteilung sehen? rolle: 'mitarbeiter' | 'patient'. */
export function mitteilungRelevant(rec, rolle, personId) {
  const f = (rec && rec.fields) || {};
  const ziel = zielgruppeNormal(f.Zielgruppe);
  const id = String(personId || '');
  if (!id) return false;
  if (rolle === 'mitarbeiter') {
    return ziel === 'Alle Mitarbeiter' || ziel === 'Alle gesamt'
      || ids(f.Ausfall_Mitarbeiter).includes(id) || ids(f.Ersatz_Mitarbeiter).includes(id);
  }
  if (rolle === 'patient') {
    return ziel === 'Alle Patienten' || ziel === 'Alle gesamt' || ids(f.Betroffener_Patient).includes(id);
  }
  return false;
}

/**
 * Für die App: nur Anzeige-Daten, keine Verknüpfungen/IDs anderer Personen.
 * key = Record-ID + Sendezeitpunkt: Wird dieselbe Mitteilung erneut gesendet, gilt sie
 * in der App wieder als neu.
 */
export function mitteilungFuerApp(rec) {
  const f = (rec && rec.fields) || {};
  const datum = String(val(f.Gesendet_Am) || rec.createdTime || '');
  const text = String(val(f.Gesendeter_Text) || '').trim() || mitteilungText(f);
  return { id: rec.id, key: `${rec.id}|${datum}`, titel: mitteilungTitel(f), text, datum };
}

/** Airtable-Formel: gesendete Mitteilungen der letzten ANZEIGE_TAGE Tage. */
export function mitteilungenFormel() {
  return `AND({Status} = 'Gesendet', IS_AFTER(IF({Gesendet_Am}, {Gesendet_Am}, CREATED_TIME()), `
    + `DATEADD(NOW(), -${ANZEIGE_TAGE}, 'days')))`;
}

const FELDER = ['Titel', 'Typ', 'Nachricht', 'Zielgruppe', 'Betroffener_Patient', 'Ausfall_Mitarbeiter',
  'Ersatz_Mitarbeiter', 'Mitarbeiter_Ausfall', 'Mitarbeiter_Ersatz', 'Gesendet_Am', 'Gesendeter_Text'];

/**
 * Gesendete Mitteilungen für eine Person (neueste zuerst, höchstens 30).
 * personId stammt immer aus dem geprüften Session-Token (IDOR-Schutz). 1 Airtable-Abfrage.
 */
export async function mitteilungenFuer(rolle, personId) {
  const query = `filterByFormula=${encodeURIComponent(mitteilungenFormel())}&`
    + FELDER.map((n) => `fields%5B%5D=${encodeURIComponent(n)}`).join('&');
  const records = await fetchAll(MITTEILUNGEN, query);
  return records
    .filter((r) => mitteilungRelevant(r, rolle, personId))
    .map(mitteilungFuerApp)
    .filter((m) => m.text)
    .sort((a, b) => String(b.datum).localeCompare(String(a.datum)))
    .slice(0, MAX_IN_APP);
}
