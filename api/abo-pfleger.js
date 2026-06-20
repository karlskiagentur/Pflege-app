export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { mitarbeiterId, subscription } = req.body || {};
  if (!mitarbeiterId || !subscription) {
    res.status(400).json({ status: 'error', message: 'mitarbeiterId und subscription nötig' });
    return;
  }
  try {
    const resp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Personal/${mitarbeiterId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: { Push_Subscription: JSON.stringify(subscription) } }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) { res.status(500).json({ status: 'error', detail: data }); return; }
    res.status(200).json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e) });
  }
}
