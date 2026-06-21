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
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Lohnabrechnung?filterByFormula=${formula}`,
      { headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}` } }
    );
    const data = await resp.json();
    if (!resp.ok) { res.status(500).json({ status: 'error', detail: data }); return; }

    const liste = (data.records || []).map(r => {
      const files = r.fields.Datei || [];
      const file = files[0] || null;
      return {
        id: r.id,
        zeitraum: r.fields.Zeitraum || '',
        dateiname: file ? file.filename : 'Datei',
        url: file ? file.url : '',
      };
    });
    liste.sort((a, b) => new Date(b.zeitraum).getTime() - new Date(a.zeitraum).getTime());
    res.status(200).json(liste);
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e) });
  }
}
