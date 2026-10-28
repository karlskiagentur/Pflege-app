// Vite-Importe mit „?url" liefern die Adresse der gebauten Datei (z. B. den PDF.js-Worker).
declare module '*?url' {
  const adresse: string;
  export default adresse;
}
