// Rechenkern des Stundenzettels - reine Logik ohne Airtable/PDF, damit sie vollständig
// testbar ist (tests/zeitkonto.test.mjs).
//
// Abrechnungsregeln (Vorgabe Pflegedienst, 21.10.2026):
// 1. Es zählen nur Termine, die bereits vorbei sind (geplantes Ende <= Erstellungszeitpunkt).
//    Abgesagte Termine zählen nie.
// 2. Zeit je Termin: die vom Mitarbeiter erfasste Ist-Zeit im 15-Minuten-Takt (identisch zum
//    Formelfeld Ist_Stunden_Monat). Ohne Erfassung gilt die geplante Zeit aus dem Zeitfenster
//    (Von–Bis); solche Zeilen werden gekennzeichnet.
// 3. Liegen zwischen zwei Terminen desselben Tages höchstens 30 Minuten, ist das bezahlte
//    "Kunden-Anfahrt" (eigene Zeile, zählt zur Summe). Liegen mehr als 30 Minuten dazwischen,
//    ist das eine unbezahlte Pause (eigene Zeile, zählt NICHT zur Summe).
// 4. Alle Zeiten liegen im 15-Minuten-Raster; die Monatssumme ist die exakte Addition.
//
// Zeitachse je Tag: Ein Termin beginnt zur geplanten Von-Zeit und dauert so lange wie seine
// angerechnete Zeit. Dauert ein Termin länger, verschiebt sich der nächste entsprechend
// (niemand ist an zwei Orten gleichzeitig) - so wird keine Minute doppelt gezählt.

export const ANFAHRT_MAX_MIN = 30; // Lücke bis einschließlich 30 Min = bezahlte Kunden-Anfahrt
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

/**
 * Berechnet den Zeitnachweis eines Mitarbeiters.
 * @param {Array<{id?: string, fields: object}>} besuche  Airtable-Records (ein Mitarbeiter, ein Monat)
 * @param {{jetzt?: Date|string|number}} [opt]
 */
export function berechneZeitnachweis(besuche, opt = {}) {
  const jetzt = berlin(opt.jetzt === undefined ? Date.now() : opt.jetzt);
  const ausgelassen = { abgesagt: 0, zukunft: 0 };
  const termine = [];
  for (const r of besuche || []) {
    const t = termin(r && r.fields, r && r.id);
    if (t.status === 'Abgesagt') { ausgelassen.abgesagt++; continue; }
    if (!vorbei(t, jetzt)) { ausgelassen.zukunft++; continue; }
    termine.push(t);
  }

  // Nach Tag gruppieren, innerhalb des Tages nach Beginn (Termine ohne Uhrzeit ans Ende).
  const proTag = new Map();
  for (const t of termine) {
    if (!proTag.has(t.datum)) proTag.set(t.datum, []);
    proTag.get(t.datum).push(t);
  }
  const tage = [];
  const summen = { sollMin: 0, einsatzMin: 0, anfahrtMin: 0, pauseMin: 0, bezahltMin: 0, einsaetze: 0, ohneIst: 0 };

  for (const datum of [...proTag.keys()].sort()) {
    const liste = proTag.get(datum).sort((a, b) =>
      (a.start === null) - (b.start === null) || (a.start || 0) - (b.start || 0) ||
      (a.planEnde || 0) - (b.planEnde || 0) || String(a.id).localeCompare(String(b.id)));
    const zeilen = [];
    const tag = { datum, zeilen, sollMin: 0, einsatzMin: 0, anfahrtMin: 0, pauseMin: 0, bezahltMin: 0 };
    let ende = null; // Ende des vorherigen Termins auf der Zeitachse (Minuten)

    for (const t of liste) {
      const min = t.istMin !== null ? t.istMin : (t.planMin || 0);
      const quelle = t.istMin !== null ? 'ist' : (t.planMin ? 'plan' : 'keine');
      let beginn = t.start;

      if (beginn !== null && ende !== null) {
        const luecke = beginn - ende;
        if (luecke > 0 && luecke <= ANFAHRT_MAX_MIN) {
          const m = takt(luecke);
          zeilen.push({ art: 'anfahrt', von: uhr(ende), bis: uhr(beginn), min: m });
          tag.anfahrtMin += m;
        } else if (luecke > ANFAHRT_MAX_MIN) {
          const m = takt(luecke);
          zeilen.push({ art: 'pause', von: uhr(ende), bis: uhr(beginn), min: m });
          tag.pauseMin += m;
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
        istMin: t.istMin,   // erfasste Dauer im 15-Minuten-Takt (null = nicht erfasst)
        min,                // angerechnet: Ist, ohne Erfassung die Soll-Zeit
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
      if (quelle !== 'ist') summen.ohneIst++;
      if (istEnde !== null) ende = istEnde;
    }

    tag.bezahltMin = tag.einsatzMin + tag.anfahrtMin;
    summen.sollMin += tag.sollMin;
    summen.einsatzMin += tag.einsatzMin;
    summen.anfahrtMin += tag.anfahrtMin;
    summen.pauseMin += tag.pauseMin;
    tage.push(tag);
  }
  summen.bezahltMin = summen.einsatzMin + summen.anfahrtMin;
  return { jetzt, tage, summen, ausgelassen };
}
