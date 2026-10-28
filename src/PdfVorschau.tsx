import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { fetchWithTimeout, reportClientError } from './report';
import { seitenMass, vorschauFehlerMelden, vorschauFehlerText } from './vorschau';

// Vorschau einer PDF (Lohnabrechnung) IN der App - mit „Zurück"-Knopf, der immer sichtbar ist.
// Früher öffnete window.open die Datei auf derselben Adresse wie die App; in der installierten
// App (Homebildschirm, v. a. iPhone) stand die PDF dann ohne Browser-Leiste im App-Fenster und
// man kam nicht mehr zurück. Die Seiten zeichnet PDF.js; die Bibliothek wird erst beim ersten
// Öffnen einer Vorschau geladen (eigene Dateien, belastet den App-Start nicht).

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsLaden: Promise<PdfJs> | null = null;
function pdfjsHolen(): Promise<PdfJs> {
  if (!pdfjsLaden) {
    pdfjsLaden = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    }).catch((e) => {
      pdfjsLaden = null; // beim nächsten Öffnen neu versuchen (z. B. nach Funkloch)
      throw e;
    });
  }
  return pdfjsLaden;
}

type Props = {
  /** Adresse der PDF auf dem eigenen Server (enthält die Anmeldung, wird nie gemeldet). */
  url: string;
  titel: string;
  onZurueck: () => void;
  onHerunterladen?: () => void;
  laedtHerunter?: boolean;
};

