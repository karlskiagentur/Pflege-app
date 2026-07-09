// Geteilte Helfer für die App-Routes: Airtable-Zugriff + Token-Auth + Ownership
// + einheitliches Fehler-Handling und Sofort-Alarmierung.
// Stil wie die bestehenden /api-Funktionen (fetch gegen Airtable REST, Env AIRTABLE_*).

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_TOKEN = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;

// Sofort-Alarmierung läuft BEWUSST OHNE n8n (Ziel: n8n ablösbar machen).
// E-Mail wird direkt über einen HTTP-Mail-Dienst verschickt (Resend, kostenloses
// Kontingent). Konfiguration über Env-Variablen:
//   RESEND_API_KEY  - API-Key des Mail-Dienstes (ohne ihn wird nur geloggt)
//   ALERT_EMAIL     - Zieladresse (Default: Betreiber)
//   ALERT_FROM      - Absender (Default: Resend-Testabsender; für Produktion
//                     eigene verifizierte Domain eintragen)
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'denis@sprach-ki.live';
const ALERT_FROM = process.env.ALERT_FROM || 'Wunschlos Alarm <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Verschickt eine Alarm-E-Mail (fire and forget, wirft nie).
export async function sendAlert(subject, text) {
  try {
    if (!RESEND_API_KEY) {
      console.warn('[alert] RESEND_API_KEY fehlt – Alarm nur im Log:', subject);
      return;
    }
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_EMAIL], subject, text }),
    });
  } catch (_) { /* Alarm darf den Request nie stören */ }
}

export const TABLES = {
  PATIENTEN: 'tbl5uUUSgC9p10BHQ',
  PERSONAL: 'tbl3pMfhOLYPsQ5jF',
  BESUCHE: 'tblXJOSz4LaJCG10M',
  AUFGABEN: 'tbllNVrLFPfjRltL4',
  DOKUMENTE: 'tblKoScXr5PeI8HKl',
  KONTAKTE: 'tbl0rLFTYlqNwDigk',
  URLAUB: 'tblPfBhWtAg9GEhWb',
  MELDUNGEN: 'tblnl3Zc4L1OLTNkH',
};

// Anhang-Feld "Datei" der Dokumente-Tabelle (für content.airtable.com uploadAttachment)
export const DOKUMENT_DATEI_FELD = 'fld7vyNPt2Be9xAaT';

// --- CORS / Preflight -------------------------------------------------------
// Einheitliche Header. Same-Origin in Prod; offen genug für die PWA.
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// true, wenn OPTIONS bereits beantwortet wurde (Aufrufer darf dann returnen).
export function handledPreflight(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// --- Pflicht-Env-Prüfung ----------------------------------------------------
// Fehlt eine kritische Variable, ist das ein Deploy-/Konfig-Fehler:
// klar loggen + melden, nicht still 500 werfen.
export function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    const msg = `Fehlende Env-Variablen: ${missing.join(', ')}`;
    // Fire-and-forget Alarm; blockiert die Antwort nicht.
    reportError('env', msg, {});
    const e = new Error(msg);
    e.envMissing = missing;
    throw e;
  }
}

// --- Sofort-Alarmierung -----------------------------------------------------
// Meldet einen technischen Fehler per E-Mail an den Betreiber (ohne n8n).
// Absichtlich "fire and forget": blockiert die eigentliche Antwort nie.
export function reportError(source, message, context = {}) {
  try {
    const text =
      `Quelle: ${source}\n` +
      `Zeit: ${new Date().toISOString()}\n` +
      `Umgebung: ${process.env.VERCEL_ENV || 'unknown'}\n\n` +
      `Fehler:\n${String((message && message.stack) || message).slice(0, 1500)}\n\n` +
      `Kontext: ${JSON.stringify(context).slice(0, 1000)}`;
    console.error('[ALERT]', source, String(message).slice(0, 300));
    // Kein await: Antwort nicht verzögern.
    sendAlert(`🚨 Wunschlos App-Fehler: ${source}`, text);
  } catch (_) { /* Alarmierung darf nie den Request stören */ }
}

// --- Airtable ---------------------------------------------------------------
export async function airtable(path, opts = {}) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${AT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error('Airtable-Fehler');
    e.detail = data;
    e.status = resp.status;
    throw e;
  }
  return data;
}

