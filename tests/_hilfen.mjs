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
  const texte = [];
  for (const inhalt of pdfStreams(bytes)) {
    for (const t of inhalt.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) texte.push(cp1252(Buffer.from(t[1], 'hex')));
  }
  return texte;
}

// Alle Streams eines von pdf-lib erzeugten PDFs, entpackt, in Dateireihenfolge. Die Länge kommt aus
// /Length des Stream-Wörterbuchs – nicht aus der Suche nach "endstream": Endet ein gepackter Stream
// zufällig auf das Byte 0x0D (1 von 256 Fällen), hielte ein Muster "\r?\nendstream" dieses Byte für
// einen Zeilenumbruch; der Stream wäre um ein Byte zu kurz, ließe sich nicht entpacken und sein Text
// ginge stillschweigend verloren (Prüfungen „steht NICHT im PDF“ wären dann grundlos grün). Ein
// gepackter Stream, der sich nicht entpacken lässt, ist deshalb ein Fehler und kein leeres Ergebnis.
export function pdfStreams(bytes) {
  const roh = Buffer.from(bytes).toString('latin1');
  const streams = [];
  let pos = 0;
  for (;;) {
    const m = /stream\r?\n/g;
    m.lastIndex = pos;
    const treffer = m.exec(roh);
    if (!treffer) break;
    const start = treffer.index + treffer[0].length;
    const kopf = roh.slice(Math.max(roh.lastIndexOf(' obj', treffer.index), 0), treffer.index); // Wörterbuch dieses Objekts
    const laenge = /\/Length (\d+)/.exec(kopf);
    const ende = laenge ? start + Number(laenge[1]) : roh.indexOf('endstream', start);
    if (ende < start) break;
    let inhalt = Buffer.from(roh.slice(start, ende), 'latin1');
    if (/\/FlateDecode/.test(kopf)) inhalt = zlib.inflateSync(inhalt); // wirft, wenn nicht lesbar
    streams.push(inhalt.toString('latin1'));
    pos = ende + 'endstream'.length;
  }
  return streams;
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
