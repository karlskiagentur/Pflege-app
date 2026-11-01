import { airtable, sendError, esc, handledPreflight, TABLES } from './_lib.js';
import { aboEndpoint, aboSpeichern, endpointGueltig, geraetAbmelden } from './_abo.js';

// Speichert das Push-Abo am richtigen Datensatz - anhand des Session_Token.
// Funktioniert für Klienten (Patienten-Tabelle) UND Mitarbeiter (Personal-Tabelle).
// Ein Gerät gehört immer nur dem zuletzt angemeldeten Konto (api/_abo.js):
//   { token, subscription }            -> speichern, Gerät bei allen anderen Konten entfernen
//   { token, abmelden: true, endpoint } -> Abmelden: Gerät vom eigenen Konto lösen
const MAX_ABO_LAENGE = 4000;

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  const { token, subscription, abmelden, endpoint } = req.body || {};
  const abmeldung = abmelden === true;
  if (!token || (!abmeldung && !subscription)) {
    res.status(400).json({ status: 'error', message: 'token und subscription nötig' }); return;
  }
  // Token ist base64url; alles andere gilt als ungültig (Injection-Schutz)
  if (!/^[A-Za-z0-9_-]{20,}$/.test(String(token))) {
    res.status(401).json({ status: 'error', message: 'Nicht autorisiert' }); return;
  }
  const geraet = abmeldung ? String(endpoint || '') : aboEndpoint(subscription);
  if (!endpointGueltig(geraet)
    || (!abmeldung && (typeof subscription !== 'object' || JSON.stringify(subscription).length > MAX_ABO_LAENGE))) {
    res.status(400).json({ status: 'error', message: 'Ungültiges Push-Abo' }); return;
  }

  try {
    const formula = encodeURIComponent(`{Session_Token} = '${esc(token)}'`);

    // 1) Klient? 2) Sonst Mitarbeiter?
    let table = TABLES.PATIENTEN;
    let rec = ((await airtable(`${table}?filterByFormula=${formula}&maxRecords=1`)).records || [])[0];
    if (!rec) {
      table = TABLES.PERSONAL;
      rec = ((await airtable(`${table}?filterByFormula=${formula}&maxRecords=1`)).records || [])[0];
    }
    // 3) Nichts gefunden
    if (!rec) { res.status(401).json({ status: 'error', message: 'Nicht autorisiert' }); return; }

    if (abmeldung) {
      const entfernt = await geraetAbmelden(geraet, table, rec);
      res.status(200).json({ status: 'ok', entfernt }); return;
    }
    await aboSpeichern(table, rec, subscription);
    res.status(200).json({ status: 'ok' });
  } catch (e) {
    sendError(res, e, 'api/save-subscription');
  }
}
