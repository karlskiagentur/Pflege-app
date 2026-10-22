import { airtable, esc, readToken, handledPreflight, reportError, requireMitarbeiter, TABLES } from './_lib.js';
import { LOHN, lohnZustand } from './_lohn.js';

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

// Gültige Session (Patient ODER Mitarbeiter)? Rechnungen laden Patienten über die URL.
async function hatGueltigeSession(token) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(String(token || ''))) return false;
  const f = encodeURIComponent(`{Session_Token} = '${esc(token)}'`);
  for (const table of [TABLES.PATIENTEN, TABLES.PERSONAL]) {
    const data = await airtable(`${table}?filterByFormula=${f}&maxRecords=1`);
    if ((data.records || [])[0]) return true;
  }
  return false;
}

// Dateinamen entschärfen (Header-Injection / Steuerzeichen vermeiden); Umlaute umschreiben.
const UMLAUT = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
const sicher = (s) => String(s || 'Datei.pdf')
  .replace(/[äöüÄÖÜß]/g, (c) => UMLAUT[c])
  .replace(/[^A-Za-z0-9._ -]/g, '_')
  .slice(0, 120);

async function dateiSenden(res, url, name, typ, ansicht) {
  const fileRes = await fetch(url);
  if (!fileRes.ok) { res.status(502).send('Datei konnte nicht geladen werden'); return; }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  res.setHeader('Content-Type', typ || 'application/pdf');
  res.setHeader('Content-Disposition', `${ansicht ? 'inline' : 'attachment'}; filename="${sicher(name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(buffer);
}

// Lohnabrechnung über ihre Record-ID: nur für den eingeloggten Mitarbeiter, dem sie
// gehört (Prüfung serverseitig am Datensatz, IDOR-Schutz), und nur solange sie in der App
// verfügbar ist. Die Datei-URL verlässt den Server nie.
async function lohnabrechnung(req, res) {
  const lohnId = String(req.query.lohnId || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(lohnId)) { res.status(400).send('Ungültige Anfrage'); return; }
  const ma = await requireMitarbeiter(req, res);
  if (!ma) return;

  let rec = null;
  try {
    rec = await airtable(`${LOHN}/${lohnId}`);
  } catch (e) {
    if (!(e && e.status === 404)) throw e;
  }
  const gehoert = rec && Array.isArray(rec.fields && rec.fields.Mitarbeiter) && rec.fields.Mitarbeiter.includes(ma.id);
  if (!gehoert) { res.status(404).send('Nicht gefunden'); return; } // fremde wie nicht vorhanden

  const z = lohnZustand(rec, Date.now());
  if (!z.sichtbar) { res.status(410).send('Diese Lohnabrechnung ist nicht mehr verfügbar.'); return; }
  const nr = Number.parseInt(String(req.query.nr || '0'), 10);
  const datei = z.dateien[Number.isInteger(nr) && nr >= 0 ? nr : -1];
  if (!datei) { res.status(404).send('Nicht gefunden'); return; }
  if (!hostErlaubt(datei.url)) { res.status(502).send('Datei konnte nicht geladen werden'); return; }

  const endung = /\.[A-Za-z0-9]{2,4}$/.exec(String(datei.filename || ''));
  const basis = `Lohnabrechnung_${(z.monat || z.hochgeladen || '').replace(' ', '_')}`;
  const name = `${basis}${z.dateien.length > 1 ? `_${nr + 1}` : ''}${endung ? endung[0] : '.pdf'}`;
  await dateiSenden(res, datei.url, name, datei.type, req.query.ansicht === '1');
}

export default async function handler(req, res) {
  if (handledPreflight(req, res)) return;
  if (req.method !== 'GET') { res.status(405).send('Nur GET'); return; }

  try {
    if (req.query && req.query.lohnId) { await lohnabrechnung(req, res); return; }

    // Bisheriger Weg (Rechnungen der Klienten): Datei-URL + gültige Session.
    const { url, name } = req.query;
    const token = readToken(req);
    if (!url) { res.status(400).send('Keine Datei-URL angegeben'); return; }
    if (!hostErlaubt(url)) { res.status(400).send('Ziel nicht erlaubt'); return; }
    if (!(await hatGueltigeSession(token))) {
      res.status(401).send('Nicht autorisiert'); return;
    }
    await dateiSenden(res, url, name || 'Datei.pdf', 'application/pdf', false);
  } catch (e) {
    console.error('[api/lohn-download]', String((e && e.message) || e));
    reportError('api/lohn-download', (e && e.message) || e, {});
    res.status(500).send('Download fehlgeschlagen');
  }
}
