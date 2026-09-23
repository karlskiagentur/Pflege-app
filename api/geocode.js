import { airtable, sendError, handledPreflight, requireEnv, TABLES } from './_lib.js';

// Geocodiert die Anschrift eines Patienten-Datensatzes (Nominatim / OpenStreetMap)
// und schreibt Geo_Lat / Geo_Lng / Geo_Adresse zurück.
// Aufruf ereignisgesteuert durch die Airtable-Automation „Geocode Klient"
// (POST, Header X-Hook-Secret = GEOCODE_SECRET, Body {"recordId":"rec..."}).
// Es werden ausschließlich Anschriften übertragen – keine Namen, keine Gesundheitsdaten.

const USER_AGENT = 'WunschlosPflegeApp/1.0 (app@wunschlos-pflege.de)';

export async function geocodeAdresse(adresse) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&q='
    + encodeURIComponent(String(adresse).trim());
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' } });
  if (!r.ok) throw Object.assign(new Error(`Nominatim antwortet ${r.status}`), { status: r.status });
  const arr = await r.json();
  const hit = Array.isArray(arr) ? arr[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat), lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

// Rückgabe: 'unveraendert' | 'gefunden' | 'nicht_gefunden' | 'keine_adresse'
export async function geocodePatient(recordId) {
  const rec = await airtable(`${TABLES.PATIENTEN}/${recordId}`);
  const f = rec.fields || {};
  const adresse = String(f.Anschrift || '').trim();

  if (!adresse) {
    await airtable(`${TABLES.PATIENTEN}/${recordId}`, {
      method: 'PATCH', body: JSON.stringify({ fields: { Geo_Lat: null, Geo_Lng: null, Geo_Adresse: '' } }),
    });
    return 'keine_adresse';
  }
  if (String(f.Geo_Adresse || '') === adresse && f.Geo_Lat) return 'unveraendert';

  const geo = await geocodeAdresse(adresse);
  await airtable(`${TABLES.PATIENTEN}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: geo
        ? { Geo_Lat: geo.lat, Geo_Lng: geo.lng, Geo_Adresse: adresse }
        : { Geo_Lat: null, Geo_Lng: null, Geo_Adresse: adresse },
    }),
  });
  return geo ? 'gefunden' : 'nicht_gefunden';
}

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  try {
    requireEnv(['GEOCODE_SECRET']);
    const secret = process.env.GEOCODE_SECRET;
    const given = String((req.headers && (req.headers['x-hook-secret'] || req.headers['X-Hook-Secret'])) || '');
    if (!given || given !== secret) {
      res.status(401).json({ status: 'error', message: 'Nicht autorisiert' }); return;
    }
    const recordId = String((req.body && req.body.recordId) || '');
    if (!/^rec[A-Za-z0-9]{14,}$/.test(recordId)) {
      res.status(400).json({ status: 'error', message: 'recordId nötig' }); return;
    }
    const ergebnis = await geocodePatient(recordId);
    res.status(200).json({ status: 'success', ergebnis });
  } catch (e) {
    sendError(res, e, 'api/geocode');
  }
}
