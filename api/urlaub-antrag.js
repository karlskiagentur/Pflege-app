export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { mitarbeiterId, mitarbeiterName, von, bis, notiz } = req.body || {};
  if (!mitarbeiterId || !von || !bis) {
    res.status(400).json({ status: 'error', message: 'mitarbeiterId, von und bis nötig' });
    return;
  }
  const fields = {
    Mitarbeiter: mitarbeiterName || '',
    Mitarbeiter_ID: mitarbeiterId,
    Von: von,
    Bis: bis,
    Status: 'Beantragt',
  };
  if (notiz) fields.Notiz = notiz;
  try {
    const resp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Mitarbeiter_Urlaub`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) { res.status(500).json({ status: 'error', detail: data }); return; }
    res.status(200).json({ status: 'success', id: data.id });
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e) });
  }
}
