// Einmaliger Bestands-Lauf: geocodiert alle Patienten ohne Koordinaten bzw. mit geänderter Anschrift.
// Nominatim-Regel: max. 1 Anfrage/Sekunde -> 1,2 s Pause (~300 Klienten ≈ 6 Minuten).
// Start:  node --env-file=.env.local scripts/geocode-backfill.mjs
// .env.local braucht AIRTABLE_TOKEN und AIRTABLE_BASE_ID.

import { fetchAll, TABLES } from '../api/_lib.js';
import { geocodePatient } from '../api/geocode.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const felder = ['Anschrift', 'Geo_Lat', 'Geo_Adresse'].map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join('&');
const alle = await fetchAll(TABLES.PATIENTEN, felder);

const offen = alle.filter((r) => {
  const f = r.fields || {};
  const adresse = String(f.Anschrift || '').trim();
  return adresse && (!f.Geo_Lat || String(f.Geo_Adresse || '') !== adresse);
});

console.log(`${alle.length} Klienten, ${offen.length} zu geocodieren.`);
const stat = { gefunden: 0, nicht_gefunden: 0, unveraendert: 0, keine_adresse: 0, fehler: 0 };

for (const [i, r] of offen.entries()) {
  try {
    const e = await geocodePatient(r.id);
    stat[e] = (stat[e] || 0) + 1;
    if (e === 'nicht_gefunden') console.log(`  [${i + 1}/${offen.length}] NICHT GEFUNDEN: ${r.id}`);
  } catch (err) {
    stat.fehler++;
    console.error(`  [${i + 1}/${offen.length}] Fehler ${r.id}: ${err.message || err}`);
    if (err.status === 429) await pause(10000);
  }
  await pause(1200);
}
console.log('Fertig:', stat);
