// Rechenkern des Stundenzettels - reine Logik ohne Airtable/PDF, damit sie vollständig
// testbar ist (tests/zeitkonto.test.mjs).
//
// Abrechnungsregeln (Vorgabe Pflegedienst, 21.10.2026):
// 1. Es zählen nur Termine, die bereits vorbei sind (geplantes Ende <= Erstellungszeitpunkt).
//    Abgesagte Termine zählen nie. Ausnahme: Abwesenheiten (Regel 5 und 7) trägt das Büro ein – sie
//    gelten für den ganzen Zeitraum, auch wenn der Tag noch bevorsteht. Das betrifft nur vorläufige
//    Zettel (beim fertigen Zettel ist jeder Tag vorbei): Wer vor dem Stichtag prüft, sieht so alles,
//    was eingetragen ist (Meldung Geschäftsleitung 25.11.2026).
// 2. Zeit je Termin: NUR die bestätigte Ist-Zeit – in der App vom Mitarbeiter bestätigt oder vom
//    Büro eingetragen (Feld Dauer_Ist) –, im 15-Minuten-Takt (identisch zum Formelfeld
//    Ist_Stunden_Monat). Ohne Bestätigung wird NICHTS berechnet (Vorgabe Karl 30.10.2026, gegen
//    Arbeitszeitbetrug; vorher galt dann die geplante Zeit). Solche Termine zählen weder als
//    Einsatz noch für die Kunden-Anfahrt; sie stehen getrennt als „nicht bestätigt" auf dem
//    Zettel, damit das Büro sie prüfen und tatsächlich geleistete Zeit nachtragen kann.
//    Eine bestätigte 0 (z. B. Klient nicht angetroffen) ist eine Bestätigung und zählt 0.
// 3. Liegen zwischen zwei Terminen desselben Tages höchstens 30 Minuten, ist das bezahlte
//    "Kunden-Anfahrt" (eigene Zeile, zählt zur Summe). Liegen mehr als 30 Minuten, aber weniger
//    als 1 Stunde dazwischen, werden trotzdem 30 Minuten als Kunden-Anfahrt bezahlt - die Fahrt
//    zum nächsten Klienten fällt ja an; nur der Rest ist unbezahlte Pause (eigene Zeile, zählt
//    NICHT zur Summe). Beispiel: Lücke 0:45 = 0:15 Pause + 0:30 Anfahrt. (Vorgabe Karl
//    28.10.2026; vorher galt eine Lücke über 30 Minuten komplett als Pause.)
//    Ab 1 Stunde zwischen zwei Terminen gibt es KEINE Kunden-Anfahrt: Die ganze Lücke ist
//    unbezahlte Pause (Vorgabe Geschäftsleitung 27.11.2026 - bei so viel Zeit dazwischen ist es
//    keine Fahrt von Klient zu Klient; gemeldete Beispiele: Lücken von 2:30 und 3:30 Stunden).
//    Beide Grenzen (30 Minuten, 1 Stunde) gelten für die Lücke in Minuten laut den Uhrzeiten.
// 4. Einsätze, Anfahrt und Pausen liegen im 15-Minuten-Raster; die Monatssumme ist die exakte
//    Addition.
// 5. Urlaub/Gleitzeit/Krank/Abwesenheit (eigene Dienstplan-Zeile ohne Klient, Spalte
//    „Abwesend/Urlaub“; Wunsch Pflegedienst 06.11.2026) ist KEIN Einsatz: zählt nicht als Einsatz,
//    nie zu Soll oder Ist, bekommt keine Kunden-Anfahrt und steht nicht unter „nicht bestätigt“
//    (auch eine dort eingetragene Ist-Zeit zählt nicht). Wie in üblichen Betrieben (Vorgabe Karl
//    07.11.2026, Regel: api/_abrechnung.js): Urlaub mit den vom Büro eingetragenen Stunden zählt
//    zur Monatssumme; Gleitzeit steht mit Stunden auf dem Zettel, zählt aber nicht (Freizeitausgleich
//    aus dem Zeitkonto); Krank steht als Tag da („–“) – trägt das Büro Stunden ein (Teil-/Vollzeit;
//    Wunsch Geschäftsleitung 25.11.2026), zählen sie wie Urlaub zur Monatssumme; Abwesend steht nur
//    als Tag da. Von/Bis ist bei einer Abwesenheit nur das Zeitfenster und zählt nie.
// 6. „Abrechnen ohne Lohn“ (Spalte im Dienstplan, Wunsch Geschäftsleitung 23.11.2026, Regel:
//    api/_abrechnung.js): Ein so markierter Einsatz MIT Klient wird dem Klienten berechnet, ist aber
//    keine Arbeitszeit. Er zählt nie als Einsatz, nie zu Soll oder Ist, bekommt keine
//    Kunden-Anfahrt und steht nicht unter „nicht bestätigt“ – auch eine dort eingetragene Ist-Zeit
//    zählt nicht. Er steht getrennt als „ohne Arbeitszeit“ auf dem Zettel. Ohne Haken gilt alles
//    wie bisher; „Abgesagt“ geht vor.
// 7. Abwesenheit an einem ABGESAGTEN Einsatz mit Klient (Meldung Geschäftsleitung 25.11.2026): So
//    trägt das Büro Krankheit ein – die Einsätze der Kranken werden abgesagt und bekommen in
//    „Abwesend/Urlaub“ die Auswahl „Krank“. Der Tag ist dann ein Abwesenheitstag dieser Art: EIN
//    Eintrag je Tag und Art, Zeitfenster = Spanne der ausgefallenen Einsätze, Stunden = Summe der an
//    ihnen eingetragenen „Stunden Urlaub/Gleitzeit“ (Regel: api/_abrechnung.js). Gibt es für den Tag
//    schon eine eigene Zeile derselben Art (Regel 5), gilt nur diese – nichts zählt doppelt. Der
//    Einsatz selbst bleibt abgesagt. Ein NICHT abgesagter Einsatz mit der Auswahl bleibt ein Einsatz
//    (er kann z. B. inzwischen bei der Vertretung liegen). Die Mitarbeiter-App zählt die so
//    eingetragenen Stunden in der Ansicht „Zeit“ nach derselben Regel (bezahlteAusfallTage).
//
// Zeitachse je Tag: Ein Termin beginnt zur geplanten Von-Zeit und dauert so lange wie seine
// angerechnete Zeit. Dauert ein Termin länger, verschiebt sich der nächste entsprechend
// (niemand ist an zwei Orten gleichzeitig) - so wird keine Minute doppelt gezählt.

