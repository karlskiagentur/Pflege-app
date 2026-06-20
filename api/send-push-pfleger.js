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
  if (!mitarbeiterId || !nachricht) {
    res.status(400).json({ status: 'error', message: 'mitarbeiterId und nachricht nötig' });
    return;
  }
  try {
    const resp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Personal/${mitarbeiterId}`,
      { headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}` } }
    );
    const data = await resp.json();
    if (!resp.ok) { res.status(500).json({ status: 'error', detail: data }); return; }

    const abo = data.fields && data.fields.Push_Subscription;
    if (!abo) {
      res.status(200).json({ status: 'skipped', message: 'Kein Abo' });
      return;
    }

    const subscription = JSON.parse(abo);
    const payload = JSON.stringify({
      title: titel || 'Wunschlos Pflege',
      body: nachricht
    });
    await webpush.sendNotification(subscription, payload);
    res.status(200).json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e) });
  }
}