export default function PdfVorschau({ url, titel, onZurueck, onHerunterladen, laedtHerunter }: Props) {
  const [zustand, setZustand] = useState<'laden' | 'fertig' | 'fehler'>('laden');
  const [fehlerStatus, setFehlerStatus] = useState<number | undefined>(undefined);
  const [versuch, setVersuch] = useState(0);
  const seitenRef = useRef<HTMLDivElement>(null);
  const zurueckRef = useRef(onZurueck);
  zurueckRef.current = onZurueck;

  // Solange die Vorschau offen ist: Seite dahinter nicht mitscrollen; Esc (Tastatur) = Zurück.
  useEffect(() => {
    const vorher = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') zurueckRef.current(); };
    window.addEventListener('keydown', taste);
    return () => {
      document.body.style.overflow = vorher;
      window.removeEventListener('keydown', taste);
    };
  }, []);

  useEffect(() => {
    const ziel = seitenRef.current;
    if (!ziel) return;
    let vorbei = false;
    let aufgabe: { destroy: () => Promise<void> } | null = null;
    let bildUrl = '';
    ziel.replaceChildren();
    setZustand('laden');
    setFehlerStatus(undefined);

    (async () => {
      let status: number | undefined;
      try {
        let antwort: Response;
        try {
          antwort = await fetchWithTimeout(url, {}, 30000);
        } catch (e) {
          status = 0; // keine Verbindung oder Zeitüberschreitung
          throw e;
        }
        if (!antwort.ok) {
          status = antwort.status;
          throw new Error(`Vorschau: Server antwortete mit ${antwort.status}`);
        }
        // Wurde statt einer PDF ein Bild hochgeladen (z. B. ein Foto), wird es direkt gezeigt.
        if (/^image\//i.test(antwort.headers.get('Content-Type') || '')) {
          const bild = URL.createObjectURL(await antwort.blob());
          if (vorbei) { URL.revokeObjectURL(bild); return; }
          bildUrl = bild;
          const img = document.createElement('img');
          img.src = bild;
          img.alt = titel;
          img.className = 'block w-full h-auto bg-white rounded-xl shadow-sm';
          ziel.appendChild(img);
          setZustand('fertig');
          return;
        }
        const daten = new Uint8Array(await antwort.arrayBuffer());
        let pdfjs: PdfJs;
        try {
          pdfjs = await pdfjsHolen();
        } catch (e) {
          status = 0; // Bibliothek nicht ladbar - wie ein Funkloch behandeln
          throw e;
        }
        if (vorbei) return;
        const ladeAufgabe = pdfjs.getDocument({ data: daten });
        aufgabe = ladeAufgabe;
        const pdf = await ladeAufgabe.promise;
        const breite = Math.max(200, ziel.clientWidth);
        for (let n = 1; n <= pdf.numPages; n++) {
          const seite = await pdf.getPage(n);
          if (vorbei) return;
          const basis = seite.getViewport({ scale: 1 });
          const mass = seitenMass(basis.width, basis.height, breite, window.devicePixelRatio || 1);
          const ansicht = seite.getViewport({ scale: mass.pixel });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(ansicht.width);
          canvas.height = Math.floor(ansicht.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'block bg-white rounded-xl shadow-sm';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `Seite ${n} von ${pdf.numPages}`);
          ziel.appendChild(canvas);
          await seite.render({ canvas, viewport: ansicht }).promise;
          if (vorbei) return;
          if (n === 1) setZustand('fertig'); // erste Seite steht - Ladeanzeige weg
        }
        if (!vorbei) setZustand('fertig');
      } catch (e: any) {
        if (vorbei) return;
        if (e && e.name === 'AbortError') status = 0;
        ziel.replaceChildren();
        setFehlerStatus(status);
        setZustand('fehler');
        // Nur echte Fehler melden; die Adresse (mit Anmeldung) geht nie mit.
        if (vorschauFehlerMelden(status)) reportClientError('lohn-vorschau', e, { status: status === undefined ? 'pdf' : status });
      }
    })();

    return () => {
      vorbei = true;
      if (aufgabe) aufgabe.destroy().catch(() => { /* schon beendet */ });
      if (bildUrl) URL.revokeObjectURL(bildUrl);
    };
  }, [url, versuch, titel]);

  const nochmal = fehlerStatus === 0 || (fehlerStatus !== undefined && fehlerStatus >= 500);
  const herunterladenHilft = fehlerStatus === undefined || fehlerStatus >= 500;

  return (
    <div className="fixed inset-0 z-[300] bg-[#F9F7F4] flex flex-col" role="dialog" aria-modal="true" aria-label={`Vorschau: ${titel}`}>
      <div className="flex items-center gap-3 px-4 pb-3 bg-white border-b border-[#E8DCC8] shadow-sm" style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
        <button
          onClick={onZurueck}
          autoFocus
          className="min-h-[48px] pl-3 pr-5 rounded-2xl bg-[#b5a48b] text-white font-black flex items-center gap-2 shrink-0 active:scale-95 transition-all"
        >
          <ArrowLeft size={22}/> Zurück
        </button>
        <p className="flex-1 min-w-0 font-black text-[#3A3A3A] leading-tight line-clamp-2 break-words">{titel}</p>
        {onHerunterladen && !(zustand === 'fehler' && !herunterladenHilft) && (
          <button
            onClick={onHerunterladen}
            disabled={laedtHerunter}
            aria-label="Herunterladen"
            className="min-h-[48px] min-w-[48px] rounded-2xl bg-[#F9F7F4] text-[#b5a48b] flex items-center justify-center shrink-0 disabled:opacity-50 active:scale-95 transition-all"
          >
            {laedtHerunter ? <RefreshCw className="animate-spin" size={20}/> : <Download size={20}/>}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 pt-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
        {zustand === 'laden' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-[#b5a48b] font-bold">
            <RefreshCw className="animate-spin" size={28}/> Wird geladen …
          </div>
        )}
        {zustand === 'fehler' && (
          <div className="max-w-md mx-auto mt-10 bg-white rounded-3xl p-6 text-center shadow-sm">
            <AlertCircle className="mx-auto text-orange-500" size={32}/>
            <p className="mt-3 font-bold text-[#3A3A3A]">{vorschauFehlerText(fehlerStatus)}</p>
            <div className="mt-5 space-y-3">
              {nochmal && (
                <button onClick={() => setVersuch((v) => v + 1)} className="w-full min-h-[48px] rounded-2xl bg-[#F9F7F4] text-[#6b5f4e] font-black active:scale-95 transition-all">
                  Erneut versuchen
                </button>
              )}
              {herunterladenHilft && onHerunterladen && (
                <button onClick={onHerunterladen} disabled={laedtHerunter} className="w-full min-h-[48px] rounded-2xl bg-[#F9F7F4] text-[#6b5f4e] font-black flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all">
                  <Download size={18}/> Herunterladen
                </button>
              )}
              <button onClick={onZurueck} className="w-full min-h-[48px] rounded-2xl bg-[#b5a48b] text-white font-black flex items-center justify-center gap-2 active:scale-95 transition-all">
                <ArrowLeft size={18}/> Zurück
              </button>
            </div>
          </div>
        )}
        <div ref={seitenRef} className="space-y-3 max-w-3xl mx-auto" />
      </div>
    </div>
  );
}
