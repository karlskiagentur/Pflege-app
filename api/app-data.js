import { airtable, fetchAll, sendError, esc, readToken, handledPreflight, ohneDruckLinks, TABLES } from './_lib.js';

// Datensparsamkeit: Diese Felder braucht die Klienten-App nicht (keine Anzeige, keine Logik).
// Sie bleiben in Airtable unverändert, werden aber nicht mehr an das Endgerät übertragen.
// Bewusst eine Sperrliste statt einer Freigabeliste: Jedes Feld, das die App liest, bleibt
// garantiert erhalten - auch wenn die App später neue Felder anzeigt.
// Neues internes Feld in Airtable angelegt? -> hier ergänzen.
export const INTERNE_FELDER = {
  patient: [
    'Login_Code', 'Session_Token', 'Failed_Attempts', 'Locked_Until', // Zugang & Sperre
    'Push_Subscription', 'invite_qr', 'invite_requested',              // Systemfelder
    'Geo_Lat', 'Geo_Lng', 'Geo_Adresse', 'Zuletzt_aktiv',               // interne Auswertung
  ],
  besuch: [
    'Notiz_Intern', 'Hervorhebung', 'Plan_Tag_Key',                     // interne Dienstplanung
    'Pfleger', 'Pfleger_ID', 'Pfleger_Ersatz',                           // interne Personal-IDs (Namen bleiben)
    'Abweichung_Min', 'Ist_Stunden_Monat', 'Dauer_Ist_alt_ungenutzt',   // Arbeitszeit-/Abrechnungsdaten
    'Push_senden', 'Meldungen',                                         // Push-Steuerung, interne Meldungen
    'Pfleger_Druck_Link', 'Dienstplan_Druck_Link', 'Dienstplan drucken', // Druck-Links des Büros (Schlüssel!)
  ],
  dokument: ['Drive_Link', 'Push_Gesendet', 'Push_senden'],
};

// Kopie des Records ohne die genannten Felder (Original bleibt unverändert).
export function ohneFelder(record, felder) {
  if (!record || !record.fields) return record;
  const fields = { ...record.fields };
  for (const f of felder) delete fields[f];
  return { ...record, fields };
}

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ status: 'error', message: 'Nur GET' }); return;
  }
  // Token bevorzugt aus Authorization-Header, sonst Query (Alt-Kompatibilität).
  const token = readToken(req);
  try {
    // Token ist base64url; alles andere gilt als ungültig (verhindert Formel-Injection).
    // WICHTIG: 200 + status:"unauthorized" - nur so loggt die App sauber aus.
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
      res.status(200).json({ status: 'unauthorized' }); return;
    }
    const byToken = encodeURIComponent(`{Session_Token} = '${esc(token)}'`);
    const pdata = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${byToken}&maxRecords=1`);
    const patient = (pdata.records || [])[0];
    if (!patient) { res.status(200).json({ status: 'unauthorized' }); return; }

    // "Zuletzt aktiv" pflegen (gedrosselt): so sieht der Pflegedienst, ob/wann der
    // Klient die App nutzt. Nur schreiben, wenn > 10 Min her (spart Schreibzugriffe).
    // Läuft PARALLEL zu den Datenabfragen statt davor - das spart beim App-Start eine
    // komplette Airtable-Runde. Fehler sind unkritisch und dürfen den Load nie stören.
    const last = patient.fields && patient.fields.Zuletzt_aktiv;
    const stale = !last || (Date.now() - new Date(last).getTime() > 10 * 60 * 1000);
    const aktivitaet = stale
      ? airtable(`${TABLES.PATIENTEN}/${patient.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: { Zuletzt_aktiv: new Date().toISOString() } }),
        }).catch(() => { /* unkritisch */ })
      : Promise.resolve();

    const byPatient = `filterByFormula=${encodeURIComponent(`FIND('${esc(patient.id)}', ARRAYJOIN({PatientID_live}))`)}`;
    const [besuche, tasks, dokumente, kontakte] = await Promise.all([
      fetchAll(TABLES.BESUCHE, byPatient),
      fetchAll(TABLES.AUFGABEN, byPatient),
      fetchAll(TABLES.DOKUMENTE, byPatient),
      // FIX: Kontakte NUR des eingeloggten Patienten (vorher: alle Kontakte aller Patienten).
      fetchAll(TABLES.KONTAKTE, byPatient),
    ]);
    // Vor der Antwort abschließen: Serverless-Funktionen werden nach der Antwort eingefroren.
    await aktivitaet;

    // Format exakt wie der bisherige Aggregator get_full_app_data (nur ohne interne Felder)
    res.status(200).json({
      data: {
        patienten_daten: ohneFelder(patient, INTERNE_FELDER.patient),
        kontakte,
        // Sperrliste + Schutznetz für Druck-Links (auch unter anderem Feldnamen)
        besuche: besuche.map((b) => ohneDruckLinks(ohneFelder(b, INTERNE_FELDER.besuch))),
        tasks,
        dokumente: dokumente.map((d) => ohneFelder(d, INTERNE_FELDER.dokument)),
      },
    });
  } catch (e) {
    sendError(res, e, 'api/app-data');
  }
}
