// PDF-Vorschau in der App (z. B. Lohnabrechnung): reine Hilfen ohne DOM und ohne PDF.js,
// damit sie ohne Browser testbar sind (tests/vorschau.test.mjs).
//
// Hintergrund: Die Vorschau öffnete die PDF früher per window.open auf derselben Adresse wie
// die App. In der installierten App (Homebildschirm, v. a. iPhone) erscheint sie dann im
// App-Fenster ohne Browser-Leiste - es gab keinen Weg zurück. Jetzt zeigt die App die PDF
// selbst an (src/PdfVorschau.tsx) und hat immer einen „Zurück"-Knopf.

/** Höchstens so viele Bildpunkte je Seite: iPhones begrenzen den Speicher für Zeichenflächen. */
export const MAX_PIXEL = 8_000_000;

/**
 * Maßstab einer PDF-Seite für die Anzeige.
 * Die Seite füllt die verfügbare Breite (CSS-Pixel). Gezeichnet wird feiner (Gerätepixel × 1,5),
 * damit die Schrift auch beim Heranzoomen scharf bleibt - aber nie über MAX_PIXEL.
 * @param breitePt  Seitenbreite in PDF-Punkten (Maßstab 1)
 * @param hoehePt   Seitenhöhe in PDF-Punkten
 * @param breiteCss verfügbare Breite in CSS-Pixeln
 * @param dpr       window.devicePixelRatio
 */
export function seitenMass(breitePt: number, hoehePt: number, breiteCss: number, dpr: number) {
  const bPt = breitePt > 0 ? breitePt : 595;
  const hPt = hoehePt > 0 ? hoehePt : 842;
  const css = Math.max(1, breiteCss) / bPt; // CSS-Pixel je PDF-Punkt
  const geraet = Math.min(Math.max(Number(dpr) || 1, 1), 3);
  let pixel = css * geraet * 1.5;           // Zeichen-Pixel je PDF-Punkt
  const flaeche = bPt * pixel * hPt * pixel;
  if (flaeche > MAX_PIXEL) pixel *= Math.sqrt(MAX_PIXEL / flaeche);
  return {
    pixel,
    breiteCss: Math.round(bPt * css),
    hoeheCss: Math.round(hPt * css),
  };
}

// Status einer fehlgeschlagenen Vorschau: HTTP-Status der Antwort, 0 = keine Verbindung oder
// Zeitüberschreitung, undefined = Datei kam an, ließ sich aber nicht anzeigen.

/** Meldung für den Mitarbeiter, wenn die Vorschau nicht angezeigt werden kann. */
export function vorschauFehlerText(status?: number): string {
  if (status === 410) return 'Diese Lohnabrechnung ist nicht mehr verfügbar – sie wurde nach 3 Monaten automatisch gelöscht.';
  if (status === 404) return 'Diese Lohnabrechnung wurde nicht gefunden.';
  if (status === 401 || status === 403) return 'Die Anmeldung ist abgelaufen. Bitte die App neu öffnen und erneut anmelden.';
  if (status === 0) return 'Keine Verbindung. Bitte die Internetverbindung prüfen und es noch einmal versuchen.';
  return 'Die Vorschau konnte nicht angezeigt werden. Die Datei lässt sich trotzdem herunterladen.';
}

/**
 * Als technischer Fehler melden (Alarm-Mail)? Nur, was der Mitarbeiter nicht selbst einordnen
 * kann: Serverfehler und Dateien, die sich nicht anzeigen lassen. Keine Verbindung, abgelaufene
 * Anmeldung, gelöschte oder fremde Einträge sind kein Fehler der App.
 */
export function vorschauFehlerMelden(status?: number): boolean {
  if (status === undefined) return true;
  return !(status === 0 || status === 401 || status === 403 || status === 404 || status === 410);
}
