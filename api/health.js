import { airtable, cors, TABLES } from './_lib.js';

// Health-Check: prüft, ob die App Airtable erreichen kann und ob die
// kritischen Env-Variablen gesetzt sind. Für externes Uptime-Monitoring
// (z.B. kostenloser Dienst wie UptimeRobep/Betterstack, 5-Min-Ping).
// Antwortet 200 nur, wenn alles ok ist – sonst 503.
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const checks = { env: true, airtable: true };
  const missing = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'VAPID_PRIVATE_KEY']
    .filter((n) => !process.env[n]);
  if (missing.length) checks.env = false;

  try {
    // Billigster mögliche Airtable-Abfrage: 1 Record aus Patienten.
    await airtable(`${TABLES.PATIENTEN}?maxRecords=1&fields%5B%5D=Name`);
  } catch (e) {
    checks.airtable = false;
  }

  const ok = checks.env && checks.airtable;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    checks,
    missingEnv: missing,
    time: new Date().toISOString(),
  });
}
