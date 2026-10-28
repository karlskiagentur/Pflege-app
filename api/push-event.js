import webpush from 'web-push';
import { airtable, fetchAll, sendInfoCopy, reportError, TABLES } from './_lib.js';
import { lohnUploadPush } from './_lohn.js';
import { pushNutzlast, einsatzZeitText } from './_push.js';
import { MITTEILUNGEN, zielgruppeNormal, mitteilungText } from './_mitteilungen.js';

// Push-Ereignisse aus den Airtable-Automationen: { type, recordId }.
//   besuch         Termin freigegeben (Push_senden = "Senden") -> Klient + eingeplanter Mitarbeiter
//   absage         Termin abgesagt (Status "Abgesagt")         -> eingeplanter Mitarbeiter
//   dokument       Dokument freigegeben                         -> Klient
//   mitteilung     Mitteilung auf "Senden"                      -> laut Zielgruppe + Verknüpfte
//   terminanfrage  Anfrage eines Klienten (E-Mail ans Büro)     -> bei Änderungswunsch: Mitarbeiter des Termins
//   lohnabrechnung Lohnabrechnung hochgeladen                   -> der Mitarbeiter (api/_lohn.js)
// Jeder Push trägt ein Ziel (siehe api/_push.js): ein Tipp darauf öffnet in der App genau die
// Ansicht, in der der Inhalt steht. Inhalte kommen immer aus dem Datensatz, nie aus dem
// Aufruf - und jeder Typ hat eine eigene Sperre gegen wiederholtes Auslösen.

// Gleiche VAPID/web-push-Konfiguration wie api/send-push (gleiche Env-Variablen)
const VAPID_PUBLIC_KEY =
  'BGsTbCfunMpxOpMNTuMy9S5ERDA1yUi3mYhWa5zkBOXrcCnDxLSaYt4ixweedP7zhP4sOUG3--ZrjssD0W2daFo';
webpush.setVapidDetails(
  'mailto:soulstories.love@gmail.com',
  VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const TITLE = 'Wunschlos Pflege';
export const ABSAGE_SPERRE_MS = 10 * 60 * 1000; // höchstens ein Absage-Push je Einsatz in 10 Min.

// Lookup-/Link-Felder tolerant auslesen
const firstLink = (v) => (Array.isArray(v) ? v[0] : v);
const val = (v) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
const txt = (v) => {
  const x = val(v);
  return String(x && typeof x === 'object' && 'name' in x ? x.name : x);
};
const linkIds = (v) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean))];

// de-DE Datum + Uhrzeit (deutsche Zeitzone, damit die Uhrzeit stimmt) - Klienten-Texte
function fmt(v) {
  const raw = val(v);
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
}

// Datensatz laden. Nicht gefunden (404) -> null (fachlich leer);
// echte Fehler (Airtable nicht erreichbar, 429, 5xx) werfen weiter -> 500.
async function loadRec(table, id) {
  if (!id) return null;
  try {
    return await airtable(`${table}/${id}`);
  } catch (e) {
    if (e && e.status === 404) return null;
    throw e;
  }
}

// Empfänger: Abo (JSON-Text) -> Push-Inhalt. Dasselbe Abo bekommt nur EINEN Push.
function aboVon(rec) {
  const abo = rec && rec.fields && rec.fields.Push_Subscription;
  if (!abo) return '';
  return typeof abo === 'string' ? abo : JSON.stringify(abo);
}
function hinzufuegen(empfaenger, rec, nutzlast) {
  const abo = aboVon(rec);
  if (abo && !empfaenger.has(abo)) empfaenger.set(abo, nutzlast);
}
const aktiv = (rec) => !!(rec && rec.fields && rec.fields.Aktiv);

// Endpoint gekürzt fürs Log (letzte ~12 Zeichen genügen zur Unterscheidung)
const kurzEndpoint = (sub) => {
  try { const e = JSON.parse(sub).endpoint || ''; return '...' + e.slice(-12); } catch { return '?'; }
};