import {
  abwesenheitsMinuten, abwesenheitBezahlt, abwesenheitMitStunden, abwesenheitStundenFreiwillig,
  abrechnenOhneLohn, abrechnungsmonatFuer, ABWESENHEIT_STUNDEN_MAX_MIN,
} from './_abrechnung.js';

// Bezahlte Kunden-Anfahrt je Lücke zwischen zwei Terminen: bis 30 Min die ganze Lücke,
// bei längerer Lücke genau 30 Min (der Rest ist Pause) - ab 1 Stunde keine Anfahrt mehr.
export const ANFAHRT_MAX_MIN = 30;
// Ab dieser Lücke (Minuten) wird keine Kunden-Anfahrt berechnet: Die ganze Lücke ist
// unbezahlte Pause (Vorgabe Geschäftsleitung 27.11.2026, „ab 1 Stunde“ - Regel 3).
export const ANFAHRT_KEINE_AB_MIN = 60;
const TAKT = 15;                    // Abrechnungstakt in Minuten

const pad = (n) => String(n).padStart(2, '0');

// Minuten im 15-Minuten-Takt (kaufmännisch gerundet, wie ROUND() in Airtable).
export const takt = (min) => Math.round((Number(min) || 0) / TAKT) * TAKT;

// Minuten -> "h:mm" (z. B. 150 -> "2:30").
export const hm = (min) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
};

// Minuten seit Mitternacht -> "HH:mm".
export const uhr = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

// "HH:mm" -> Minuten seit Mitternacht (oder null).
export const minutenAus = (s) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
};

// Datum + Uhrzeit (Minuten) in Europe/Berlin für einen Zeitpunkt.
export function berlin(zeitpunkt) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(zeitpunkt));
  const get = (t) => (p.find((x) => x.type === t) || {}).value;
  return { datum: `${get('year')}-${get('month')}-${get('day')}`, min: Number(get('hour')) * 60 + Number(get('minute')) };
}

// Airtable liefert Lookup-/Select-Werte mal als Array, mal als Wert, mal als Objekt.
const text = (v) => {
  if (Array.isArray(v)) return text(v[0]);
  if (v && typeof v === 'object') return String(v.name || '');
  return v === undefined || v === null ? '' : String(v);
};

