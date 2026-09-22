import { fetchAll, sendError, esc, handledPreflight, requireKarteKey, TABLES } from './_lib.js';

// Tagesplan aller Mitarbeiter für die Einsatzkarte (public/karte.html).
// Auth: Header X-Karte-Key = KARTE_SECRET. Optional ?datum=YYYY-MM-DD (Standard: heute, Europe/Berlin).

const BERLIN = 'Europe/Berlin';
const AUSGESCHLOSSEN = new Set(['Abgesagt', 'Storniert', 'Archiviert']);
const FARBEN = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];

function heuteBerlin() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BERLIN, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()); // YYYY-MM-DD
}

function minutenBerlin(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: BERLIN, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d);
  const h = Number((parts.find((p) => p.type === 'hour') || {}).value) % 24;
  const m = Number((parts.find((p) => p.type === 'minute') || {}).value);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function hhmm(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Dauer_Soll wird in Stunden gepflegt (z. B. 1.25); Werte > 12 gelten als Minuten.
function dauerMinuten(v) {
  const n = Number(v);
  if (!n || n <= 0) return null;
  return n > 12 ? Math.round(n) : Math.round(n * 60);
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const felderQuery = (namen) => namen.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join('&');

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function patientenNachId(ids) {
  const map = new Map();
  for (const teil of chunk(ids, 30)) {
    const formula = `OR(${teil.map((id) => `RECORD_ID()='${esc(id)}'`).join(',')})`;
    const recs = await fetchAll(TABLES.PATIENTEN,
      `filterByFormula=${encodeURIComponent(formula)}&${felderQuery(['Name', 'Anschrift', 'Geo_Lat', 'Geo_Lng'])}`);
    for (const r of recs) map.set(r.id, r.fields || {});
  }
  return map;
}

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ status: 'error', message: 'Nur GET' }); return;
  }
  try {
    if (!requireKarteKey(req, res)) return;

    const q = String((req.query && req.query.datum) || '');
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : heuteBerlin();

    const formula = `DATETIME_FORMAT({Datum},'YYYY-MM-DD')='${esc(datum)}'`;
    const besuche = await fetchAll(TABLES.BESUCHE,
      `filterByFormula=${encodeURIComponent(formula)}&${felderQuery(['Datum', 'Von', 'Bis', 'Uhrzeit', 'Dauer_Soll', 'Ende', 'Status', 'Patient', 'Pfleger', 'Tätigkeit'])}`);

    // Personal: bewusst nur Name + Fahrzeug anfordern (keine Tokens/Codes in der Antwort).
    const personal = await fetchAll(TABLES.PERSONAL, felderQuery(['Name', 'Fahrzeug']));
    const personalMap = new Map(personal.map((r) => [r.id, r.fields || {}]));

    const patientIds = [...new Set(besuche.map((b) => first(b.fields && b.fields.Patient)).filter(Boolean))];
    const patienten = await patientenNachId(patientIds);

    const proMitarbeiter = new Map();
    const ohneStandort = [];

    for (const b of besuche) {
      const f = b.fields || {};
      if (AUSGESCHLOSSEN.has(String(f.Status || ''))) continue;
      const maId = first(f.Pfleger);
      if (!maId || !personalMap.has(maId)) continue; // Termin ohne Mitarbeiter: nicht kartierbar

      let start = hhmm(f.Von);
      if (start == null && f.Uhrzeit) start = minutenBerlin(f.Uhrzeit);
      if (start == null) continue;

      let ende = hhmm(f.Bis);
      if (ende == null) { const d = dauerMinuten(f.Dauer_Soll); if (d != null) ende = start + d; }
      if (ende == null && f.Ende) ende = minutenBerlin(f.Ende);
      if (ende == null || ende <= start) ende = start + 30;

      const p = patienten.get(first(f.Patient)) || {};
      const lat = Number(p.Geo_Lat), lng = Number(p.Geo_Lng);
      const hatGeo = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
      const maName = String(personalMap.get(maId).Name || 'Mitarbeiter');

      const einsatz = {
        id: b.id, start, ende,
        klient: String(p.Name || 'Klient'),
        adresse: String(p.Anschrift || ''),
        lat: hatGeo ? lat : null,
        lng: hatGeo ? lng : null,
        taetigkeit: String(f['Tätigkeit'] || ''),
        status: String(f.Status || ''),
      };
      if (!hatGeo) ohneStandort.push({ klient: einsatz.klient, adresse: einsatz.adresse, mitarbeiter: maName, start });

      if (!proMitarbeiter.has(maId)) {
        proMitarbeiter.set(maId, { id: maId, name: maName, fahrzeug: String(personalMap.get(maId).Fahrzeug || ''), farbe: '', einsaetze: [] });
      }
      proMitarbeiter.get(maId).einsaetze.push(einsatz);
    }

    const mitarbeiter = [...proMitarbeiter.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map((m, i) => ({ ...m, farbe: FARBEN[i % FARBEN.length], einsaetze: m.einsaetze.sort((a, b) => a.start - b.start) }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      status: 'success',
      datum,
      jetztMin: minutenBerlin(new Date().toISOString()),
      mitarbeiter,
      ohneStandort: ohneStandort.sort((a, b) => a.start - b.start),
    });
  } catch (e) {
    sendError(res, e, 'api/einsatz-karte');
  }
}
