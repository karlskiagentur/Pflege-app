export default async function handler(req, res) {
  const { url, name } = req.query;
  if (!url) return res.status(400).send('Keine Datei-URL angegeben');
  const fileRes = await fetch(url);
  if (!fileRes.ok) return res.status(502).send('Datei konnte nicht geladen werden');
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name || 'Lohnabrechnung.pdf'}"`);
  res.status(200).send(buffer);
}