// Abwesenheit im Dienstplan: Das Büro legt für den Tag eine eigene Zeile OHNE Klient an und wählt
// in der Spalte „Abwesend/Urlaub“ „Urlaub“, „Gleitzeit“, „Krank“ oder „Abwesend“ (leer = Mitarbeiter ist da).
// Jeder Wert gilt als Abwesenheit – auch später ergänzte Auswahlwerte.
// Steht die Auswahl an einem Einsatz MIT Klient, bleibt es ein Einsatz: Er verschwindet nie aus
// einem Plan (z. B. bei der Vertretung) und bleibt bestätigbar; der Dienstplan zeigt dann den
// Hinweis „Urlaub eingetragen“, damit das Büro die Planung klärt.
export const ABWESENHEIT_FELD = 'Abwesend/Urlaub';
export const abwesenheitsAuswahl = (fields) => text((fields || {})[ABWESENHEIT_FELD]).trim();
const mitKlient = (f) => (Array.isArray(f.Patient) ? f.Patient.length > 0 : !!f.Patient) || text(f.Patient_Name).trim() !== '';
export const abwesenheit = (fields) => {
  const f = fields || {};
  return mitKlient(f) ? '' : abwesenheitsAuswahl(f);
};
// Regel 7: Auswahl an einem ABGESAGTEN Einsatz mit Klient – der Einsatz ist wegen dieser Abwesenheit
// ausgefallen (so trägt das Büro z. B. Krankheit ein). '' = trifft nicht zu.
export const ausfallWegen = (fields) => {
  const f = fields || {};
  return mitKlient(f) && text(f.Status) === 'Abgesagt' ? abwesenheitsAuswahl(f) : '';
};

// Grund einer Abwesenheit aus dem Feld Tätigkeit (frei eintragbar, z. B. „Arzttermin“) – ohne
// Wiederholung der Art und ohne den Standardtext „Unterstützung“ der App.
export function abwesenheitsGrund(art, taetigkeit) {
  const g = String(taetigkeit || '').trim();
  if (!g || g.toLowerCase() === String(art || '').trim().toLowerCase() || g === 'Unterstützung') return '';
  return g;
}

// Einen Besuch (Airtable-Felder) in einen normierten Termin übersetzen.
export function termin(fields, id = '') {
  const f = fields || {};
  const uhrzeit = f.Uhrzeit ? berlin(f.Uhrzeit) : null;
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(f.Datum || '')) ? String(f.Datum) : (uhrzeit ? uhrzeit.datum : null);
  const von = minutenAus(text(f.Von));
  const bis = minutenAus(text(f.Bis));
  const start = von !== null ? von : (uhrzeit ? uhrzeit.min : null);

  // Geplante Dauer: Zeitfenster Von–Bis ist führend (immer aktuell); Dauer_Soll nur als
  // Rückfall für Altdaten ohne Bis (das Feld wird per Automation nachgeführt).
  let planMin = null;
  if (start !== null && bis !== null && bis > start) planMin = takt(bis - start);
  else if (Number(f.Dauer_Soll) > 0) planMin = takt(Number(f.Dauer_Soll) / 60);

  // Ist-Zeit im 15-Minuten-Takt - gleiche Rundung wie das Formelfeld Ist_Stunden_Monat.
  // Auch eine bewusst erfasste 0 (z. B. Klient nicht angetroffen) ist eine Ist-Zeit und
  // wird NICHT durch die geplante Zeit ersetzt.
  let istMin = null;
  if (typeof f.Dauer_Ist === 'number' && f.Dauer_Ist >= 0) istMin = takt(f.Dauer_Ist / 60);
  else if (Number(f.Ist_Stunden_Monat) > 0) istMin = takt(Number(f.Ist_Stunden_Monat) / 60);

  const abw = abwesenheit(f);
  const ausfall = ausfallWegen(f);
  return {
    id,
    datum,
    start,
    planEnde: start !== null && planMin !== null ? start + planMin : null,
    planMin,
    istMin,
    status: text(f.Status),
    klient: text(f.Patient_Name).trim(),
    taetigkeit: text(f['Tätigkeit']).trim(),
    vonText: text(f.Von),
    bisText: text(f.Bis),
    abwesenheit: abw, // '' = normaler Einsatz
    // Minuten laut „Stunden Urlaub/Gleitzeit“ (Urlaub, Gleitzeit, Krank); null = nicht eingetragen,
    // Krank ohne Stunden oder eine Art ohne Stunden (Abwesend)
    stundenMin: abw ? abwesenheitsMinuten(f, abw) : null,
    // Regel 6: „Abrechnen ohne Lohn“ – nur an einem Einsatz mit Klient (sonst ohne Bedeutung)
    ohneLohn: mitKlient(f) && abrechnenOhneLohn(f),
    // Regel 7: abgesagter Einsatz mit Auswahl in „Abwesend/Urlaub“. Nur gesetzt, wenn es zutrifft –
    // alle übrigen Termine behalten ihren Aufbau.
    ...(ausfall ? { ausfall, ausfallStundenMin: abwesenheitsMinuten(f, ausfall) } : {}),
  };
}

