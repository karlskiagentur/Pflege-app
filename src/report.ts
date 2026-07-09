// Zentrale Fehler-Meldung + robuste Fetch-Helfer für das Frontend.
// Ziel: Jeder unerwartete Fehler (Absturz, Whitescreen, hängender Request)
// wird sofort an den Betreiber gemeldet – über die eigene Vercel-Funktion
// /api/report-error (KEIN n8n, damit n8n ablösbar bleibt).

const ERROR_ENDPOINT = '/api/report-error';

let lastSent = 0;
const seen = new Set<string>();

// Meldet einen Client-Fehler. Absichtlich "fire and forget" und gedrosselt,
// damit ein Dauerfehler nicht zum Spam wird.
export function reportClientError(source: string, message: any, context: Record<string, any> = {}) {
  try {
    const msg = String((message && message.stack) || (message && message.message) || message || '').slice(0, 1500);
    const key = source + '|' + msg.slice(0, 120);
    if (seen.has(key)) return;            // gleicher Fehler nur einmal pro Session
    const now = Date.now();
    if (now - lastSent < 3000) return;    // max. alle 3s
    lastSent = now;
    seen.add(key);

    const payload = JSON.stringify({
      source: 'frontend/' + source,
      message: msg,
      context: {
        ...context,
        url: typeof location !== 'undefined' ? location.href : '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      },
      time: new Date().toISOString(),
    });
    // sendBeacon überlebt auch einen Seiten-/Tab-Wechsel; sonst fetch keepalive.
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(ERROR_ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(ERROR_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch (_) { /* Melden darf nie selbst crashen */ }
}

// Globale Fehler-Fänger installieren (unbehandelte Fehler + Promise-Rejections).
export function installGlobalErrorReporting() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    reportClientError('window.onerror', e.error || e.message, { line: (e as any).lineno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportClientError('unhandledrejection', (e as any).reason, {});
  });
}

// fetch mit hartem Timeout (verhindert unendlich hängende Spinner).
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, ms = 20000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
