import { cors, sendAlert } from './_lib.js';

// Nimmt Fehler-Meldungen aus dem Frontend entgegen und schickt sofort eine
// E-Mail an den Betreiber – vollständig ohne n8n (Ziel: n8n ablösbar machen).
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ status: 'error' }); return; }

  const { source, message, context } = req.body || {};
  const text =
    `Quelle: ${String(source || 'frontend').slice(0, 200)}\n` +
    `Zeit: ${new Date().toISOString()}\n\n` +
    `Fehler:\n${String(message || '').slice(0, 1500)}\n\n` +
    `Kontext: ${JSON.stringify(context || {}).slice(0, 1000)}`;

  // Nicht auf den Mailversand warten – Client soll nicht hängen.
  sendAlert(`🚨 Wunschlos Frontend-Fehler: ${String(source || 'frontend').slice(0, 80)}`, text);
  res.status(200).json({ status: 'ok' });
}