// Airtable-Formelwert escapen: einfache Anführungszeichen verdoppeln.
// Schützt String-Vergleiche in filterByFormula gegen Injection.
export function esc(v) {
  return String(v).replace(/'/g, "\\'");
}

// Alle Seiten einer Tabelle holen (Airtable paginiert mit offset).
export async function fetchAll(table, params = '') {
  let records = [];
  let offset;
  let guard = 0; // Schutz gegen Endlos-Paginierung
  do {
    const q = [params, offset ? `offset=${offset}` : ''].filter(Boolean).join('&');
    const data = await airtable(`${table}${q ? `?${q}` : ''}`);
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset && ++guard < 50);
  return records;
}

// Einheitliche Fehlerantwort: Rate-Limit -> 503, sonst 500.
// Client bekommt NIE interne Airtable-Details (Info-Leak vermeiden),
// echte Details gehen in Log + Alarm.
export function sendError(res, e, source = 'api') {
  if (e && e.status === 429) {
    res.status(503).json({ status: 'error', message: 'Bitte kurz erneut versuchen' });
    return;
  }
  const detail = (e && (e.message || e.detail)) || e;
  console.error(`[${source}]`, detail, e && e.detail ? JSON.stringify(e.detail) : '');
  reportError(source, detail, { status: e && e.status });
  res.status(500).json({ status: 'error', message: 'Interner Fehler. Bitte später erneut versuchen.' });
}

// --- Auth-Helfer ------------------------------------------------------------
function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;

// Token aus Header ODER Body ODER Query lesen (Reihenfolge: Header bevorzugt).
export function readToken(req) {
  const b = bearer(req);
  if (b) return b;
  const body = (req.body && (req.body.token || req.body.mitarbeiterToken)) || '';
  if (body) return String(body);
  const q = (req.query && req.query.token) || '';
  return String(q || '');
}

// Patienten-Record anhand eines Session_Token (ohne 401-Antwort).
// Gibt null zurück, wenn Token fehlt/ungültig oder kein Treffer.
export async function patientByToken(token) {
  if (!token || !TOKEN_RE.test(String(token))) return null;
  const formula = encodeURIComponent(`{Session_Token} = '${esc(token)}'`);
  const data = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${formula}&maxRecords=1`);
  return (data.records || [])[0] || null;
}

// Liefert den eingeloggten Patienten-Record oder schickt 401 und gibt null zurück.
export async function requireAuth(req, res) {
  const token = readToken(req);
  if (!TOKEN_RE.test(token)) {
    res.status(401).json({ status: 'error', message: 'Nicht autorisiert' });
    return null;
  }
  const formula = encodeURIComponent(`{Session_Token} = '${esc(token)}'`);
  const data = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${formula}&maxRecords=1`);
  const rec = (data.records || [])[0];
  if (!rec) {
    res.status(401).json({ status: 'error', message: 'Nicht autorisiert' });
    return null;
  }
  return rec;
}

// Liefert den eingeloggten Mitarbeiter-Record (Personal) oder schickt 401.
export async function requireMitarbeiter(req, res) {
  const token = readToken(req);
  if (!TOKEN_RE.test(token)) {
    res.status(401).json({ status: 'error', message: 'Nicht autorisiert' });
    return null;
  }
  const formula = encodeURIComponent(`{Session_Token} = '${esc(token)}'`);
  const data = await airtable(`${TABLES.PERSONAL}?filterByFormula=${formula}&maxRecords=1`);
  const rec = (data.records || [])[0];
  if (!rec) {
    res.status(401).json({ status: 'error', message: 'Nicht autorisiert' });
    return null;
  }
  return rec;
}

function linkedId(val) {
  return Array.isArray(val) ? val[0] : val;
}

// Lädt den Record und prüft, dass PatientID_live == eingeloggter Patient.
// Schickt sonst 403 und gibt null zurück (IDOR-Schutz).
export async function ownOr403(res, table, recordId, patientRecId) {
  if (!/^rec[A-Za-z0-9]{14,}$/.test(String(recordId || ''))) {
    res.status(400).json({ status: 'error', message: 'Ungültige ID' });
    return null;
  }
  const rec = await airtable(`${table}/${recordId}`);
  const owner = linkedId(rec.fields && rec.fields.PatientID_live);
  if (!owner || owner !== patientRecId) {
    res.status(403).json({ status: 'error', message: 'Kein Zugriff' });
    return null;
  }
  return rec;
}