// Liegt der Termin vollständig in der Vergangenheit (bezogen auf "jetzt" in Berlin)?
export function vorbei(t, jetzt) {
  if (!t.datum) return false;
  if (t.datum < jetzt.datum) return true;
  if (t.datum > jetzt.datum) return false;
  // heute: erst nach dem geplanten Ende (ohne Zeitangabe: erst ab morgen)
  return t.planEnde !== null && t.planEnde <= jetzt.min;
}

// Reihenfolge innerhalb eines Tages: nach Beginn (ohne Uhrzeit ans Ende), dann Ende, dann ID.
const reihenfolge = (a, b) =>
  (a.start === null) - (b.start === null) || (a.start || 0) - (b.start || 0) ||
  (a.planEnde || 0) - (b.planEnde || 0) || String(a.id).localeCompare(String(b.id));
const nachDatum = (a, b) => String(a.datum).localeCompare(String(b.datum));

/**
 * Abwesenheitseinträge aus normierten Terminen (Regel 5 und 7), nach Datum sortiert – bei gleichem
 * Datum die eigenen Zeilen zuerst.
 * @param {Array} eigene     nicht abgesagte Zeilen ohne Klient mit Auswahl (termin().abwesenheit)
 * @param {Array} ausfaelle  abgesagte Einsätze mit Auswahl (termin().ausfall)
 * @param {{datum: string, min: number}|null} [jetzt]  berlin(...) – setzt `bevorstehend`, wenn der Tag
 *   noch nicht vorbei ist; null = nicht kennzeichnen
 * @returns {Array<{id, datum, art, grund, von, bis, min, einsaetze?, bevorstehend?}>}  `einsaetze`
 *   tragen nur die Einträge nach Regel 7 (Anzahl der abgesagten Einsätze dahinter)
 */
export function abwesenheitsEintraege(eigene, ausfaelle, jetzt = null) {
  const liste = eigene
    .filter((t) => t.datum)
    .sort((a, b) => nachDatum(a, b) || reihenfolge(a, b))
    .map((t) => ({
      id: t.id,
      datum: t.datum,
      art: t.abwesenheit,
      grund: abwesenheitsGrund(t.abwesenheit, t.taetigkeit),
      von: t.vonText || (t.start !== null ? uhr(t.start) : ''),
      bis: t.bisText || (t.planEnde !== null ? uhr(t.planEnde) : ''),
      // Stunden laut Spalte „Stunden Urlaub/Gleitzeit“ (Urlaub, Gleitzeit, Krank); null = nicht
      // eingetragen oder eine Art ohne Stunden. Von/Bis oben ist nur das Zeitfenster und zählt nie.
      min: t.stundenMin,
      ...(jetzt && !vorbei(t, jetzt) ? { bevorstehend: true } : {}),
    }));

  // Regel 7: je Tag und Art EIN Eintrag aus den abgesagten Einsätzen – außer es gibt für den Tag
  // schon eine eigene Zeile derselben Art (dann gilt nur diese, nichts zählt doppelt).
  const schluessel = (datum, art) => `${datum}\u0000${art}`;
  const eigeneTage = new Set(liste.map((a) => schluessel(a.datum, a.art)));
  const proTagArt = new Map();
  for (const t of ausfaelle.filter((x) => x.datum).sort((a, b) => nachDatum(a, b) || reihenfolge(a, b))) {
    const k = schluessel(t.datum, t.ausfall);
    if (eigeneTage.has(k)) continue;
    let e = proTagArt.get(k);
    if (!e) {
      e = { id: t.id, datum: t.datum, art: t.ausfall, start: null, ende: null, mitZeit: true, min: null, einsaetze: 0, bevorstehend: false };
      proTagArt.set(k, e);
    }
    e.einsaetze++;
    if (t.start === null || t.planEnde === null) e.mitZeit = false;
    else {
      e.start = e.start === null ? t.start : Math.min(e.start, t.start);
      e.ende = e.ende === null ? t.planEnde : Math.max(e.ende, t.planEnde);
    }
    if (typeof t.ausfallStundenMin === 'number') e.min = (e.min || 0) + t.ausfallStundenMin;
    if (jetzt && !vorbei(t, jetzt)) e.bevorstehend = true;
  }
  for (const e of proTagArt.values()) {
    liste.push({
      id: e.id,
      datum: e.datum,
      art: e.art,
      grund: '',
      // Zeitfenster = Spanne der ausgefallenen Einsätze (nur wenn alle eine Uhrzeit haben)
      von: e.mitZeit && e.start !== null ? uhr(e.start) : '',
      bis: e.mitZeit && e.ende !== null ? uhr(e.ende) : '',
      // Summe der an den Einsätzen eingetragenen Stunden; mehr als ein ganzer Tag = Tippfehler
      min: e.min !== null && e.min <= ABWESENHEIT_STUNDEN_MAX_MIN ? e.min : null,
      einsaetze: e.einsaetze, // so viele abgesagte Einsätze stehen hinter dem Eintrag
      ...(e.bevorstehend ? { bevorstehend: true } : {}),
    });
  }
  return liste.sort(nachDatum); // stabil: eigene Zeilen bleiben vor den abgeleiteten des Tages
}

