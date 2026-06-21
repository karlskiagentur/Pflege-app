export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST' }); return;
  }
  const { mitarbeiterId } = req.body || {};
  if (!mitarbeiterId) {
    res.status(400).json({ status: 'error', message: 'mitarbeiterId nötig' });
    return;
  }
  try {
    const formula = encodeURIComponent(`{Mitarbeiter_ID} = '${mitarbeiterId}'`);
    const resp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Mitarbeiter_Urlaub?filterByFormula=${formula}`,
      { headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}` } }
    );
    const data = await resp.json();
    if (!resp.ok) { res.status(500).json({ status: 'error', detail: data }); return; }
    const liste = (data.records || []).map(r => ({
      id: r.id,
      von: r.fields.Von || '',
      bis: r.fields.Bis || '',
      status: r.fields.Status || 'Beantragt',
      notiz: r.fields.Notiz || '',
    }));
    liste.sort((a, b) => new Date(b.von).getTime() - new Date(a.von).getTime());
    res.status(200).json(liste);
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e) });
  }
}
