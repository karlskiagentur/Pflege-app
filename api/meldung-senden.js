export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Nur POST erlaubt' });
    return;
  }

  const { mitarbeiterName, typ, patientId, besuchId, notiz } = req.body || {};

  const fields = {
    Mitarbeiter: mitarbeiterName || '',
    Typ: typ || 'Sonstiges',
    Status: 'Neu',
  };
  if (patientId) fields.Patient = [patientId];
  if (besuchId) fields.Einsatz = [besuchId];
  if (notiz) fields.Notiz = notiz;

  try {
    const resp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Meldungen`,
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
    if (!resp.ok) {
      res.status(500).json({ status: 'error', detail: data });
      return;
    }
    res.status(200).json({ status: 'success', id: data.id });
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e) });
  }
}