/**
 * Regel 7 für die Mitarbeiter-App (Ansicht „Zeit“): Abwesenheitstage aus abgesagten Einsätzen, deren
 * eingetragene Stunden zur Monatssumme zählen (Krank mit Stunden, Urlaub) – dieselbe Regel wie auf
 * dem Stundenzettel, damit die App dieselben Stunden zeigt. Eigene Abwesenheitszeilen (Regel 5)
 * zeigt die App selbst; sie gehen hier nur ein, damit nichts doppelt zählt.
 * @param {Array<{id?: string, fields?: object}>} zeilen  rohe Dienstplan-Zeilen EINES Mitarbeiters
 * @returns {Array<{id: string, datum: string, art: string, min: number, einsaetze: number,
 *   von: string, bis: string}>}  nach Datum sortiert; min > 0
 */
export function bezahlteAusfallTage(zeilen) {
  const eigene = [];
  const ausfaelle = [];
  for (const r of Array.isArray(zeilen) ? zeilen : []) {
    const f = r && r.fields && typeof r.fields === 'object' ? r.fields : r;
    if (!f || typeof f !== 'object' || !abwesenheitsAuswahl(f)) continue; // fast alle Zeilen: keine Auswahl
    const t = termin(f, String((r && r.id) || ''));
    if (t.status === 'Abgesagt') { if (t.ausfall) ausfaelle.push(t); continue; }
    if (t.abwesenheit) eigene.push(t);
  }
  return abwesenheitsEintraege(eigene, ausfaelle)
    .filter((a) => a.einsaetze && abwesenheitBezahlt(a.art) && typeof a.min === 'number' && a.min > 0)
    .map(({ id, datum, art, min, einsaetze, von, bis }) => ({ id, datum, art, min, einsaetze, von, bis }));
}

const tagDanach = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Berechnet den Zeitnachweis eines Mitarbeiters.
 * @param {Array<{id?: string, fields: object}>} besuche  Airtable-Records (ein Mitarbeiter, ein Monat)
 * @param {{jetzt?: Date|string|number, zeitraum?: {von: string, bis: string},
 *   danach?: Array<{id?: string, fields: object}>}} [opt]
 *   zeitraum + danach (Zeilen NACH dem Zeitraum): Damit meldet das Ergebnis in `ueberZeitraumende`,
 *   wenn eine Abwesenheit am letzten Tag des Zeitraums am Tag danach weitergeht (die Tage danach
 *   gehören zum nächsten Stundenzettel).
 */
