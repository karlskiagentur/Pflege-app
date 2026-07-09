import { airtable, esc, readToken, handledPreflight, reportError, TABLES } from './_lib.js';

// Nur echte Airtable-Anhang-Domains sind als Download-Ziel erlaubt.
// Verhindert Missbrauch als offener Proxy / SSRF gegen beliebige URLs.
const ALLOWED_HOSTS = [
  'airtableusercontent.com',
  'dl.airtable.com',
  'v5.airtableusercontent.com',
];

function hostErlaubt(u) {
  try {
    const { protocol, hostname } = new URL(u);
    if (protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

// Gültige Session (Patient ODER Mitarbeiter)? Rechnungen laden Patienten,
// Lohnabrechnungen laden Mitarbeiter – beide Wege müssen erlaubt sein.
async function hatGueltigeSession(token) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(String(token || ''))) return false;
  const f = encodeURIComponent(`{Session_Token} = '${esc(token)}'`);
  for (const table of [TABLES.PATIENTEN, TABLES.PERSONAL]) {
    const data = await airtable(`${table}?filterByFormula=${f}&maxRecords=1`);
    if ((data.records || [])[0]) return true;
  }
  return false;
}

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'GET') { res.status(405).send('Nur GET'); return; }

  const { url, name } = req.query;
  const token = readToken(req);

  if (!url) { res.status(400).send('Keine Datei-URL angegeben'); return; }
  if (!hostErlaubt(url)) { res.status(400).send('Ziel nicht erlaubt'); return; }

  try {
    if (!(await hatGueltigeSession(token))) {
      res.status(401).send('Nicht autorisiert'); return;
    }

    const fileRes = await fetch(url);
    if (!fileRes.ok) { res.status(502).send('Datei konnte nicht geladen werden'); return; }
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    // Dateinamen entschärfen (Header-Injection / Steuerzeichen vermeiden).
    const safeName = String(name || 'Datei.pdf').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.status(200).send(buffer);
  } catch (e) {
    console.error('[api/lohn-download]', String((e && e.message) || e));
    reportError('api/lohn-download', (e && e.message) || e, {});
    res.status(500).send('Download fehlgeschlagen');
  }
}
