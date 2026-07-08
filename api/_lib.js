// Geteilte Helfer für die Patienten-Routes: Airtable-Zugriff + Token-Auth + Ownership.
// Stil wie die bestehenden /api-Funktionen (fetch gegen Airtable REST, Env AIRTABLE_*).

const BASE = process.env.AIRTABLE_BASE_ID || 'appI0GYyx7yq85YLH';
const AT_TOKEN = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;

export const TABLES = {
  PATIENTEN: 'tbl5uUUSgC9p10BHQ',
  PERSONAL: 'tbl3pMfhOLYPsQ5jF',
  BESUCHE: 'tblXJOSz4LaJCG10M',
  AUFGABEN: 'tbllNVrLFPfjRltL4',
  DOKUMENTE: 'tblKoScXr5PeI8HKl',
  KONTAKTE: 'tbl0rLFTYlqNwDigk',
};

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

// Alle Seiten einer Tabelle holen (Airtable paginiert mit offset).
export async function fetchAll(table, params = '') {
  let records = [];
  let offset;
  do {
    const q = [params, offset ? `offset=${offset}` : ''].filter(Boolean).join('&');
    const data = await airtable(`${table}${q ? `?${q}` : ''}`);
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

// Airtable-429 (Rate Limit) in eine kurze, verständliche 503 übersetzen.
export function sendError(res, e) {
  if (e && e.status === 429) {
    res.status(503).json({ status: 'error', message: 'Bitte kurz erneut versuchen' });
    return;
  }
  res.status(500).json({ status: 'error', message: String(e) });
}

function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

// Liefert den eingeloggten Patienten-Record oder schickt 401 und gibt null zurück.
export async function requireAuth(req, res) {
  const token = bearer(req);
  if (!token || token.length <= 20) {
    res.status(401).json({ status: 'error', message: 'Nicht autorisiert' });
    return null;
  }
  const formula = encodeURIComponent(`{Session_Token} = '${token}'`);
  const data = await airtable(`${TABLES.PATIENTEN}?filterByFormula=${formula}&maxRecords=1`);
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
  const rec = await airtable(`${table}/${recordId}`);
  const owner = linkedId(rec.fields && rec.fields.PatientID_live);
  if (!owner || owner !== patientRecId) {
    res.status(403).json({ status: 'error', message: 'Kein Zugriff' });
    return null;
  }
  return rec;
}