export function berechneZeitnachweis(besuche, opt = {}) {
  const jetzt = berlin(opt.jetzt === undefined ? Date.now() : opt.jetzt);
  const ausgelassen = { abgesagt: 0, zukunft: 0 };
  const termine = [];
  const offen = []; // vorbei, aber ohne bestätigte Ist-Zeit -> nicht berechnet
  const abwesend = []; // Urlaub/Gleitzeit/Krank/Abwesenheit -> kein Einsatz, getrennt ausgewiesen (Regel 5)
  const ausfaelle = []; // abgesagte Einsätze mit „Krank“ o. ä. -> Abwesenheitstag (Regel 7)
  const markiert = []; // „Abrechnen ohne Lohn“ -> keine Arbeitszeit, getrennt ausgewiesen (Regel 6)
  for (const r of besuche || []) {
    const t = termin(r && r.fields, r && r.id);
    if (t.status === 'Abgesagt') {
      ausgelassen.abgesagt++;
      if (t.ausfall) ausfaelle.push(t); // der Einsatz bleibt abgesagt, der Tag wird Abwesenheitstag
      continue;
    }
    // Abwesenheiten gelten für den ganzen Zeitraum (Regel 1) – auch eine dort eingetragene Ist-Zeit zählt nicht
    if (t.abwesenheit) { abwesend.push(t); continue; }
    if (!vorbei(t, jetzt)) { ausgelassen.zukunft++; continue; }
    if (t.ohneLohn) { markiert.push(t); continue; }    // ebenso: weder Ist noch „nicht bestätigt“
    if (t.istMin === null) { offen.push(t); continue; }
    termine.push(t);
  }
  const abwesenheiten = abwesenheitsEintraege(abwesend, ausfaelle, jetzt);
  const nichtBestaetigt = offen
    .sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || reihenfolge(a, b))
    .map((t) => ({
      id: t.id,
      datum: t.datum,
      von: t.vonText || (t.start !== null ? uhr(t.start) : ''),
      bis: t.bisText || (t.planEnde !== null ? uhr(t.planEnde) : ''),
      sollMin: t.planMin,
      klient: t.klient,
      taetigkeit: t.taetigkeit,
    }));
  // Regel 6: vom Büro mit „Abrechnen ohne Lohn“ markierte Einsätze – nur zur Information, zählen
  // nirgends mit (bewusst NICHT in `summen`: Deren Aufbau bleibt unverändert).
  const ohneLohn = markiert
    .sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || reihenfolge(a, b))
    .map((t) => ({
      id: t.id,
      datum: t.datum,
      von: t.vonText || (t.start !== null ? uhr(t.start) : ''),
      bis: t.bisText || (t.planEnde !== null ? uhr(t.planEnde) : ''),
      sollMin: t.planMin,
      klient: t.klient,
      taetigkeit: t.taetigkeit,
    }));

  // Nach Tag gruppieren, innerhalb des Tages nach Beginn (Termine ohne Uhrzeit ans Ende).
  const proTag = new Map();
  for (const t of termine) {
    if (!proTag.has(t.datum)) proTag.set(t.datum, []);
    proTag.get(t.datum).push(t);
  }
  const tage = [];
  // ohneIst = Anzahl nicht bestätigter Termine (nicht berechnet), ohneIstSollMin = ihre geplante Zeit
  // Regel 5: abwesenheitBezahltMin = Urlaubsstunden (zählen zur Monatssumme), abwesenheitZeitkontoMin =
  // Gleitzeit (Freizeitausgleich, steht nur da), abwesenheitOhneStunden = Urlaub/Gleitzeit ohne
  // eingetragene Stunden (zählen 0:00). Krank zählt mit den eingetragenen Stunden zu
  // abwesenheitBezahltMin; Krank ohne Stunden ist keine Lücke. Abwesend hat nie Stunden.
  const summen = {
    sollMin: 0, einsatzMin: 0, anfahrtMin: 0, pauseMin: 0, bezahltMin: 0, einsaetze: 0,
    ohneIst: nichtBestaetigt.length,
    ohneIstSollMin: nichtBestaetigt.reduce((s, t) => s + (t.sollMin || 0), 0),
    abwesenheitBezahltMin: abwesenheiten.filter((a) => abwesenheitBezahlt(a.art)).reduce((s, a) => s + (a.min || 0), 0),
    abwesenheitZeitkontoMin: abwesenheiten.filter((a) => abwesenheitMitStunden(a.art) && !abwesenheitBezahlt(a.art))
      .reduce((s, a) => s + (a.min || 0), 0),
    abwesenheitOhneStunden: abwesenheiten.filter((a) => abwesenheitMitStunden(a.art) && a.min === null).length,
  };

  for (const datum of [...proTag.keys()].sort()) {
    const liste = proTag.get(datum).sort(reihenfolge);
    const zeilen = [];
    const tag = { datum, zeilen, sollMin: 0, einsatzMin: 0, anfahrtMin: 0, pauseMin: 0, bezahltMin: 0 };
    let ende = null; // Ende des vorherigen Termins auf der Zeitachse (Minuten)

    for (const t of liste) {
      const min = t.istMin;  // nur bestätigte Termine stehen auf der Zeitachse
      const quelle = 'ist';
      let beginn = t.start;

      if (beginn !== null && ende !== null) {
        const luecke = beginn - ende;
        if (luecke > 0 && luecke <= ANFAHRT_MAX_MIN) {
          const m = takt(luecke);
          zeilen.push({ art: 'anfahrt', von: uhr(ende), bis: uhr(beginn), min: m });
          tag.anfahrtMin += m;
        } else if (luecke >= ANFAHRT_KEINE_AB_MIN) {
          // Ab 1 Stunde zwischen zwei Einsätzen: keine Kunden-Anfahrt, die ganze Lücke ist
          // unbezahlte Pause (Vorgabe Geschäftsleitung 27.11.2026). Die Grenze gilt für die
          // Lücke in Minuten, so wie die Uhrzeiten auf dem Zettel sie zeigen (wie bei der
          // 30-Minuten-Grenze); die Pause steht wie jede Zeile im 15-Minuten-Takt da.
          const pause = takt(luecke);
          zeilen.push({ art: 'pause', von: uhr(ende), bis: uhr(beginn), min: pause });
          tag.pauseMin += pause;
        } else if (luecke > ANFAHRT_MAX_MIN) {
          // Längere Lücke unter 1 Stunde: 30 Min Kunden-Anfahrt sind trotzdem bezahlt, nur der
          // Rest ist Pause. Auf der Zeitachse liegt die Anfahrt direkt vor dem nächsten Einsatz
          // (Fahrt zum Klienten), die Pause davor. Gesamtlänge wie bisher im 15-Minuten-Takt;
          // bleibt nach dem Runden keine Pause übrig (z. B. 35 Min), deckt die Anfahrt die ganze Lücke.
          const gesamt = takt(luecke);
          const anfahrt = Math.min(gesamt, ANFAHRT_MAX_MIN);
          const pause = gesamt - anfahrt;
          const anfahrtVon = pause > 0 ? beginn - anfahrt : ende;
          if (pause > 0) {
            zeilen.push({ art: 'pause', von: uhr(ende), bis: uhr(anfahrtVon), min: pause });
            tag.pauseMin += pause;
          }
          zeilen.push({ art: 'anfahrt', von: uhr(anfahrtVon), bis: uhr(beginn), min: anfahrt });
          tag.anfahrtMin += anfahrt;
        } else if (luecke < 0) {
          beginn = ende; // vorheriger Termin dauerte länger -> dieser beginnt danach
        }
      }

      const istEnde = beginn !== null ? beginn + min : null;
      zeilen.push({
        art: 'einsatz',
        id: t.id,
        // Angezeigt wird das geplante Zeitfenster laut Dienstplan
        von: t.vonText || (t.start !== null ? uhr(t.start) : ''),
        bis: t.bisText || (t.planEnde !== null ? uhr(t.planEnde) : ''),
        sollMin: t.planMin, // geplante Dauer laut Zeitfenster (null = unbekannt)
        istMin: t.istMin,   // bestätigte Dauer im 15-Minuten-Takt
        min,                // angerechnet = bestätigte Ist-Zeit
        quelle,
        // Zeitraum laut Ist auf der Zeitachse (Beginn laut Plan bzw. nach dem vorherigen
        // Einsatz + angerechnete Dauer) - weicht er vom Zeitfenster ab, zeigt der Zettel ihn an.
        istVon: beginn !== null ? uhr(beginn) : '',
        istBis: istEnde !== null ? uhr(istEnde) : '',
        zeitAbweichend: beginn !== null && (beginn !== t.start || istEnde !== t.planEnde),
        klient: t.klient,
        taetigkeit: t.taetigkeit,
      });
      tag.einsatzMin += min;
      tag.sollMin += t.planMin || 0;
      summen.einsaetze++;
      if (istEnde !== null) ende = istEnde;
    }

    tag.bezahltMin = tag.einsatzMin + tag.anfahrtMin;
    summen.sollMin += tag.sollMin;
    summen.einsatzMin += tag.einsatzMin;
    summen.anfahrtMin += tag.anfahrtMin;
    summen.pauseMin += tag.pauseMin;
    tage.push(tag);
  }
  // Monatssumme = bestätigte Einsätze + Kunden-Anfahrt + eingetragene Stunden für Urlaub und Krank (Regel 5)
  summen.bezahltMin = summen.einsatzMin + summen.anfahrtMin + summen.abwesenheitBezahltMin;

  // Geht eine Abwesenheit über das Ende des Zeitraums hinaus (am letzten Tag UND am Tag danach
  // dieselbe Art)? Dann stehen die Tage danach auf dem nächsten Stundenzettel – der Zettel sagt das.
  let ueberZeitraumende = null;
  const bis = opt.zeitraum && opt.zeitraum.bis;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(bis || '')) && Array.isArray(opt.danach)) {
    const amEnde = new Set(abwesenheiten.filter((a) => a.datum === bis).map((a) => a.art));
    if (amEnde.size) {
      const ab = tagDanach(bis);
      const eigene = [];
      const ausfall = [];
      for (const r of opt.danach) {
        const t = termin(r && r.fields, r && r.id);
        if (t.datum !== ab) continue;
        if (t.status === 'Abgesagt') { if (t.ausfall) ausfall.push(t); continue; }
        if (t.abwesenheit) eigene.push(t);
      }
      const arten = [...new Set(abwesenheitsEintraege(eigene, ausfall, null).map((a) => a.art))]
        .filter((art) => amEnde.has(art))
        .sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, 'de'));
      if (arten.length) ueberZeitraumende = { arten, bis, ab, monat: abrechnungsmonatFuer(ab) };
    }
  }
  return {
    jetzt, tage, summen, ausgelassen, nichtBestaetigt, abwesenheiten, ohneLohn,
    // nur gesetzt, wenn es zutrifft – sonst bleibt der Aufbau des Ergebnisses, wie er war
    ...(ueberZeitraumende ? { ueberZeitraumende } : {}),
  };
}

