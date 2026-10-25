// Text für die PDF-Standardschriften (Helvetica & Co.) - gemeinsam genutzt von Stundenzettel
// und Dienstplan.
//
// Die Standardschriften kennen nur den Windows-1252-Zeichensatz. Namen mit anderen Zeichen
// (z. B. ł, ğ, ő) würden das Erstellen abbrechen -> auf den Grundbuchstaben zurückführen;
// nicht Darstellbares wird zu "?". Ein Name darf ein Dokument nie verhindern.
const WIN1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const ERSATZ = { 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ŧ': 't', 'Ŧ': 'T' };
const darstellbar = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN1252_EXTRA.has(ch);
};
export function pdfText(s) {
  let out = '';
  for (const ch of String(s === undefined || s === null ? '' : s)) {
    if (darstellbar(ch)) { out += ch; continue; }
    if (/\s/.test(ch)) { out += ' '; continue; }
    if (ERSATZ[ch]) { out += ERSATZ[ch]; continue; }
    const basis = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out += basis && [...basis].every(darstellbar) ? basis : '?';
  }
  return out;
}