// Versendet an alle Empfänger, sammelt je Abo ein Detail-Ergebnis (fürs Airtable-Log)
async function sendToAll(empfaenger) {
  let gesendet = 0, fehlgeschlagen = 0;
  const details = [];
  for (const [s, payload] of empfaenger) {
    const endpointKurz = kurzEndpoint(s);
    try {
      const r = await webpush.sendNotification(JSON.parse(s), payload);
      gesendet++;
      details.push({ endpointKurz, code: (r && r.statusCode) || 201 });
    } catch (err) {
      fehlgeschlagen++;
      const code = err && err.statusCode;
      const eintrag = { endpointKurz, code: code || 'ERR' };
      if (code === 404 || code === 410) {
        eintrag.hinweis = 'Abo abgelaufen - Benachrichtigungen in der App neu aktivieren';
      } else {
        eintrag.fehler = String((err && err.message) || err);
      }
      console.error('Push fehlgeschlagen:', endpointKurz, code, err && err.body);
      details.push(eintrag);
    }
  }
  return { gesendet, fehlgeschlagen, details };
}

// Klartext eines Einsatzes für Mitarbeiter: "Grundpflege bei Frau M."
function einsatzBei(f) {
  const taetigkeit = txt(f['Tätigkeit']).trim() || 'Einsatz';
  const klient = txt(f.Patient_Name).trim();
  return klient ? `${taetigkeit} bei ${klient}` : taetigkeit;
}

/** Push-Texte für den eingeplanten Mitarbeiter (deutsche Zeit, mit Datum). */
export function mitarbeiterEinsatzText(anlass, fields) {
  const f = fields || {};
  const was = einsatzBei(f);
  const wann = einsatzZeitText(f);
  const mitZeit = wann ? `${was} ${wann}` : was;
  if (anlass === 'Abgesagt') return { titel: 'Einsatz abgesagt', text: `${mitZeit} wurde abgesagt.` };
  if (anlass === 'Geändert') return { titel: 'Einsatz geändert', text: wann ? `${was} ist jetzt ${wann}.` : `${was} wurde geändert.` };
  return { titel: 'Neuer Einsatz', text: `${mitZeit}.` };
}