// Reihenfolge auf dem Zettel: bezahlt (Urlaub), Zeitkonto (Gleitzeit), dann Tage ohne Stunden.
const ART_REIHENFOLGE = ['Urlaub', 'Gleitzeit', 'Krank', 'Abwesend'];
const rang = (art) => { const i = ART_REIHENFOLGE.indexOf(art); return i < 0 ? ART_REIHENFOLGE.length : i; };

/**
 * Urlaub/Gleitzeit/Krank/Abwesenheit je Art zusammengefasst (für die Summenzeilen), z. B.
 * [{ art: 'Urlaub', anzahl: 2, tage: 2, min: 480, ohneStunden: 1, mitStunden: true, bezahlt: true }].
 * min = Summe der eingetragenen Stunden; mitStunden = die Art steht mit Stunden auf dem Zettel:
 * Urlaub und Gleitzeit immer, Krank nur, wenn das Büro für mindestens einen Tag Stunden eingetragen
 * hat (sonst bleibt Krank „nur der Tag“); ohneStunden = Einträge ohne Stunden einer Art mit Stunden
 * (zählen 0:00); bezahlt = die Stunden zählen zur Monatssumme (Urlaub, Krank mit Stunden).
 * Reihenfolge: Urlaub, Gleitzeit, Krank, Abwesend, weitere alphabetisch.
 * @param {Array<{art: string, datum: string|null, min: number|null}>} abwesenheiten
 */
export function abwesenheitNachArt(abwesenheiten) {
  const proArt = new Map();
  for (const a of abwesenheiten || []) {
    if (!a || !a.art) continue;
    if (!proArt.has(a.art)) proArt.set(a.art, { art: a.art, anzahl: 0, daten: new Set(), min: 0, mitEintrag: 0, ohneEintrag: 0 });
    const s = proArt.get(a.art);
    s.anzahl++;
    if (a.datum) s.daten.add(a.datum);
    if (typeof a.min === 'number') { s.min += a.min; s.mitEintrag++; } else s.ohneEintrag++;
  }
  return [...proArt.values()]
    .sort((a, b) => rang(a.art) - rang(b.art) || a.art.localeCompare(b.art, 'de'))
    .map(({ art, anzahl, daten, min, mitEintrag, ohneEintrag }) => {
      const mitStunden = abwesenheitMitStunden(art) || (abwesenheitStundenFreiwillig(art) && mitEintrag > 0);
      return {
        art, anzahl, tage: daten.size, min, ohneStunden: mitStunden ? ohneEintrag : 0,
        mitStunden, bezahlt: mitStunden && abwesenheitBezahlt(art),
      };
    });
}
