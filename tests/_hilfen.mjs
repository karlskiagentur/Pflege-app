// Test-Hilfen: Airtable-Attrappe (globales fetch) + minimale Request/Response-Objekte.
// Alle Testdaten sind frei erfunden.

delete process.env.RESEND_API_KEY; // Alarm-Mails in Tests nie verschicken

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