// Mitarbeiter eines Einsatzes (eingeplant + ggf. Vertretung), nur aktive, ohne Doppelte.
async function einsatzMitarbeiter(f) {
  const liste = [];
  for (const id of linkIds([...linkIds(f.Pfleger), ...linkIds(f.Pfleger_Ersatz)])) {
    const p = await loadRec(TABLES.PERSONAL, id);
    if (aktiv(p)) liste.push(p);
  }
  return liste;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'Nur POST' }); return; }

  const { type, recordId, ereignis } = req.body || {};

  // Leere/kaputte Payloads (z.B. Airtable-Testläufe) sind kein Fehler
  if (!type || !recordId) {
    res.status(200).json({ status: 'skipped', grund: 'Ungültiger Aufruf' }); return;
  }
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(recordId))) {
    res.status(200).json({ status: 'skipped', grund: 'Ungültige ID' }); return;
  }

  try {
    // Lohnabrechnung hochgeladen -> Push an den Mitarbeiter (eigene Regeln in api/_lohn.js:
    // nur einmal je Eintrag, nur frische Uploads, nur an den zugeordneten Mitarbeiter).
    if (type === 'lohnabrechnung') {
      res.status(200).json(await lohnUploadPush(recordId, Date.now()));
      return;
    }

    const empfaenger = new Map();
    let message = '';
    let infoKopie = null; // { typ, empfaenger } -> Info-Kopie ans Büro (nur besuch/dokument/mitteilung)
    let gateTable = null; // Besuche/Dokumente: Push nur nach bewusster Freigabe (Push_senden='Senden')
    let leerGrund = 'Kein Push-Abo (als Gesendet markiert)';

    if (type === 'besuch') {
      const rec = await loadRec(TABLES.BESUCHE, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Besuch nicht gefunden' }); return; }
      const f = rec.fields || {};
      // Bestaetigungs-Gate: Push nur, wenn der Mitarbeiter im Interface aktiv freigegeben hat.
      if (txt(f.Push_senden) !== 'Senden') { res.status(200).json({ status: 'skipped', grund: 'Push nicht freigegeben' }); return; }
      gateTable = TABLES.BESUCHE;
      const patientIds = f.Patient || [];
      if (patientIds.length === 0) { res.status(200).json({ status: 'skipped', grund: 'Kein Klient verknüpft' }); return; }
      const taetigkeit = txt(f['Tätigkeit']) || 'Unterstützung';
      const wann = fmt(f['Uhrzeit']);
      // Anlass serverseitig aus dem Datensatz ableiten - der Freigabe-Trigger
      // (Push_senden='Senden') kennt den Anlass nicht. Status/Hervorhebung sind
      // die verlässliche Quelle; ein explizit übergebenes ereignis bleibt Fallback.
      const status = txt(f.Status);
      const marker = txt(f.Hervorhebung);
      let anlass = ereignis || 'Neu';
      if (status === 'Abgesagt' || marker === 'Storniert') anlass = 'Abgesagt';
      else if (marker === 'Änderung') anlass = 'Geändert';
      if (anlass === 'Abgesagt') {
        message = `Ihr Termin "${taetigkeit}" wurde abgesagt.`;
      } else if (anlass === 'Geändert') {
        message = `Ihr Termin "${taetigkeit}" wurde geändert` + (wann ? ` - neuer Termin: ${wann}.` : '.');
      } else {
        message = `Neuer Termin: "${taetigkeit}"` + (wann ? ` am ${wann}` : '');
      }
      hinzufuegen(empfaenger, await loadRec(TABLES.PATIENTEN, patientIds[0]), pushNutzlast(TITLE, message, 'termine'));
      // Zusätzlich die Mitarbeiter des Einsatzes - mit eigenem Text (Einsatz, Klient,
      // Datum, Uhrzeit). Ist der Termin bereits "Abgesagt", hat sie die Automation
      // "Push an Pfleger bei Stornierung" schon informiert (kein zweiter Push).
      const vorher = empfaenger.size;
      if (status !== 'Abgesagt') {
        const ma = mitarbeiterEinsatzText(anlass, f);
        const nutzlast = pushNutzlast(ma.titel, ma.text, 'plan');
        for (const p of await einsatzMitarbeiter(f)) hinzufuegen(empfaenger, p, nutzlast);
      }
      infoKopie = { typ: 'Termin', empfaenger: empfaenger.size > vorher ? 'Klient + zugeteilter Mitarbeiter' : 'Klient' };

    } else if (type === 'absage') {
      // Termin auf "Abgesagt" -> Push an die Mitarbeiter des Einsatzes (Automation
      // "Push an Pfleger bei Stornierung"). Sperre: höchstens ein Push je Einsatz in 10 Minuten.
      const rec = await loadRec(TABLES.BESUCHE, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Besuch nicht gefunden' }); return; }
      const f = rec.fields || {};
      if (txt(f.Status) !== 'Abgesagt') { res.status(200).json({ status: 'skipped', grund: 'Termin nicht abgesagt' }); return; }
      const zuletzt = Date.parse(txt(f.Push_Absage_MA_Am));
      if (Number.isFinite(zuletzt) && Date.now() - zuletzt < ABSAGE_SPERRE_MS) {
        res.status(200).json({ status: 'skipped', grund: 'Bereits benachrichtigt' }); return;
      }
      // Sperre zuerst setzen (verhindert Doppel-Pushs bei zeitgleichen Auslösungen). Fehlt
      // das Feld, geht der Push trotzdem raus - der Betreiber wird alarmiert.
      try {
        await airtable(`${TABLES.BESUCHE}/${recordId}`, {
          method: 'PATCH', body: JSON.stringify({ fields: { Push_Absage_MA_Am: new Date().toISOString() } }),
        });
      } catch (e) {
        if (!e || e.status !== 422) throw e;
        reportError('api/push-event', 'Besuche: Feld Push_Absage_MA_Am fehlt - Absage-Push ohne Sperre', { status: e.status });
      }
      const ma = mitarbeiterEinsatzText('Abgesagt', f);
      message = ma.text;
      const nutzlast = pushNutzlast(ma.titel, ma.text, 'plan');
      for (const p of await einsatzMitarbeiter(f)) hinzufuegen(empfaenger, p, nutzlast);
      leerGrund = 'Kein Push-Abo';

    } else if (type === 'dokument') {
      const rec = await loadRec(TABLES.DOKUMENTE, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Dokument nicht gefunden' }); return; }
      const f = rec.fields || {};
      // Bestaetigungs-Gate: Push nur, wenn der Mitarbeiter im Interface aktiv freigegeben hat.
      if (txt(f.Push_senden) !== 'Senden') { res.status(200).json({ status: 'skipped', grund: 'Push nicht freigegeben' }); return; }
      gateTable = TABLES.DOKUMENTE;
      const patientIds = f.Patient || [];
      if (patientIds.length === 0) { res.status(200).json({ status: 'skipped', grund: 'Kein Klient verknüpft' }); return; }
      message = `Neue(r) ${txt(f.Typ)} für Sie verfügbar - jetzt in der App ansehen.`;
      hinzufuegen(empfaenger, await loadRec(TABLES.PATIENTEN, patientIds[0]), pushNutzlast(TITLE, message, 'dokumente'));
      infoKopie = { typ: 'Dokument', empfaenger: 'Klient' };

    } else if (type === 'terminanfrage') {
      // Klient -> Pflegedienst (Vorgabe Karl 28.10.): JEDE Anfrage geht als E-Mail an
      // app@wunschlos-pflege.de (eigene Automation „E-Mail: Terminanfrage (Klient)“).
      // Zusätzlich bekommt bei einem ÄNDERUNGSWUNSCH zu einem bestehenden Termin der
      // Mitarbeiter dieses Termins einen Push (Klient, Termin, Datum, Uhrzeit); in seiner App
      // ist der Termin als „Änderungswunsch“ markiert. Neue Terminwünsche haben noch keinen
      // Mitarbeiter -> nur E-Mail. Doppel-Schutz: Buero_benachrichtigt (vor dem Versand gesetzt).
      const rec = await loadRec(TABLES.TERMINANFRAGEN, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Anfrage nicht gefunden' }); return; }
      const f = rec.fields || {};
      if (f.Buero_benachrichtigt) { res.status(200).json({ status: 'skipped', grund: 'Bereits benachrichtigt' }); return; }
      await airtable(`${TABLES.TERMINANFRAGEN}/${recordId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Buero_benachrichtigt: true } }),
      });
      if (txt(f.Art) !== 'Terminänderung') {
        res.status(200).json({ status: 'skipped', grund: 'Neue Terminanfrage: nur E-Mail ans Büro' }); return;
      }
      const besuch = await loadRec(TABLES.BESUCHE, firstLink(f.Betroffener_Termin));
      if (!besuch) { res.status(200).json({ status: 'skipped', grund: 'Kein betroffener Termin' }); return; }
      const bf = besuch.fields || {};
      const wann = einsatzZeitText(bf);
      message = `${einsatzBei(bf)}${wann ? ` ${wann}` : ''}: Der Klient wünscht eine Änderung. Das Büro klärt den neuen Termin.`;
      const nutzlast = pushNutzlast('Änderungswunsch', message, 'plan');
      for (const p of await einsatzMitarbeiter(bf)) hinzufuegen(empfaenger, p, nutzlast);
      leerGrund = 'Kein Push-Abo beim Mitarbeiter des Termins (E-Mail ans Büro läuft)';

    } else if (type === 'mitteilung') {
      const rec = await loadRec(MITTEILUNGEN, recordId);
      if (!rec) { res.status(200).json({ status: 'skipped', grund: 'Mitteilung nicht gefunden' }); return; }
      const f = rec.fields || {};
      // Nur auf "Senden" (bewusste Freigabe im Büro); danach steht sie auf "Gesendet" -
      // ein erneuter Aufruf verschickt nichts. Erneut senden = Status wieder auf "Senden".
      if (txt(f.Status) !== 'Senden') { res.status(200).json({ status: 'skipped', grund: 'Nicht zum Senden freigegeben' }); return; }
      const ziel = zielgruppeNormal(f.Zielgruppe);

      // Empfänger einsammeln: Ausfall/Ersatz und betroffener Klient immer, dazu die Zielgruppe.
      const namen = { ausfall: [], ersatz: [] };
      const personen = []; // Datensätze (Personal/Patienten), deren Abo den Push bekommt
      for (const [art, liste] of [['ausfall', f.Ausfall_Mitarbeiter], ['ersatz', f.Ersatz_Mitarbeiter]]) {
        for (const id of linkIds(liste)) {
          const p = await loadRec(TABLES.PERSONAL, id);
          const name = p && p.fields && p.fields.Name;
          if (name) namen[art].push(String(name).trim());
          if (p) personen.push(p);
        }
      }
      const betroffen = firstLink(f.Betroffener_Patient);
      if (betroffen) {
        const p = await loadRec(TABLES.PATIENTEN, betroffen);
        if (p) personen.push(p);
      }
      if (ziel === 'Alle Mitarbeiter' || ziel === 'Alle gesamt') {
        (await fetchAll(TABLES.PERSONAL, 'fields%5B%5D=Push_Subscription&fields%5B%5D=Aktiv'))
          .filter(aktiv).forEach((p) => personen.push(p));
      }
      if (ziel === 'Alle Patienten' || ziel === 'Alle gesamt') {
        (await fetchAll(TABLES.PATIENTEN, 'fields%5B%5D=Push_Subscription')).forEach((p) => personen.push(p));
      }
      const hatPublikum = personen.length > 0
        || ['Alle Mitarbeiter', 'Alle Patienten', 'Alle gesamt'].includes(ziel);
      if (!hatPublikum) {
        // Status NICHT auf "Gesendet": sonst hinge sie als versendet fest, obwohl niemand sie bekam.
        res.status(200).json({ status: 'skipped', grund: 'Keine Empfänger' }); return;
      }

      message = mitteilungText(f, namen);
      if (!message) message = txt(f.Titel).trim();
      if (!message) { res.status(200).json({ status: 'skipped', grund: 'Kein Text' }); return; }

      // ZUERST als gesendet ablegen (mit Text + Zeitpunkt): Wer auf den Push tippt, findet
      // die Mitteilung sofort in der App. Fehlen die neuen Felder, wird nur der Status gesetzt.
      try {
        await airtable(`${MITTEILUNGEN}/${recordId}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: { Status: 'Gesendet', Gesendet_Am: new Date().toISOString(), Gesendeter_Text: message } }),
        });
      } catch (e) {
        if (!e || e.status !== 422) throw e;
        reportError('api/push-event', 'Mitteilungen: Felder Gesendet_Am/Gesendeter_Text fehlen - nur Status gesetzt', { status: e.status });
        await airtable(`${MITTEILUNGEN}/${recordId}`, {
          method: 'PATCH', body: JSON.stringify({ fields: { Status: 'Gesendet' } }),
        });
      }

      const nutzlast = pushNutzlast(txt(f.Titel).trim() || TITLE, message, 'nachrichten');
      personen.forEach((p) => hinzufuegen(empfaenger, p, nutzlast));
      infoKopie = { typ: 'Mitteilung', empfaenger: ziel || 'Empfänger laut Zielgruppe' };
      leerGrund = 'Kein Push-Abo (Mitteilung steht in der App)';

    } else {
      res.status(200).json({ status: 'skipped', grund: 'Unbekannter type' }); return;
    }

    // Keine Push-Empfänger -> skipped.
    if (empfaenger.size === 0) {
      // Kein Empfaenger-Abo: Freigabe trotzdem als erledigt markieren, damit sie nicht
      // dauerhaft auf "Senden" haengen bleibt und nicht erneut ausloest.
      if (gateTable) {
        await airtable(`${gateTable}/${recordId}`, { method: 'PATCH', body: JSON.stringify({ fields: { Push_senden: 'Gesendet' } }) });
      }
      res.status(200).json({ status: 'skipped', grund: leerGrund }); return;
    }

    const { gesendet, fehlgeschlagen, details } = await sendToAll(empfaenger);

    // Besuche/Dokumente: Freigabe nach dem Versand automatisch auf "Gesendet" (verhindert
    // erneutes Ausloesen; der Mitarbeiter sieht, dass der Push raus ist).
    if (gateTable) {
      await airtable(`${gateTable}/${recordId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { Push_senden: 'Gesendet' } }),
      });
    }

    // Info-Kopie ans Büro: eine Sammelkopie je erfolgreich ausgelöstem Push
    // (besuch/dokument/mitteilung). Enthält den exakten Push-Text, keine PINs/Token.
    if (infoKopie && gesendet > 0) {
      await sendInfoCopy(`📩 Info-Kopie: ${infoKopie.typ}`, `Empfänger: ${infoKopie.empfaenger}\n\n${message}`);
    }

    res.status(200).json({ status: 'ok', gesendet, fehlgeschlagen, details });
  } catch (e) {
    // Nur echte technische Fehler landen hier (Airtable nicht erreichbar, Env fehlt, ...)
    console.error('push-event Fehler:', { type, recordId, message: String((e && e.message) || e) });
    reportError('api/push-event', (e && e.message) || e, { type });
    res.status(500).json({ status: 'error', message: String((e && e.message) || e) });
  }
}
