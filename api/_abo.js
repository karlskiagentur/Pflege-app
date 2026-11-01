import { airtable, esc, TABLES } from './_lib.js';

// Push-Abos und Konten: EIN Gerät (= Abo-Endpoint) gehört immer nur dem Konto, das zuletzt
// darauf angemeldet war. Gespeichert wird das Abo als JSON im Feld Push_Subscription des
// Klienten (Patienten) bzw. Mitarbeiters (Personal).
//
// Vorfall 01.11.2026: Auf einem Handy waren nacheinander ein Klient und ein Mitarbeiter
// angemeldet. Das Abo blieb bei beiden Konten stehen – Einsatz-Pushs des Mitarbeiters (mit
// Klientennamen) kamen weiter auf dem Gerät an, obwohl dort längst ein anderes Konto
// angemeldet war. Deshalb:
//   - beim Speichern wird dasselbe Gerät bei allen ANDEREN Konten entfernt (geraetNurFuer),
//   - beim Abmelden löst die App das Gerät vom eigenen Konto (geraetAbmelden).

const TABELLEN = [TABLES.PATIENTEN, TABLES.PERSONAL];
const FELD = 'Push_Subscription';

// Erlaubte Endpoint-Zeichen: URL ohne Anführungszeichen, Backslash, Leerraum und Klammern {}.
// Endpoints der Push-Dienste (Apple, Google, Mozilla, Microsoft) bestehen nur daraus; alles
// andere wird abgewiesen – der Wert landet in einer Airtable-Formel.
const ENDPOINT_RE = /^https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]{10,1000}$/;
export const endpointGueltig = (e) => typeof e === 'string' && ENDPOINT_RE.test(e);

/** Endpoint aus einem Abo (Objekt oder gespeicherter JSON-Text); '' wenn keiner lesbar ist. */
export function aboEndpoint(abo) {
  if (!abo) return '';
  let o = abo;
  if (typeof abo === 'string') {
    try { o = JSON.parse(abo); } catch { return ''; }
  }
  const e = o && typeof o === 'object' ? o.endpoint : '';
  return typeof e === 'string' ? e : '';
}

const leeren = (table, id) => airtable(`${table}/${id}`, {
  method: 'PATCH',
  body: JSON.stringify({ fields: { [FELD]: '' } }),
});

/**
 * Entfernt das Gerät (endpoint) bei allen Konten außer dem angegebenen – in beiden Tabellen.
 * @returns {Promise<number>} Anzahl der Konten, bei denen es entfernt wurde
 */
export async function geraetNurFuer(endpoint, behalten) {
  if (!endpointGueltig(endpoint)) return 0;
  const formel = encodeURIComponent(`FIND('${esc(endpoint)}', {${FELD}})`);
  let entfernt = 0;
  for (const table of TABELLEN) {
    const data = await airtable(`${table}?filterByFormula=${formel}&fields%5B%5D=${FELD}&maxRecords=20`);
    for (const r of data.records || []) {
      if (table === behalten.table && r.id === behalten.id) continue;
      // Nur exakt dasselbe Gerät (FIND trifft auch längere Endpoints mit gleichem Anfang)
      if (aboEndpoint(r.fields && r.fields[FELD]) !== endpoint) continue;
      await leeren(table, r.id);
      entfernt += 1;
    }
  }
  return entfernt;
}

/**
 * Löst das Gerät vom eigenen Konto – nur wenn dort genau dieses Gerät eingetragen ist
 * (ein anderes Gerät desselben Kontos bleibt unberührt).
 * @returns {Promise<boolean>} true, wenn entfernt
 */
export async function geraetAbmelden(endpoint, table, rec) {
  if (!endpointGueltig(endpoint) || !rec) return false;
  if (aboEndpoint(rec.fields && rec.fields[FELD]) !== endpoint) return false;
  await leeren(table, rec.id);
  return true;
}

/**
 * Speichert das Abo beim Konto und entfernt das Gerät bei allen anderen Konten.
 * Unverändertes Abo = kein Schreibzugriff; die Suche nach anderen Konten läuft nur, wenn das
 * Gerät für dieses Konto neu ist (spart Airtable-Aufrufe beim stillen Abgleich je App-Start).
 */
export async function aboSpeichern(table, rec, subscription) {
  const endpoint = aboEndpoint(subscription);
  const alt = (rec.fields && rec.fields[FELD]) || '';
  const neu = JSON.stringify(subscription);
  if (alt !== neu) {
    await airtable(`${table}/${rec.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { [FELD]: neu } }),
    });
  }
  const entfernt = aboEndpoint(alt) === endpoint ? 0 : await geraetNurFuer(endpoint, { table, id: rec.id });
  return { geaendert: alt !== neu, entfernt };
}
