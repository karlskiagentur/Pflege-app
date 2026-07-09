import webpush from 'web-push';

const VAPID_PUBLIC_KEY =
  'BGsTbCfunMpxOpMNTuMy9S5ERDA1yUi3mYhWa5zkBOXrcCnDxLSaYt4ixweedP7zhP4sOUG3--ZrjssD0W2daFo';

webpush.setVapidDetails(
  'mailto:soulstories.love@gmail.com',
  VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Optionaler Missbrauchsschutz: Ist PUSH_RELAY_SECRET gesetzt, muss der
  // Aufrufer es als Header "x-relay-secret" mitschicken. So kann dieser
  // Broadcast-Endpunkt nicht als fremder Push-Versand-Relay genutzt werden.
  const secret = process.env.PUSH_RELAY_SECRET;
  if (secret) {
    const got = (req.headers['x-relay-secret'] || '').toString();
    if (got !== secret) {
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }
  }

  try {
    const { title, body, subscriptions } = req.body || {};

    if (!Array.isArray(subscriptions)) {
      return res
        .status(400)
        .json({ error: 'subscriptions must be an array' });
    }

    const payload = JSON.stringify({ title, body });

    let sent = 0;
    let failed = 0;

    for (const raw of subscriptions) {
      try {
        const subscription =
          typeof raw === 'string' ? JSON.parse(raw) : raw;
        await webpush.sendNotification(subscription, payload);
        sent++;
      } catch (err) {
        failed++;
        console.error('Failed to send push notification:', err);
      }
    }

    return res.status(200).json({ status: 'ok', sent, failed });
  } catch (err) {
    console.error('send-push handler error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
