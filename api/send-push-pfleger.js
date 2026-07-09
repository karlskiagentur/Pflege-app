import webpush from 'web-push';

const VAPID_PUBLIC = 'BGsTbCfunMpxOpMNTuMy9S5ERDA1yUi3mYhWa5zkBOXrcCnDxLSaYt4ixweedP7zhP4sOUG3--ZrjssD0W2daFo';
webpush.setVapidDetails(
  'mailto:soulstories.love@gmail.com',
  VAPID_PUBLIC,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { mitarbeiterId, titel, nachricht } = req.body || {};
  // Leere Payloads (Testläufe) sind kein Fehler
  if (!mitarbeiterId || !nachricht) {
    res.status(200).json({ status: 'skipped', grund: 'Ungültiger Aufruf' });
    return;
  }
  try {
    const resp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Personal/${mitarbeiterId}`,
      { headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}` } }
    );
    // Mitarbeiter nicht gefunden -> fachlich leer, kein Fehler
    if (resp.status === 404) {
      res.status(200).json({ status: 'skipped', grund: 'Mitarbeiter nicht gefunden' });
      return;
    }
    const data = await resp.json().catch(() => ({}));
    // Echter Airtable-Fehler (429/5xx/Auth) -> 500
    if (!resp.ok) {
      console.error('send-push-pfleger Airtable-Fehler:', { mitarbeiterId, status: resp.status, detail: data });
      res.status(500).json({ status: 'error', message: `Airtable ${resp.status}` });
      return;
    }

    const abo = data.fields && data.fields.Push_Subscription;
    if (!abo) {
      res.status(200).json({ status: 'skipped', grund: 'Kein Abo' });
      return;
    }

    let subscription;
    try { subscription = JSON.parse(abo); }
    catch { res.status(200).json({ status: 'skipped', grund: 'Abo ungültig' }); return; }

    const payload = JSON.stringify({ title: titel || 'Wunschlos Pflege', body: nachricht });
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (err) {
      // Push-Dienst lehnt ab (z.B. 404/410 = Abo abgelaufen) -> kein technischer Fehler
      if (err && err.statusCode) {
        console.error('send-push-pfleger Zustellung fehlgeschlagen:', { mitarbeiterId, statusCode: err.statusCode });
        // Abgelaufenes Abo aus Airtable entfernen, damit nicht bei jedem Versand erneut scheitert.
        if (err.statusCode === 404 || err.statusCode === 410) {
          try {
            await fetch(
              `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Personal/${mitarbeiterId}`,
              {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { Push_Subscription: '' } }),
              }
            );
          } catch (_) { /* Aufräumen ist best effort */ }
        }
        res.status(200).json({ status: 'skipped', grund: 'Abo nicht mehr zustellbar', statusCode: err.statusCode });
        return;
      }
      throw err; // echter Fehler -> 500
    }
    res.status(200).json({ status: 'success' });
  } catch (e) {
    console.error('send-push-pfleger Fehler:', { mitarbeiterId, message: String((e && e.message) || e) });
    res.status(500).json({ status: 'error', message: String((e && e.message) || e) });
  }
}
