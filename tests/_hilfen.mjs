// Test-Hilfen: Airtable-Attrappe (globales fetch) + minimale Request/Response-Objekte.
// Alle Testdaten sind frei erfunden.
import zlib from 'node:zlib';

delete process.env.RESEND_API_KEY; // Alarm-Mails in Tests nie verschicken

// Alle Textstücke eines von pdf-lib erzeugten PDFs in Zeichenreihenfolge (Text steht als <HEX> Tj
// in Flate-Streams, kodiert in Windows-1252; Nodes TextDecoder bildet 0x80-0x9F nicht ab ->
// eigene Tabelle). Genutzt von den Tests für Stundenzettel und Dienstplan.
const CP1252_80_9F = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const cp1252 = (buf) => [...buf].map((x) => (x >= 0x80 && x <= 0x9f ? CP1252_80_9F[x - 0x80] : String.fromCharCode(x))).join('');
export function pdfTexte(bytes) {
  const roh = Buffer.from(bytes).toString('latin1');
  const texte = [];
  for (const m of roh.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let inhalt = Buffer.from(m[1], 'latin1');
    try { inhalt = zlib.inflateSync(inhalt); } catch { /* unkomprimiert */ }
    for (const t of inhalt.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) texte.push(cp1252(Buffer.from(t[1], 'hex')));
  }
  return texte;
}

export function antwort(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// Ersetzt globalThis.fetch. `beantworte(url, opts)` liefert eine Antwort (oder ein Promise).
// Gibt das Protokoll aller Aufrufe zurück.
export function airtableAttrappe(beantworte) {
  const aufrufe = [];
  let offen = 0;
  const protokoll = { aufrufe, maxGleichzeitig: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const eintrag = {
      url: u,
      host: u.hostname,
      methode: (opts.method || 'GET').toUpperCase(),
      formel: u.searchParams.get('filterByFormula') || '',
      tabelle: u.pathname.split('/')[3] || '',
      body: opts.body ? JSON.parse(opts.body) : null,
    };
    aufrufe.push(eintrag);
    offen += 1;
    protokoll.maxGleichzeitig = Math.max(protokoll.maxGleichzeitig, offen);
    try {
      return await beantworte(eintrag);
    } finally {
      offen -= 1;
    }
  };
  return protokoll;
}

export function anfrage({ method = 'GET', token, body = {} } = {}) {
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    query: {},
  };
}

export function antwortObjekt() {
  return {
    statusCode: 0,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    end() { return this; },
  };
}

export const kurzWarten = (ms) => new Promise((r) => setTimeout(r, ms));
