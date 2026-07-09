import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, CalendarDays, Phone, User, RefreshCw, FileText,
  X, Upload, Mic, LogOut, Calendar as CalendarIcon,
  ChevronRight, Send, Euro, FileCheck, PlayCircle, Plane, Play, Plus,
  CheckCircle2, Circle, ChevronDown, ChevronUp, Check, PlusCircle, AlertCircle, History, Bell, AlertTriangle, ExternalLink, Clock,
  Flag, UserX, CalendarX, MoreHorizontal, Download, Eye, PenLine, RotateCcw
} from 'lucide-react';
import { subscribeToPush, isPushSubscribed, subscribeMitarbeiter } from './push';

// n8n nur noch für Schreib-Endpunkte (submit, upload, update_task, push, ...);
// Lese-Pfade (Login, App-Daten, MA-Termine) laufen über /api (Vercel).
const N8N_BASE_URL = 'https://karlskiagentur.app.n8n.cloud/webhook';

// Canvas auf den tatsächlich bemalten Bereich zuschneiden (kein leerer Rand),
// damit das PNG später proportional klein in die Box passt. null = leer.
function trimSignature(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (img[(y * width + x) * 4 + 3] > 10) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width, maxX + pad); maxY = Math.min(height, maxY + pad);
  const w = maxX - minX, h = maxY - minY;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d')!.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

// Signaturfeld: Canvas an die angezeigte Größe gekoppelt (scharf + korrekte
// Koordinaten, auch im Querformat). Meldet die zugeschnittene Zeichnung per onChange.
function SignaturePad({ onChange, clearRef }: { onChange: (dataUrl: string | null) => void; clearRef?: React.MutableRefObject<(() => void) | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => {
      const r = c.getBoundingClientRect();
      c.width = r.width;
      c.height = r.height;
      // Zeichnung geht beim Umbrechen/Drehen verloren -> Eltern-State leeren
      if (hasDrawn.current) { hasDrawn.current = false; onChange(null); }
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
    };
  }, []);

  const getPos = (e: any) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  };
  const start = (e: any) => { drawing.current = true; draw(e); };
  const end = () => {
    drawing.current = false;
    canvasRef.current!.getContext('2d')!.beginPath();
    // Zugeschnittene Signatur senden (nur bemalter Bereich, kein leerer Rand)
    if (hasDrawn.current) onChange(trimSignature(canvasRef.current!));
  };
  const draw = (e: any) => {
    if (!drawing.current) return;
    e.preventDefault();
    hasDrawn.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = getPos(e);
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a1a';
    ctx.lineTo(x, y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y);
  };
  const clear = () => {
    const c = canvasRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    hasDrawn.current = false;
    onChange(null);
  };
  // "Löschen" liegt im Modal (eine Button-Reihe) und ruft hierüber clear auf
  if (clearRef) clearRef.current = clear;

  return (
    <canvas ref={canvasRef}
      className="border-2 border-dashed border-[#e0dccf] rounded-2xl bg-white touch-none w-full h-full min-h-[120px]"
      onMouseDown={start} onMouseMove={draw} onMouseUp={end} onMouseLeave={end}
      onTouchStart={start} onTouchMove={draw} onTouchEnd={end} />
  );
}

// --- HELFER ---
const unbox = (val: any): string => {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val) && val.length > 0) return unbox(val[0]);
  if (Array.isArray(val) && val.length === 0) return "";
  if (typeof val === 'object') return "";
  return String(val);
};

const getValue = (item: any, fieldName: string) => {
    if (!item) return "";
    if (item[fieldName] !== undefined) return unbox(item[fieldName]);
    if (item.fields && item.fields[fieldName] !== undefined) return unbox(item.fields[fieldName]);
    return ""; 
};

// DATEI-EXTRAKTOR
const getFileUrl = (item: any, fieldName: string) => {
    if (!item) return "";
    let fileData = item[fieldName] || (item.fields ? item.fields[fieldName] : null);
    if (Array.isArray(fileData) && fileData.length > 0) {
        return fileData[0].url || ""; 
    }
    return "";
};

const formatDate = (raw: any, short = false) => {
  const val = unbox(raw);
  if (!val || val === "-") return "-";
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
        if (short) { const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; return days[d.getDay()]; }
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}.${month}.${d.getFullYear()}`;
    }
    return val; 
  } catch { return val; }
};

const formatDateLong = (raw: any) => {
  const val = unbox(raw);
  if (!val || val === "-") return "-";
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    return val;
  } catch { return val; }
};

const formatMonat = (raw: any) => {
  const val = unbox(raw);
  if (!val) return "";
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return val; // schon "Juli 2026" o.ä. -> unverändert
};

const formatTime = (raw: any) => {
  const val = unbox(raw);
  if (!val) return "--:--";
  try {
      if (val.includes('T') || val.includes('-')) { 
          const d = new Date(val);
          if (!isNaN(d.getTime())) {
              const hours = String(d.getHours()).padStart(2, '0');
              const minutes = String(d.getMinutes()).padStart(2, '0');
              return `${hours}:${minutes}`;
          }
      }
      if (val.includes(':')) return val.substring(0, 5);
      return val;
  } catch { return "--:--"; }
};
const formatDauer = (raw: any) => {
  const val = unbox(raw);
  if (!val) return "";
  // Airtable Duration kommt als Sekunden (Zahl). Fallback: "H:MM" String.
  let totalMin = 0;
  if (typeof raw === 'number' || /^\d+$/.test(val)) {
    totalMin = Math.round(Number(val) / 60); // Sekunden -> Minuten
  } else if (val.includes(':')) {
    const [h, m] = val.split(':');
    totalMin = (parseInt(h) || 0) * 60 + (parseInt(m) || 0);
  } else {
    return "";
  }
  if (totalMin <= 0) return "";
  const stunden = Math.floor(totalMin / 60);
  const minuten = totalMin % 60;
  if (stunden > 0 && minuten > 0) return `${stunden}h ${minuten}min`;
  if (stunden > 0) return `${stunden}h`;
  return `${minuten}min`;
};

const getDisplayTitle = (b: any) => {
  const title = getValue(b, 'Tätigkeit'); 
  const note = getValue(b, 'Notiz_Patient');
  const status = getValue(b, 'Status');
  
  if ((title === "Terminanfrage App" || status === "Anfrage") && note) {
     if (note.includes("Grund:")) return note.split("Grund:")[1].trim(); 
     if (note.includes("Wunschdatum")) return "Terminanfrage"; 
  }
  return title || "Termin";
};

const getProposedDetails = (b: any) => {
    const note = getValue(b, 'Notiz_Patient');
    const status = getValue(b, 'Status');
    if (status === 'Anfrage' && note && note.includes("Wunschtermin:")) {
        try {
            const datePart = note.split("Wunschtermin:")[1].split("\n")[0].trim();
            let pDate = datePart;
            let pTime = "--:--";
            if (datePart.includes(" um ")) {
                const parts = datePart.split(" um ");
                pDate = parts[0];
                pTime = parts[1].replace(" Uhr", "");
            }
            return { date: pDate, time: pTime, isProposed: true };
        } catch (e) { return null; }
    }
    return null;
};

export default function App() {
  const [patientId, setPatientId] = useState<string | null>(localStorage.getItem('active_patient_id'));
  const [token, setToken] = useState<string | null>(localStorage.getItem('active_token'));
  // Push-Status Patient: 'idle' = noch nicht aktiviert, 'granted' = aktiv, 'denied' = blockiert, 'install' = iOS ohne Home-Bildschirm-Installation
  const [patientPushStatus, setPatientPushStatus] = useState<'idle' | 'granted' | 'denied' | 'install'>('idle');
  const [fullName, setFullName] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [loginMode, setLoginMode] = useState<'select' | 'patient' | 'mitarbeiter'>('select');
  const [mitarbeiterId, setMitarbeiterId] = useState<string | null>(localStorage.getItem('active_mitarbeiter_id'));
  const [mitarbeiterName, setMitarbeiterName] = useState<string>(localStorage.getItem('active_mitarbeiter_name') || '');
  const [mitarbeiterTermine, setMitarbeiterTermine] = useState<any[]>([]);
  const [mitarbeiterLoading, setMitarbeiterLoading] = useState(false);
  const [mitarbeiterTab, setMitarbeiterTab] = useState<'uebersicht'|'tagesplan'|'urlaub'|'lohn'>('uebersicht');
  const [meldungTermin, setMeldungTermin] = useState<any|null>(null);
  const [meldungTyp, setMeldungTyp] = useState<string>('');
  const [meldungNotiz, setMeldungNotiz] = useState('');
  const [meldungSending, setMeldungSending] = useState(false);
  const [meldungSent, setMeldungSent] = useState(false);
  const [urlaubVon, setUrlaubVon] = useState('');
  const [urlaubBis, setUrlaubBis] = useState('');
  const [urlaubNotiz, setUrlaubNotiz] = useState('');
  const [urlaubSending, setUrlaubSending] = useState(false);
  const [urlaubListe, setUrlaubListe] = useState<any[]>([]);
  const [urlaubLoading, setUrlaubLoading] = useState(false);
  const [lohnListe, setLohnListe] = useState<any[]>([]);
  const [lohnLoading, setLohnLoading] = useState(false);
  const [mitarbeiterPushStatus, setMitarbeiterPushStatus] = useState<'idle'|'subscribed'|'loading'|'denied'>('idle');
  const [mitarbeiterPushMsg, setMitarbeiterPushMsg] = useState<string>('');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // DATEN
  const [patientData, setPatientData] = useState<any>(null);
  const [contactData, setContactData] = useState<any[]>([]);
  const [besuche, setBesuche] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);

  // Gelesene Dokumente speichern
  const [seenDocIds, setSeenDocIds] = useState<string[]>(() => {
      const saved = localStorage.getItem('seen_docs');
      return saved ? JSON.parse(saved) : [];
  });

  const [showAllTasks, setShowAllTasks] = useState(false);
  const [activeModal, setActiveModal] = useState<'folder' | 'upload' | 'video' | 'ki-telefon' | 'new-appointment' | 'revoke-consent' | 'lohn-choice' | 'sign' | null>(null);
  const [selectedLohn, setSelectedLohn] = useState<any>(null);
  const [signDoc, setSignDoc] = useState<any>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [signaturStep, setSignaturStep] = useState<1 | 2>(1);
  const [sigKlient, setSigKlient] = useState<string | null>(null);
  const [sigBestaetigung, setSigBestaetigung] = useState<string | null>(null);
  const [isLandscape, setIsLandscape] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : true);
  const [lohnDownloading, setLohnDownloading] = useState(false);
  const [uploadContext, setUploadContext] = useState<'Rechnung' | 'Leistungsnachweis' | ''>(''); 
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'success' | 'error'>('idle');
  
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const [showArchive, setShowArchive] = useState(false);

  const [confirmedTermine, setConfirmedTermine] = useState<string[]>([]);
  const [editingTermin, setEditingTermin] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<string[]>([]);
  
  const [newTerminDate, setNewTerminDate] = useState(""); 
  const [newTerminTime, setNewTerminTime] = useState(""); 
  const [requestDate, setRequestDate] = useState("");
  const [requestTime, setRequestTime] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [urlaubStart, setUrlaubStart] = useState("");
  const [urlaubEnde, setUrlaubEnde] = useState("");

  const [kiPos, setKiPos] = useState({ x: 24, y: 120 });
  const isDragging = useRef(false);

  const besucheRef = useRef<any[]>([]);
  const isFetchingRef = useRef(false);
  const lastFetchTimeRef = useRef<number>(0);
  const sigClearRef = useRef<(() => void) | null>(null); 

  const handleDrag = (e: any) => {
    if (!isDragging.current) return;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    setKiPos({
      x: Math.max(10, window.innerWidth - clientX - 40),
      y: Math.max(10, window.innerHeight - clientY - 40)
    });
  };

  // --- FETCH LOGIC ---
  const fetchData = async (force = false, background = false) => {
    const authToken = token || localStorage.getItem('active_token');
    if (!authToken || authToken === "null") return;

    if (isFetchingRef.current) return; 

    const now = Date.now();
    const CACHE_TIME = 15 * 60 * 1000; 
    if (!force && (now - lastFetchTimeRef.current < CACHE_TIME) && patientData) {
        return; 
    }
    
    isFetchingRef.current = true;
    if (!background) setLoading(true);
    setErrorMsg(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); 

    try {
        const response = await fetch(`/api/app-data?token=${authToken}`, {
            signal: controller.signal
        });
        
        if (!response.ok) throw new Error(`Server Fehler: ${response.status}`);
        
        let json = await response.json();
        
        if (Array.isArray(json) && json.length > 0) {
            json = json[0];
        }

        // Token ungültig oder abgelaufen -> sauber ausloggen
        if (json && json.status === "unauthorized") {
            localStorage.clear();
            setPatientId(null);
            setToken(null);
            return;
        }

        clearTimeout(timeoutId);
        lastFetchTimeRef.current = Date.now();

        if (json.data) {
            if (json.data.patienten_daten) {
                const p = json.data.patienten_daten;
                setPatientData(p.fields ? p.fields : p);
            }

            const cData = json.data.kontakte || [];
            setContactData(cData);

            // Dokumente laden
            const dData = json.data.dokumente || [];
            setDocuments(dData.map((d:any) => ({
                id: d.id,
                Typ: getValue(d, 'Typ'),
                Dateiname: getValue(d, 'Dateiname'),
                Link: getFileUrl(d, 'Datei'),
                Richtung: getValue(d, 'Richtung'),
                Vom_Patienten_Gesehen: getValue(d, 'Vom_Patienten_Gesehen'),
                Vom_Patienten_Bestaetigt_Am: getValue(d, 'Vom_Patienten_Bestätigt_Am'),
                Datum: getValue(d, 'Datum') || getValue(d, 'Erstellt'),
                Bezahlt: getValue(d, 'Bezahlt') === 'true' || getValue(d, 'Bezahlt') === 'Bezahlt' || d.fields?.Bezahlt === true
            })));

            const bData = json.data.besuche || [];
            const mappedBesuche = bData.map((b: any) => {
                return { 
                    id: b.id, 
                    ...b,
                    Tätigkeit: getValue(b, 'Tätigkeit'), 
                    Uhrzeit: getValue(b, 'Uhrzeit'),
                    Status: getValue(b, 'Status'),
                    Notiz_Patient: getValue(b, 'Notiz_Patient'),
                    Pfleger_Name: getValue(b, 'Pfleger_Name')
                }; 
            });
            const sortedBesuche = mappedBesuche.sort((a:any, b:any) => {
                const dA = new Date(unbox(a.Uhrzeit)).getTime() || 0;
                const dB = new Date(unbox(b.Uhrzeit)).getTime() || 0;
                return dA - dB;
            });

            if (besucheRef.current.length > 0 && sortedBesuche.length > 0) {
                const changes: string[] = [];
                sortedBesuche.forEach((newItem: any) => {
                    const oldItem = besucheRef.current.find((old: any) => old.id === newItem.id);
                    if (!oldItem || unbox(oldItem.Status) !== unbox(newItem.Status)) {
                        changes.push(newItem.id);
                    }
                });
                if (changes.length > 0) {
                    if (background) setShowUpdateBanner(true);
                    else {
                        setHighlightedIds(changes);
                        setTimeout(() => setHighlightedIds([]), 180000);
                    }
                }
            }
            setBesuche(sortedBesuche);
            besucheRef.current = sortedBesuche;

            const tData = json.data.tasks || [];
            setTasks(tData.map((t: any) => {
                return { 
                    id: t.id, 
                    text: getValue(t, 'Aufgabentext') || "Aufgabe", 
                    done: getValue(t, 'Status') === "Erledigt" 
                };
            }));
        }

    } catch (e: any) {
        if (e.name !== 'AbortError' && !background) setErrorMsg("Ladefehler.");
    } finally {
        isFetchingRef.current = false;
        if (!background) setLoading(false);
    }
  };

  useEffect(() => {
      if (patientId) fetchData(false);
  }, [patientId]);

  // Geräte-Ausrichtung verfolgen (Signatur-Pad nur im Querformat)
  useEffect(() => {
      const update = () => setIsLandscape(window.innerWidth > window.innerHeight);
      window.addEventListener('resize', update);
      window.addEventListener('orientationchange', update);
      return () => {
          window.removeEventListener('resize', update);
          window.removeEventListener('orientationchange', update);
      };
  }, []);

  // Push-Status beim Login prüfen (kein automatisches Nachfragen)
  // iOS: Web-Push funktioniert NUR, wenn die App zum Home-Bildschirm hinzugefügt wurde.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  useEffect(() => {
      if (!patientId) return;
      if (typeof Notification === 'undefined' || !('PushManager' in window)) {
          // iOS im Safari-Tab: Push-API existiert erst nach "Zum Home-Bildschirm"
          setPatientPushStatus(isIOS && !isStandalone ? 'install' : 'denied');
          return;
      }
      if (Notification.permission === 'denied') { setPatientPushStatus('denied'); return; }
      isPushSubscribed().then(subscribed => {
          setPatientPushStatus(subscribed && Notification.permission === 'granted' ? 'granted' : 'idle');
      });
  }, [patientId]);

  const aktivierePush = async () => {
      try {
          if (typeof Notification === 'undefined' || !('PushManager' in window)) {
              setPatientPushStatus(isIOS && !isStandalone ? 'install' : 'denied');
              return;
          }
          if (Notification.permission === 'denied') {
              setPatientPushStatus('denied');
              return;
          }
          const ok = await subscribeToPush(patientId!);
          if (ok) {
              setPatientPushStatus('granted');
          } else if ((Notification.permission as string) === 'denied') {
              setPatientPushStatus('denied');
          } else {
              alert('Ohne erlaubte Benachrichtigungen können wir Sie nicht über neue Termine oder Dokumente informieren.');
          }
      } catch (err: any) {
          console.error('Push-Aktivierung fehlgeschlagen:', err);
          alert('Benachrichtigungen konnten nicht aktiviert werden: ' + err.message);
      }
  };

  // Dokument als gelesen markieren
  const markAsSeen = (id: string) => {
      const doc = documents.find(d => d.id === id);
      // Bereits serverseitig gesehen -> nichts tun (kein doppelter Call)
      if (doc && unbox(doc.Vom_Patienten_Gesehen)) return;
      // localStorage weiter pflegen (Alt-Kompatibilität)
      if (!seenDocIds.includes(id)) {
          const newSeen = [...seenDocIds, id];
          setSeenDocIds(newSeen);
          localStorage.setItem('seen_docs', JSON.stringify(newSeen));
      }
      // Optimistisch: Punkt/Badge reagiert sofort (Quelle der Wahrheit ist der Server)
      setDocuments(prev => prev.map(d => d.id === id ? { ...d, Vom_Patienten_Gesehen: 'true' } : d));
      // Server geräteübergreifend informieren, danach neu laden -> Badges verschwinden sofort
      fetch(`${N8N_BASE_URL}/mark_document_seen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: id })
      }).then(() => fetchData(true)).catch(e => console.error(e));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setLoginError(null);

    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/patient-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fullName, code: loginCode }) });
      const data = await res.json();
      if (data.status === "success" && data.patientId && data.token) {
        localStorage.setItem('active_patient_id', data.patientId);
        localStorage.setItem('active_token', data.token);
        setPatientId(data.patientId);
        setToken(data.token);
      } else { 
          setLoginError("Das eingegebene Passwort ist falsch"); 
      }
    } catch (e) { setLoginError("Verbindungsfehler beim Login."); } finally { setIsLoggingIn(false); }
  };

  const handleRevokeConsent = async () => {
    setIsSending(true);
    try {
        const formData = new FormData();
        formData.append('token', token!);
        formData.append('patientName', getValue(patientData, 'Name'));
        formData.append('typ', 'Widerruf_Digitale_Rechnung'); 
        formData.append('nachricht', 'Der Patient hat die Einwilligung für digitale Rechnungen widerrufen.');
        const res = await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Server antwortete mit ${res.status}: ${text}`);
        }
        setSentStatus('success');
        setTimeout(() => {
            setActiveModal(null);
            setSentStatus('idle');
            alert("Einstellung gespeichert. Sie erhalten Rechnungen zukünftig per Post.");
        }, 1500);
    } catch (err: any) {
        console.error('Fehler beim Widerruf:', err);
        setSentStatus('error');
        alert('Fehler: ' + err.message);
    }
    setIsSending(false);
  };

  const handleLohnDownload = async (lohn: any) => {
    setLohnDownloading(true);
    try {
        const fileName = `Lohnabrechnung_${lohn.zeitraum}.pdf`;
        const proxyUrl = `/api/lohn-download?url=${encodeURIComponent(lohn.url)}&name=${encodeURIComponent(fileName)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Server antwortete mit ${response.status}: ${text}`);
        }
        const blob = await response.blob();
        const file = new File([blob], fileName, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Lohnabrechnung' });
        } else {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        }
        setActiveModal(null);
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            console.error('Fehler beim Lohn-Download:', err);
            alert('Fehler beim Herunterladen: ' + err.message);
        }
    }
    setLohnDownloading(false);
  };

  // Rechnung aufs Handy laden (Dateien-App via Web-Share, sonst Blob-Download)
  const downloadRechnung = async (item: any) => {
    try {
        const name = item.dateiname || 'Rechnung.pdf';
        const proxyUrl = `/api/lohn-download?url=${encodeURIComponent(item.url)}&name=${encodeURIComponent(name)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Server antwortete mit ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], name, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: name });
        } else {
            const u = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = u; a.download = file.name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(u);
        }
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            console.error('Fehler beim Rechnungs-Download:', err);
            alert('Fehler beim Herunterladen: ' + err.message);
        }
    }
  };

  const openSignModal = (doc: any) => {
    setSignDoc(doc);
    setSignaturStep(1);
    setSigKlient(null);
    setSigBestaetigung(null);
    setActiveModal('sign');
  };
  const closeSignModal = () => {
    setActiveModal(null);
    setSignDoc(null);
    setSignaturStep(1);
    setSigKlient(null);
    setSigBestaetigung(null);
  };

  const handleSignSubmit = async () => {
    if (!signDoc || !token || !sigKlient) return;
    setIsSigning(true);
    try {
        const res = await fetch('/api/sign-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, originalDocumentId: signDoc.id, signaturKlient: sigKlient, signaturBestaetigung: sigBestaetigung }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Server antwortete mit ${res.status}: ${t}`);
        }
        closeSignModal();
        fetchData(true);
    } catch (err: any) {
        console.error('Bestätigung fehlgeschlagen:', err);
        alert('Fehler beim Absenden der Unterschriften: ' + err.message);
    }
    setIsSigning(false);
  };

  const toggleTask = async (id: string, currentStatus: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !currentStatus } : t));
    try {
      const res = await fetch(`${N8N_BASE_URL}/update_task`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: id, done: !currentStatus, token: token }) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Server antwortete mit ${res.status}: ${text}`);
      }
    } catch (err: any) {
      console.error('Fehler beim Aktualisieren der Aufgabe:', err);
      setTasks(prev => prev.map(t => t.id === id ? { ...t, done: currentStatus } : t));
      alert('Fehler beim Speichern der Aufgabe: ' + err.message);
    }
  };

  const handleTerminConfirm = async (recordId: string) => {
    setConfirmedTermine([...confirmedTermine, recordId]);
    try {
        const formData = new FormData();
        formData.append('token', token!);
        formData.append('typ', 'Termin_bestatigen');
        formData.append('recordId', recordId);
        const res = await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Server antwortete mit ${res.status}: ${text}`);
        }
        setTimeout(() => fetchData(true), 1500);
    } catch (err: any) {
        console.error('Fehler beim Bestätigen des Termins:', err);
        setConfirmedTermine(prev => prev.filter(id => id !== recordId));
        alert('Fehler beim Bestätigen des Termins: ' + err.message);
    }
  };

  const handleTerminReschedule = async (recordId: string, oldDateRaw: string) => {
    if(!newTerminDate) return;
    setIsSending(true);
    setPendingChanges([...pendingChanges, recordId]);
    setEditingTermin(null);
    try {
        const formData = new FormData();
        formData.append('token', token!);
        formData.append('typ', 'Terminverschiebung');
        formData.append('recordId', recordId);
        let nachricht = `Verschiebung gewünscht von ${formatDate(oldDateRaw)} auf ${formatDate(newTerminDate)}`;
        if (newTerminTime) nachricht += ` um ca. ${newTerminTime} Uhr`;
        formData.append('nachricht', nachricht);
        const res = await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Server antwortete mit ${res.status}: ${text}`);
        }
        setNewTerminDate(""); setNewTerminTime("");
        setTimeout(() => fetchData(true), 1500);
    } catch (err: any) {
        console.error('Fehler bei Terminverschiebung:', err);
        setPendingChanges(prev => prev.filter(id => id !== recordId));
        alert('Fehler beim Senden der Terminänderung: ' + err.message);
    }
    setIsSending(false);
  };

  const handleNewTerminRequest = async () => {
      if(!requestDate) return;
      const tempId = "temp-" + Date.now();
      const fakeVisit = {
          id: tempId,
          Tätigkeit: requestReason || "Terminanfrage",
          Uhrzeit: requestTime ? `${requestDate}T${requestTime}:00` : `${requestDate}T00:00:00`,
          Status: "Anfrage",
          Notiz_Patient: `Wunschtermin: ${formatDate(requestDate)}`,
          Pfleger_Name: "Wird zugewiesen"
      };
      setBesuche(prev => [...prev, fakeVisit]);
      setActiveModal(null);
      setSentStatus('success'); 
      const saveDate = requestDate;
      const saveTime = requestTime;
      const saveReason = requestReason;
      setRequestDate(""); setRequestTime(""); setRequestReason("");
      setIsSending(true);
      try {
        const formData = new FormData();
        formData.append('token', token!);
        formData.append('patientName', getValue(patientData, 'Name'));
        formData.append('typ', 'Terminanfrage');
        formData.append('betreff', saveReason || "Terminanfrage");
        formData.append('wunschDatum', saveDate);              // roh, YYYY-MM-DD
        if (saveTime) formData.append('wunschZeit', saveTime); // roh, HH:MM (falls gesetzt)
        let note = `Wunschtermin: ${formatDate(saveDate)}`;
        if (saveTime) note += ` um ${saveTime} Uhr`;
        formData.append('nachricht', note);
        const res = await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Server antwortete mit ${res.status}: ${text}`);
        }
        setTimeout(() => fetchData(true), 2000);
      } catch (err: any) {
          console.error('Fehler bei Terminanfrage:', err);
          setSentStatus('error');
          setBesuche(prev => prev.filter(b => b.id !== tempId));
          alert('Fehler beim Senden der Terminanfrage: ' + err.message);
      }
      setIsSending(false);
  };

  const submitData = async (type: string, payload: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('token', token!);
      formData.append('patientId', patientId!);
      formData.append('patientName', getValue(patientData, 'Name'));
      let res: Response;
      if (activeModal === 'upload' && selectedFiles.length > 0) {
          formData.append('typ', type.replace('-Upload', '')); formData.append('data', selectedFiles[0]);
          const uploadUrl = `${N8N_BASE_URL}/upload_document`;
          console.log('Upload an', uploadUrl);
          for (const pair of formData.entries()) { console.log(' -', pair[0], pair[1]); }
          res = await fetch(uploadUrl, { method: 'POST', body: formData });
      } else {
          formData.append('typ', type); formData.append('nachricht', payload);
          res = await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
      }
      if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Server antwortete mit ${res.status}: ${text}`);
      }
      setSentStatus('success');
      setTimeout(() => { if (activeModal === 'upload') setActiveModal('folder'); else setActiveModal(null); setSentStatus('idle'); setUrlaubStart(""); setUrlaubEnde(""); setSelectedFiles([]); fetchData(true); }, 1500);
    } catch (err: any) {
      console.error('Fehler beim Absenden:', err);
      setSentStatus('error');
      alert('Fehler beim Absenden: ' + err.message);
    }
    setIsSending(false);
  };

  const handleBannerClick = () => {
      fetchData(true).then(() => setShowUpdateBanner(false));
  };

  // Login Screen
  // === MITARBEITER: Login, Termine, Push, Urlaub, Lohn (n8n + /api) ===
  const handleMitarbeiterLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/ma-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, code: loginCode })
      });
      const data = await res.json();
      if (data.status === "success" && data.mitarbeiterId) {
        localStorage.setItem('active_mitarbeiter_id', data.mitarbeiterId);
        localStorage.setItem('active_mitarbeiter_name', data.name || '');
        setMitarbeiterId(data.mitarbeiterId);
        setMitarbeiterName(data.name || '');
      } else {
        setLoginError("Name oder Code nicht korrekt");
      }
    } catch (e) {
      setLoginError("Verbindungsfehler beim Login.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const fetchMitarbeiterTermine = async () => {
    if (!mitarbeiterId) return;
    setMitarbeiterLoading(true);
    try {
      const res = await fetch('/api/ma-termine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mitarbeiterId: mitarbeiterId })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Server antwortete mit ${res.status}: ${text}`);
      }
      const data = await res.json();
      const liste = Array.isArray(data) ? data : [];
      liste.sort((a: any, b: any) => {
        const dA = new Date(getValue(a, 'Uhrzeit')).getTime() || 0;
        const dB = new Date(getValue(b, 'Uhrzeit')).getTime() || 0;
        return dA - dB;
      });
      setMitarbeiterTermine(liste);
    } catch (err: any) {
      console.error('Fehler beim Laden der Termine:', err);
      alert('Fehler beim Laden der Termine: ' + err.message);
    } finally {
      setMitarbeiterLoading(false);
    }
  };

  useEffect(() => {
    if (mitarbeiterId && mitarbeiterName) fetchMitarbeiterTermine();
  }, [mitarbeiterId, mitarbeiterName]);

  useEffect(() => {
      if (!mitarbeiterId) return;
      isPushSubscribed().then(subscribed => {
          if (subscribed) setMitarbeiterPushStatus('subscribed');
          else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') setMitarbeiterPushStatus('denied');
          else setMitarbeiterPushStatus('idle');
      });
  }, [mitarbeiterId]);

  const handleMitarbeiterPush = async () => {
      if (!mitarbeiterId) return;
      setMitarbeiterPushStatus('loading');
      const ok = await subscribeMitarbeiter(mitarbeiterId);
      setMitarbeiterPushStatus(ok ? 'subscribed' : 'denied');
      if (ok) {
        setMitarbeiterPushMsg('Verbindung aktualisiert ✓');
        setTimeout(() => setMitarbeiterPushMsg(''), 3000);
      }
  };

  useEffect(() => {
      if (!mitarbeiterId) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      subscribeMitarbeiter(mitarbeiterId).catch((e) => console.log('Stiller Push-Sync fehlgeschlagen:', e));
  }, [mitarbeiterId]);

  const fetchUrlaubListe = async () => {
    if (!mitarbeiterId) return;
    setUrlaubLoading(true);
    try {
      const res = await fetch('/api/urlaub-liste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mitarbeiterId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Server antwortete mit ${res.status}: ${text}`);
      }
      const data = await res.json();
      setUrlaubListe(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Fehler beim Laden der Urlaubsliste:', err);
      alert('Fehler beim Laden der Urlaubsanträge: ' + err.message);
    }
    finally { setUrlaubLoading(false); }
  };

  const handleUrlaubAntrag = async () => {
    if (!urlaubVon || !urlaubBis) return;
    setUrlaubSending(true);
    try {
      const res = await fetch('/api/urlaub-antrag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mitarbeiterId, mitarbeiterName, von: urlaubVon, bis: urlaubBis, notiz: urlaubNotiz }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Server antwortete mit ${res.status}: ${text}`);
      }
      setUrlaubVon(''); setUrlaubBis(''); setUrlaubNotiz('');
      await fetchUrlaubListe();
    } catch (err: any) {
      console.error('Fehler beim Urlaubsantrag:', err);
      alert('Fehler beim Senden des Urlaubsantrags: ' + err.message);
    }
    finally { setUrlaubSending(false); }
  };

  const fetchLohnListe = async () => {
    if (!mitarbeiterId) return;
    setLohnLoading(true);
    try {
      const res = await fetch('/api/lohn-liste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mitarbeiterId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Server antwortete mit ${res.status}: ${text}`);
      }
      const data = await res.json();
      setLohnListe(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Fehler beim Laden der Lohnliste:', err);
      alert('Fehler beim Laden der Lohnabrechnungen: ' + err.message);
    }
    finally { setLohnLoading(false); }
  };

  if (mitarbeiterId) {
    const heute = new Date();
    heute.setHours(0,0,0,0);
    const morgen = new Date(heute);
    morgen.setDate(morgen.getDate() + 1);

    const termineHeute = mitarbeiterTermine.filter(t => {
      const d = new Date(getValue(t, 'Uhrzeit'));
      return d >= heute && d < morgen;
    });
    const termineZukunft = mitarbeiterTermine.filter(t => {
      const d = new Date(getValue(t, 'Uhrzeit'));
      return d >= morgen;
    });

    const heuteText = heute.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });

    const getStatusBadge = (t: any) => {
      const status = getValue(t, 'Status');
      if (status === 'Bestätigt')
        return { text: 'BESTÄTIGT', icon: 'check', bg: '#e6f4ea', color: '#1e4620' };
      if (status === 'Änderungswunsch')
        return { text: 'ÄNDERUNGSWUNSCH DES PATIENTEN', icon: 'alert', bg: '#fce8e6', color: '#993C1D', strong: true };
      if (status === 'Anfrage')
        return { text: 'NEUE ANFRAGE', icon: 'clock', bg: '#fff7ed', color: '#854F0B' };
      if (status === 'Geplant')
        return { text: 'WARTET AUF BESTÄTIGUNG', icon: 'clock', bg: '#fff7ed', color: '#854F0B' };
      return { text: status || 'OFFEN', icon: 'clock', bg: '#f3f4f6', color: '#6b7280' };
    };

    const renderBadgeIcon = (icon: string) => {
      if (icon === 'check') return <Check size={14} strokeWidth={3} />;
      if (icon === 'alert') return <AlertTriangle size={14} strokeWidth={3} />;
      return <AlertCircle size={14} strokeWidth={3} />;
    };

    const handleSendMeldung = async () => {
      if (!meldungTermin || !meldungTyp) return;
      setMeldungSending(true);
      try {
        const patientId = (meldungTermin.fields && meldungTermin.fields.Patient
          && meldungTermin.fields.Patient[0]) || '';
        const besuchId = meldungTermin.id;
        const res = await fetch('/api/meldung-senden', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mitarbeiterName: mitarbeiterName,
            typ: meldungTyp,
            patientId: patientId,
            besuchId: besuchId,
            notiz: meldungNotiz,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Server antwortete mit ${res.status}: ${text}`);
        }
        setMeldungSent(true);
        setTimeout(() => {
          setMeldungTermin(null);
          setMeldungTyp('');
          setMeldungNotiz('');
          setMeldungSent(false);
        }, 1500);
      } catch (err: any) {
        console.error('Fehler beim Senden der Meldung:', err);
        alert('Fehler beim Senden der Meldung: ' + err.message);
      } finally {
        setMeldungSending(false);
      }
    };

    return (
    <div className="min-h-screen bg-white pb-32">
      <header className="py-4 px-6 bg-[#dccfbc] text-white flex justify-between items-center shadow-sm">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11" />
        <div className="flex items-center gap-3">
          <p className="text-xs font-bold italic">{mitarbeiterName}</p>
          <button onClick={() => fetchMitarbeiterTermine()} className={`bg-white/20 p-3 rounded-full ${mitarbeiterLoading ? 'animate-spin' : ''}`}><RefreshCw size={20}/></button>
          <button onClick={() => { localStorage.removeItem('active_mitarbeiter_id'); localStorage.removeItem('active_mitarbeiter_name'); setMitarbeiterId(null); setMitarbeiterName(''); setLoginMode('select'); }} className="bg-white/20 p-3 rounded-full"><LogOut size={20}/></button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 pt-6">
        {/* TAB: START / NOTFALL */}
        {mitarbeiterTab === 'uebersicht' && (
          <div className="animate-in fade-in">
            {/* ÜBERSCHRIFT */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><CalendarDays size={32} className="text-[#b5a48b]" /></div>
              <h2 className="text-3xl font-black text-[#3A3A3A]">Übersicht</h2>
              <p className="text-xs text-gray-400 mt-1">Hallo {mitarbeiterName}, dein Tag im Blick.</p>
            </div>

            {/* TAGESPLAN-VORSCHAU */}
            <p className="text-[11px] font-black tracking-wide text-[#0F6E56] mb-2">
              HEUTE · {termineHeute.length === 0 ? 'Heute keine Einsätze' : termineHeute.length === 1 ? '1 Einsatz' : `${termineHeute.length} Einsätze`}
            </p>
            {termineHeute.length === 0 ? (
              <div className="bg-white rounded-2xl p-5 text-gray-400 italic text-center">Heute keine Einsätze geplant.</div>
            ) : (
              <div className="space-y-3">
                {termineHeute.map((t) => {
                  const status = getValue(t, 'Status');
                  const isAbgesagt = status === 'Abgesagt';
                  const tile =
                    status === 'Bestätigt' ? { cls: 'bg-[#EEF6EE] border border-[#CBE3CB] border-l-4 border-l-[#5B9E5B] shadow-lg -translate-y-0.5', label: 'BESTÄTIGT', labelCls: 'text-[#3D7A3D]' }
                    : isAbgesagt ? { cls: 'bg-[#F8E8E6] border border-[#E5B8B2] border-l-4 border-l-[#B5483C] shadow-none', label: 'ABGESAGT', labelCls: 'text-[#B5483C]' }
                    : status === 'Änderungswunsch' ? { cls: 'bg-white border-2 border-[#D85A30]', label: 'ÄNDERUNG', labelCls: 'text-[#993C1D]' }
                    : { cls: 'bg-[#FAF5EE] border border-[#E8DCC8] shadow-sm', label: (status || 'GEPLANT').toUpperCase(), labelCls: 'text-gray-400' };
                  return (
                    <div key={t.id} className={`rounded-2xl p-4 flex items-center gap-3 ${tile.cls}`}>
                      <p className="text-sm font-bold text-gray-700 min-w-[44px]">{formatTime(getValue(t, 'Uhrzeit'))}</p>
                      <div className="flex-1 text-left">
                        <p className={`text-sm font-black ${isAbgesagt ? 'line-through text-gray-400' : 'text-[#3A3A3A]'}`}>{getValue(t, 'Tätigkeit')}</p>
                        <p className={`text-xs ${isAbgesagt ? 'line-through text-gray-400' : 'text-gray-500'}`}>{getValue(t, 'Patient_Name')}</p>
                      </div>
                      <span className={`text-[10px] font-black uppercase shrink-0 ${tile.labelCls}`}>{tile.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => { setMitarbeiterTab('tagesplan'); fetchMitarbeiterTermine(); }}
              className="w-full text-[#b5a48b] font-black uppercase text-[11px] flex items-center justify-center gap-2 py-3 mt-3"
            >
              <CalendarDays size={14}/> Vollständigen Tagesplan öffnen <ChevronRight size={14}/>
            </button>

            {/* NOTRUFE */}
            <div className="mt-8">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 text-center">Notrufe</p>
              <div className="mt-3 flex gap-3 mb-3">
                <a href="tel:112" className="flex-1 bg-[#FCEBEB] rounded-[1.5rem] p-4 text-center">
                  <p className="text-[11px] font-black tracking-wide text-[#791F1F]">RETTUNGSDIENST</p>
                  <p className="text-3xl font-black text-[#A32D2D]">112</p>
                </a>
                <a href="tel:110" className="flex-1 bg-[#E6F1FB] rounded-[1.5rem] p-4 text-center">
                  <p className="text-[11px] font-black tracking-wide text-[#0C447C]">POLIZEI</p>
                  <p className="text-3xl font-black text-[#185FA5]">110</p>
                </a>
              </div>
              <a href="tel:116117" className="flex items-center justify-between bg-[#F1EFE8] rounded-2xl p-4">
                <div>
                  <p className="text-[11px] text-gray-500">Ärztlicher Bereitschaftsdienst</p>
                  <p className="text-xl font-black text-gray-800">116 117</p>
                </div>
                <Phone size={24} className="text-gray-400" />
              </a>
            </div>

            {/* GEDÄCHTNISSTÜTZE / 5 W-FRAGEN */}
            <div className="mt-10">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 text-center">Gedächtnisstütze</p>
              <div className="mt-3">
                <div className="flex items-center gap-2 mb-3 text-[#993C1D]">
                  <Phone size={16} />
                  <h3 className="text-sm font-black">Die 5 W-Fragen beim Notruf</h3>
                </div>
                <div className="bg-white rounded-[2rem] border border-gray-100 overflow-hidden">
                  {[
                    ['WO?', 'Genaue Adresse des Klienten'],
                    ['WAS?', 'Was ist passiert?'],
                    ['WIE VIELE?', 'Anzahl betroffener Personen'],
                    ['WELCHE?', 'Welche Verletzungen oder Beschwerden?'],
                    ['WARTEN!', 'Auf Rückfragen der Leitstelle warten'],
                  ].map(([w, a], i, arr) => (
                    <div key={w} className={`flex gap-3 p-4 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                      <p className="text-[13px] font-black text-[#993C1D] min-w-[80px]">{w}</p>
                      <p className="text-[13px] text-gray-500">{a}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* EINSTELLUNGEN / PUSH-KARTE */}
            <div className="mt-8">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 text-center mb-3">Einstellungen</p>
              <div className="bg-white rounded-[2rem] p-5 shadow-sm border border-gray-100">
                {mitarbeiterPushStatus === 'subscribed' ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center justify-center gap-2 text-[#1e4620] font-bold text-sm">
                      <Check size={18} strokeWidth={3} /> Benachrichtigungen aktiv
                    </div>
                    <button onClick={handleMitarbeiterPush} className="text-xs text-[#b5a48b] underline px-4 py-2">
                      Erneut verbinden
                    </button>
                  </div>
                ) : mitarbeiterPushStatus === 'loading' ? (
                  <div className="flex justify-center py-2">
                    <RefreshCw size={20} className="animate-spin text-[#b5a48b]" />
                  </div>
                ) : mitarbeiterPushStatus === 'denied' ? (
                  <p className="text-center text-xs text-gray-500">
                    Benachrichtigungen sind blockiert. Bitte in den Browser-Einstellungen erlauben.
                  </p>
                ) : (
                  <button
                    onClick={handleMitarbeiterPush}
                    className="w-full bg-[#b5a48b] text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <Bell size={18} /> Benachrichtigungen aktivieren
                  </button>
                )}
              </div>
              {mitarbeiterPushMsg && (
                <p className="text-center text-xs text-[#1e4620] font-bold mt-2">{mitarbeiterPushMsg}</p>
              )}
            </div>
          </div>
        )}

        {/* TAB: URLAUB */}
        {mitarbeiterTab === 'urlaub' && (
          <div className="animate-in fade-in">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><Plane size={32} className="text-[#b5a48b]" /></div>
              <h2 className="text-3xl font-black text-[#3A3A3A]">Urlaubsplanung</h2>
              <p className="text-xs text-gray-400 mt-1">Beantrage deinen Urlaub und sieh den Stand.</p>
            </div>

            {/* ANTRAGSFORMULAR */}
            <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 mb-8 space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-[#b5a48b]">VON WANN</label>
                <input type="date" value={urlaubVon} onChange={(e) => setUrlaubVon(e.target.value)}
                  style={{ colorScheme: 'light' }}
                  className="w-full bg-[#F9F7F4] rounded-xl p-3 mt-1 outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-[#b5a48b]">BIS WANN</label>
                <input type="date" value={urlaubBis} onChange={(e) => setUrlaubBis(e.target.value)}
                  style={{ colorScheme: 'light' }}
                  className="w-full bg-[#F9F7F4] rounded-xl p-3 mt-1 outline-none" />
              </div>
              <textarea placeholder="Notiz (optional)" value={urlaubNotiz}
                onChange={(e) => setUrlaubNotiz(e.target.value)}
                className="w-full bg-[#F9F7F4] rounded-xl p-3 outline-none min-h-[70px] resize-none" />
              <button onClick={handleUrlaubAntrag}
                disabled={!urlaubVon || !urlaubBis || urlaubSending}
                className="w-full bg-[#b5a48b] text-white py-4 rounded-2xl font-black uppercase shadow-lg active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {urlaubSending ? <RefreshCw className="animate-spin" size={18}/> : <><Send size={16}/> Urlaub beantragen</>}
              </button>
            </div>

            {/* MEINE ANTRÄGE */}
            <p className="text-[11px] font-black uppercase tracking-wide text-gray-400 mb-3">Meine Anträge</p>
            {urlaubLoading ? (
              <div className="flex justify-center py-6"><RefreshCw size={24} className="animate-spin text-[#b5a48b]" /></div>
            ) : urlaubListe.length === 0 ? (
              <div className="bg-white rounded-2xl p-5 text-gray-400 italic text-center">Noch keine Anträge.</div>
            ) : (
              urlaubListe.map((u) => {
                const tage = Math.max(1, Math.round((new Date(u.bis).getTime() - new Date(u.von).getTime()) / 86400000) + 1);
                const badge = u.status === 'Genehmigt' ? { cls: 'text-[#0F6E56] bg-[#E1F5EE]' }
                  : u.status === 'Abgelehnt' ? { cls: 'text-[#993C1D] bg-[#FAECE7]' }
                  : { cls: 'text-[#854F0B] bg-[#FAEEDA]' };
                return (
                  <div key={u.id} className={`bg-white rounded-2xl border border-gray-100 p-4 mb-2 flex items-center justify-between ${u.status === 'Abgelehnt' ? 'opacity-70' : ''}`}>
                    <div>
                      <p className="text-sm font-bold text-gray-700">{formatDate(u.von)} – {formatDate(u.bis)}</p>
                      <p className="text-xs text-gray-400">{tage} {tage === 1 ? 'Tag' : 'Tage'}</p>
                    </div>
                    <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${badge.cls}`}>{u.status}</span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB: LOHN */}
        {mitarbeiterTab === 'lohn' && (
          <div className="animate-in fade-in">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><Euro size={32} className="text-[#b5a48b]" /></div>
              <h2 className="text-3xl font-black text-[#3A3A3A]">Lohnabrechnung</h2>
              <p className="text-xs text-gray-400 mt-1">Deine monatlichen Abrechnungen.</p>
            </div>

            {lohnLoading ? (
              <div className="flex justify-center py-10"><RefreshCw size={24} className="animate-spin text-[#b5a48b]" /></div>
            ) : lohnListe.length === 0 ? (
              <div className="bg-white rounded-[2rem] p-5 text-gray-400 italic text-center">Noch keine Lohnabrechnungen vorhanden.</div>
            ) : (
              lohnListe.map((l) => (
                l.url ? (
                  <button key={l.id} onClick={() => { setSelectedLohn(l); setActiveModal('lohn-choice'); }} className="w-full bg-white rounded-[2rem] border border-gray-100 p-4 mb-2 flex items-center justify-between text-left active:scale-95 transition-all">
                    <div>
                      <p className="text-sm font-bold text-gray-700">{formatMonat(l.zeitraum)}</p>
                      <p className="text-xs text-gray-400">{l.dateiname}</p>
                    </div>
                    <div className="text-[#b5a48b] p-2"><Download size={22} /></div>
                  </button>
                ) : (
                  <div key={l.id} className="bg-white rounded-[2rem] border border-gray-100 p-4 mb-2 flex items-center justify-between opacity-50">
                    <div>
                      <p className="text-sm font-bold text-gray-700">{formatMonat(l.zeitraum)}</p>
                      <p className="text-xs text-gray-400">Noch keine Datei hinterlegt</p>
                    </div>
                  </div>
                )
              ))
            )}
          </div>
        )}

        {/* TAB: TAGESPLAN */}
        {mitarbeiterTab === 'tagesplan' && (
        <>
        {mitarbeiterLoading ? (
          <div className="flex justify-center py-20"><RefreshCw size={32} className="animate-spin text-[#b5a48b]" /></div>
        ) : (
          <>
            {/* DATUMS-HEADER */}
            <div className="text-center mb-6">
              <p className="text-[11px] font-black uppercase tracking-wide text-[#0F6E56]">HEUTE · {heuteText}</p>
              <h2 className="text-2xl font-black text-[#3A3A3A] mt-1">{termineHeute.length === 1 ? '1 Einsatz' : `${termineHeute.length} Einsätze`}</h2>
            </div>

            {/* HEUTE-TERMINE */}
            {termineHeute.length === 0 ? (
              <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-10 text-center">
                <CalendarDays size={32} className="text-[#dccfbc] mx-auto mb-3" />
                <p className="text-gray-400 italic">Heute keine Einsätze geplant.</p>
              </div>
            ) : (
              termineHeute.map((t) => {
                const showDauer = formatDauer(getValue(t, 'Dauer'));
                const ersatz = getValue(t, 'Pfleger_Ersatz_Name');
                const badge = getStatusBadge(t);
                const status = getValue(t, 'Status');
                const isAbgesagt = status === 'Abgesagt';
                const cardClasses = badge.strong
                  ? 'bg-white border-2 border-[#D85A30]'
                  : status === 'Bestätigt'
                    ? 'bg-[#EEF6EE] border border-[#CBE3CB] border-l-4 border-l-[#5B9E5B]'
                    : isAbgesagt
                      ? 'bg-[#F8E8E6] border border-[#E5B8B2] border-l-4 border-l-[#B5483C]'
                      : 'bg-[#FAF5EE] border border-[#E8DCC8] border-l-4 border-l-[#b5a48b]';
                return (
                  <div key={t.id} className={`rounded-[2rem] shadow-sm mb-3 overflow-hidden ${cardClasses}`}>
                    <div className="p-6 flex items-center gap-3">
                      {/* LINKS: Uhrzeit */}
                      <div className="text-center min-w-[56px]">
                        <p className="text-xl font-bold text-gray-300">{formatTime(getValue(t, 'Uhrzeit'))}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">UHR</p>
                      </div>
                      {/* MITTE: Inhalt */}
                      <div className="flex-1 border-l border-gray-100 pl-4 text-left">
                        <p className={`font-black text-lg mb-2 ${isAbgesagt ? 'line-through text-gray-400' : 'text-[#3A3A3A]'}`}>{getValue(t, 'Tätigkeit')}</p>
                        <div className="flex items-center gap-2">
                          <User size={12} className="text-gray-400"/>
                          <p className={`text-sm ${isAbgesagt ? 'line-through text-gray-400' : 'text-gray-500'}`}>{getValue(t, 'Patient_Name')}</p>
                        </div>
                        {ersatz && (
                          <div className="flex items-center gap-1 mt-1 text-[#c2410c]">
                            <RefreshCw size={10} strokeWidth={3} />
                            <span className="text-[10px] font-black uppercase">Vertretung</span>
                          </div>
                        )}
                      </div>
                      {/* RECHTS: Dauer */}
                      {showDauer && (
                        <div className="text-center min-w-[56px]">
                          <p className="text-xl text-gray-300">{showDauer}</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase">DAUER</p>
                        </div>
                      )}
                    </div>
                    {/* STATUS-BALKEN */}
                    <div style={{ backgroundColor: badge.bg, color: badge.color }} className="py-3 text-center font-black uppercase text-[10px] tracking-wider flex items-center justify-center gap-2">
                      {renderBadgeIcon(badge.icon)}
                      {badge.text}
                    </div>
                    {/* PROBLEM MELDEN */}
                    <button onClick={() => { setMeldungTermin(t); setMeldungTyp(''); setMeldungNotiz(''); }}
                      className="w-full border-t border-gray-100 py-3 text-[12px] font-black text-[#993C1D] flex items-center justify-center gap-2 active:bg-gray-50 transition-colors">
                      <Flag size={14}/> Problem melden
                    </button>
                  </div>
                );
              })
            )}

            {/* DEMNÄCHST */}
            {termineZukunft.length > 0 && (
              <>
                <div className="border-t border-gray-200 mt-6 pt-4 flex items-center justify-center gap-1.5">
                  <ChevronDown size={14} className="text-gray-400" />
                  <p className="text-[12px] font-black uppercase tracking-wide text-gray-400">Demnächst ({termineZukunft.length})</p>
                </div>
                {termineZukunft.map((t) => {
                  const datumOben = new Date(getValue(t, 'Uhrzeit')).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' });
                  const badge = getStatusBadge(t);
                  return (
                    <div key={t.id} className="bg-[#F9F7F4] border border-gray-100 rounded-[1.5rem] p-4 mb-2 opacity-75">
                      <div className="flex items-center gap-3">
                        {/* LINKS: Datum + Uhrzeit */}
                        <div className="text-center min-w-[52px]">
                          <p className="text-[13px] text-gray-500">{datumOben}</p>
                          <p className="text-[13px] text-gray-500">{formatTime(getValue(t, 'Uhrzeit'))}</p>
                        </div>
                        {/* MITTE: Inhalt */}
                        <div className="flex-1 border-l border-gray-200 pl-3 text-left">
                          <p className="text-sm font-bold text-gray-600">{getValue(t, 'Tätigkeit')}</p>
                          <p className="text-xs text-gray-400">{getValue(t, 'Patient_Name')}</p>
                        </div>
                        {/* RECHTS: Status-Label */}
                        <p style={{ color: badge.color }} className="text-[9px] font-black uppercase tracking-wider text-right max-w-[80px] leading-tight">{badge.text}</p>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
        </>
        )}
      </main>

      {/* MITARBEITER-NAV */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 border-t flex justify-around p-5 pb-11 z-50 rounded-t-[3rem] shadow-2xl">{[ { id: 'uebersicht', icon: Phone, label: 'Übersicht' }, { id: 'tagesplan', icon: CalendarDays, label: 'Plan' }, { id: 'urlaub', icon: Plane, label: 'Urlaub' }, { id: 'lohn', icon: Euro, label: 'Lohn' } ].map((tab) => (
        <button
            key={tab.id}
            onClick={() => {
                setMitarbeiterTab(tab.id as 'uebersicht'|'tagesplan'|'urlaub'|'lohn');
                fetchMitarbeiterTermine();
                if (tab.id === 'urlaub') fetchUrlaubListe();
                else if (tab.id === 'lohn') fetchLohnListe();
            }}
            className={`flex flex-col items-center gap-1.5 transition-all relative ${mitarbeiterTab === tab.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}
        >
            <div className="relative">
                <tab.icon size={22} strokeWidth={mitarbeiterTab === tab.id ? 3 : 2} />
            </div>
            <span className="text-[9px] font-black uppercase">{tab.label}</span>
        </button>
      ))}</nav>

      {/* MELDE-FENSTER */}
      {meldungTermin && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMeldungTermin(null)}></div>
          <div className="relative bg-white w-full max-w-md rounded-t-[3rem] p-8 shadow-2xl animate-in slide-in-from-bottom-10">
            {meldungSent ? (
              <div className="py-10 text-center">
                <div className="w-16 h-16 bg-[#e6f4ea] rounded-full flex items-center justify-center mx-auto mb-4"><Check size={32} className="text-[#1e4620]" strokeWidth={3} /></div>
                <p className="font-black text-xl text-[#3A3A3A]">Meldung gesendet!</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-6">
                  <div className="text-left">
                    <h3 className="text-xl font-black text-[#3A3A3A]">Meldung zu diesem Einsatz</h3>
                    <p className="text-xs text-gray-400 mt-1">{getValue(meldungTermin, 'Tätigkeit')} · {getValue(meldungTermin, 'Patient_Name')}</p>
                  </div>
                  <button onClick={() => setMeldungTermin(null)} className="p-2 -mr-2 -mt-2 text-gray-400"><X size={22}/></button>
                </div>

                <div className="space-y-2 mb-4">
                  <button onClick={() => setMeldungTyp('Kunde nicht angetroffen')} className={`w-full bg-[#FAECE7] rounded-2xl p-4 flex items-center gap-3 transition-all ${meldungTyp === 'Kunde nicht angetroffen' ? 'ring-2 ring-offset-1 ring-[#b5a48b]' : ''}`}>
                    <UserX size={20} className="text-[#993C1D]" />
                    <span className="text-[#712B13] font-bold">Kunde nicht angetroffen</span>
                  </button>
                  <button onClick={() => setMeldungTyp('Planungsfehler')} className={`w-full bg-[#FAEEDA] rounded-2xl p-4 flex items-center gap-3 transition-all ${meldungTyp === 'Planungsfehler' ? 'ring-2 ring-offset-1 ring-[#b5a48b]' : ''}`}>
                    <CalendarX size={20} className="text-[#854F0B]" />
                    <span className="text-[#633806] font-bold">Planungsfehler</span>
                  </button>
                  <button onClick={() => setMeldungTyp('Einsatzprobleme')} className={`w-full bg-[#FAEEDA] rounded-2xl p-4 flex items-center gap-3 transition-all ${meldungTyp === 'Einsatzprobleme' ? 'ring-2 ring-offset-1 ring-[#b5a48b]' : ''}`}>
                    <AlertTriangle size={20} className="text-[#854F0B]" />
                    <span className="text-[#633806] font-bold">Einsatzprobleme</span>
                  </button>
                  <button onClick={() => setMeldungTyp('Sonstiges')} className={`w-full bg-[#F1EFE8] rounded-2xl p-4 flex items-center gap-3 transition-all ${meldungTyp === 'Sonstiges' ? 'ring-2 ring-offset-1 ring-[#b5a48b]' : ''}`}>
                    <MoreHorizontal size={20} className="text-[#5F5E5A]" />
                    <span className="text-[#444441] font-bold">Sonstiges</span>
                  </button>
                </div>

                <textarea
                  placeholder="Notiz (optional)…"
                  value={meldungNotiz}
                  onChange={(e) => setMeldungNotiz(e.target.value)}
                  className="bg-[#F9F7F4] rounded-2xl p-4 w-full outline-none mb-4 min-h-[80px] resize-none"
                />

                <button
                  onClick={handleSendMeldung}
                  disabled={!meldungTyp || meldungSending}
                  className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg active:scale-95 transition-all disabled:opacity-50"
                >
                  {meldungSending ? <RefreshCw className="animate-spin mx-auto" /> : 'Senden'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* LOHN: VORSCHAU/DOWNLOAD-AUSWAHL */}
      {activeModal === 'lohn-choice' && selectedLohn && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
          <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left">
            <button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
            <h3 className="text-xl font-black mb-6 pr-10 flex items-center gap-3"><Euro className="text-[#dccfbc]"/> {formatMonat(selectedLohn.zeitraum)}</h3>
            <div className="space-y-4">
              <button onClick={() => { window.open(selectedLohn.url, '_blank'); setActiveModal(null); }} className="w-full bg-[#F9F7F4] text-[#b5a48b] py-5 rounded-2xl font-black uppercase flex items-center justify-center gap-2 active:scale-95 transition-all">
                <Eye size={18}/> Vorschau
              </button>
              <button onClick={() => handleLohnDownload(selectedLohn)} disabled={lohnDownloading} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all">
                {lohnDownloading ? <RefreshCw className="animate-spin" size={18}/> : <Download size={18}/>} Herunterladen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    );
  }


  if (!patientId || !token) return (
    <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6">

        {/* AUSWAHL-SCREEN */}
        {loginMode === 'select' && (
          <div className="bg-white p-8 rounded-[3rem] shadow-xl w-full max-w-sm animate-in fade-in">
            <img src="/logo.png" alt="Logo" className="w-48 mx-auto mb-8" />
            <h2 className="text-center text-lg font-black mb-2 text-[#3A3A3A]">Willkommen</h2>
            <p className="text-center text-xs text-gray-400 mb-8">Wer möchte sich anmelden?</p>

            <button
              onClick={() => setLoginMode('patient')}
              className="w-full bg-[#b5a48b] text-white py-6 rounded-2xl font-black uppercase shadow-lg active:scale-95 transition-all mb-4 flex items-center justify-center gap-3"
            >
              <User size={20} /> Ich bin Klient
            </button>

            <button
              onClick={() => setLoginMode('mitarbeiter')}
              className="w-full bg-white border-2 border-[#b5a48b] text-[#b5a48b] py-6 rounded-2xl font-black uppercase active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              <FileCheck size={20} /> Ich bin Mitarbeiter
            </button>
          </div>
        )}

        {/* LOGIN-FORMULAR (Patient ODER Mitarbeiter) */}
        {loginMode !== 'select' && (
          <form onSubmit={loginMode === 'mitarbeiter' ? handleMitarbeiterLogin : handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl w-full max-w-sm animate-in slide-in-from-right">

            <button
              type="button"
              onClick={() => { setLoginMode('select'); setLoginError(null); setFullName(''); setLoginCode(''); }}
              className="text-[10px] font-black uppercase text-gray-400 mb-4 flex items-center gap-1 hover:text-[#b5a48b] transition-colors"
            >
              <ChevronRight size={12} className="rotate-180" /> Zurück
            </button>

            <img src="/logo.png" alt="Logo" className="w-48 mx-auto mb-4" />

            <p className="text-center text-[10px] font-black uppercase tracking-widest text-[#b5a48b] mb-6">
              {loginMode === 'patient' ? 'Klienten-Login' : 'Mitarbeiter-Login'}
            </p>

            <input type="text" inputMode="numeric" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4 outline-none" placeholder={loginMode === 'patient' ? 'Klienten-ID' : 'Mitarbeiter-ID'} required />
            <input type="password" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4 outline-none" placeholder="PIN" required />

            {loginError && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2 animate-pulse">
                    <AlertTriangle size={16}/> {loginError}
                </div>
            )}

            <button type="submit" disabled={isLoggingIn} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold uppercase shadow-lg active:scale-95 transition-all disabled:opacity-50">
                {isLoggingIn ? <RefreshCw className="animate-spin mx-auto"/> : 'Anmelden'}
            </button>

            <button
              type="button"
              onClick={() => { setLoginMode(loginMode === 'patient' ? 'mitarbeiter' : 'patient'); setLoginError(null); setFullName(''); setLoginCode(''); }}
              className="w-full text-center text-[10px] font-black uppercase tracking-widest text-[#b5a48b] mt-4 hover:opacity-70 transition-opacity"
            >
              {loginMode === 'patient' ? 'Als Mitarbeiter anmelden' : 'Als Klient anmelden'}
            </button>
          </form>
        )}
    </div>
  );

  const openTasksCount = tasks.filter(t => !t.done).length;
  // Bestätigte Originale ausblenden - sichtbar bleibt nur die unterschriebene Version
  const sichtbareDokumente = documents.filter(d =>
    !(unbox(d.Richtung) === 'Vom Pflegedienst' && unbox(d.Vom_Patienten_Bestaetigt_Am))
  );
  // Berechne ungelesene Dokumente (serverbasiert, geräteübergreifend) - einheitliche Definition
  const unseenDocs = sichtbareDokumente.filter(d =>
    (unbox(getValue(d, 'Typ')) === 'Rechnung' || unbox(getValue(d, 'Typ')) === 'Leistungsnachweis') &&
    unbox(getValue(d, 'Richtung')) === 'Vom Pflegedienst' &&
    !unbox(getValue(d, 'Vom_Patienten_Gesehen'))
  );
  const unseenDocsCount = unseenDocs.length;
  const unseenDocIds = unseenDocs.map(d => d.id);
  
  // Zähler pro Kategorie
  const unseenRechnungen = unseenDocs.filter(d => unbox(d.Typ) === 'Rechnung').length;
  const unseenNachweise = unseenDocs.filter(d => unbox(d.Typ) === 'Leistungsnachweis').length;

  const today = new Date();
  today.setHours(0,0,0,0);
  
  const upcomingBesuche = besuche.filter(b => {
      const status = getValue(b, 'Status');
      const zeitVal = getValue(b, 'Uhrzeit'); 
      if (status === 'Anfrage' || status === 'Änderungswunsch') return true;
      if (!zeitVal) return false;
      return new Date(zeitVal) >= today;
  });

  const pastBesuche = besuche.filter(b => {
      const status = getValue(b, 'Status');
      const zeitVal = getValue(b, 'Uhrzeit'); 
      if (status === 'Anfrage' || status === 'Änderungswunsch') return false; 
      if (!zeitVal) return false;
      return new Date(zeitVal) < today;
  });

  const renderDashboard = () => (
    <div className="space-y-8 animate-in fade-in">
        {patientPushStatus === 'idle' && (
            <div className="bg-[#F9F7F4] rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <Bell size={18} className="text-[#b5a48b] shrink-0" />
                    <span className="text-sm font-bold text-[#6b5f4e]">Aktivieren Sie Benachrichtigungen, um nichts zu verpassen</span>
                </div>
                <button onClick={aktivierePush} className="bg-[#b5a48b] text-white px-4 py-2 rounded-xl font-black text-xs uppercase shrink-0 active:scale-95 transition-all">Aktivieren</button>
            </div>
        )}
        {patientPushStatus === 'denied' && (
            <div className="bg-[#FAECE7] rounded-2xl p-4 flex items-center gap-2">
                <Bell size={18} className="text-[#993C1D] shrink-0" />
                <span className="text-sm font-bold text-[#993C1D]">
                    {isIOS
                        ? 'Benachrichtigungen sind blockiert. Bitte in den iPhone-Einstellungen unter "Wunschlos" > Mitteilungen erlauben.'
                        : 'Benachrichtigungen sind blockiert. Bitte in den Browser-Einstellungen für diese Website erlauben.'}
                </span>
            </div>
        )}
        {patientPushStatus === 'install' && (
            <div className="bg-[#F9F7F4] rounded-2xl p-4 flex items-center gap-2">
                <Bell size={18} className="text-[#b5a48b] shrink-0" />
                <span className="text-sm font-bold text-[#6b5f4e]">Für Benachrichtigungen: App über das Teilen-Symbol zum Home-Bildschirm hinzufügen und dort öffnen.</span>
            </div>
        )}
        <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center">
            <div>
                <p className="text-[10px] uppercase font-bold opacity-80 mb-1 tracking-widest">Status</p>
                <h2 className="text-3xl font-black">{getValue(patientData, 'Pflegegrad')}</h2>
            </div>
            <CalendarIcon size={28}/>
        </div>
        
        <section className="space-y-4">
            <div className="flex justify-between items-center border-l-4 border-[#dccfbc] pl-4">
                <h3 className="font-black text-lg uppercase tracking-widest text-[10px] text-gray-400">Aufgaben ({openTasksCount} offen)</h3>
            </div>
            <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 space-y-3">
                {tasks.length > 0 ? tasks.slice(0,5).map((t) => (
                    <button key={t.id} onClick={() => toggleTask(t.id, t.done)} className="w-full flex items-center gap-3 text-left active:opacity-70 transition-opacity group">
                        {t.done ? <CheckCircle2 size={24} className="text-[#dccfbc] shrink-0" /> : <Circle size={24} className="text-gray-200 shrink-0 group-hover:text-[#b5a48b]" />}
                        <span className={`text-sm ${t.done ? 'text-gray-300 line-through' : 'font-bold text-gray-700'}`}>{t.text}</span>
                    </button>
                )) : <p className="text-center text-gray-300 py-4 italic text-xs">Keine Aufgaben aktuell.</p>}
                {tasks.length > 5 && (
                    <button onClick={() => setShowAllTasks(!showAllTasks)} className="w-full text-center text-[10px] font-black uppercase text-[#b5a48b] pt-2 border-t mt-2 flex items-center justify-center gap-1">
                        {showAllTasks ? <><ChevronUp size={12}/> Weniger anzeigen</> : <><ChevronDown size={12}/> {tasks.length-5} weitere anzeigen</>}
                    </button>
                )}
            </div>
        </section>

        <section className="space-y-6">
            <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Stammdaten</h3>
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-4 text-sm">
                <div className="flex justify-between border-b pb-2"><span>Geburtsdatum</span><span className="font-bold">{formatDateLong(getValue(patientData, 'Geburtsdatum'))}</span></div>
                <div className="flex justify-between border-b pb-2"><span>Versicherung</span><span className="font-bold">{getValue(patientData, 'Versicherung')}</span></div>
                <div><p className="text-gray-400">Anschrift</p><p className="font-bold text-[#3A3A3A]">{getValue(patientData, 'Anschrift')}</p></div>
            </div>
        </section>

        <section className="space-y-6">
            <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Kontakte</h3>
            <div className="space-y-3">
                {contactData.map((c: any, i: number) => { 
                    return (
                        <div key={i} className="bg-white rounded-[2rem] p-4 flex items-center justify-between shadow-sm border border-gray-100">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-[#F9F7F4] rounded-2xl flex items-center justify-center font-black text-[#dccfbc] text-lg">{unbox(getValue(c, 'Name') || "?")[0]}</div>
                                <div className="text-left"><p className="font-black text-lg leading-tight">{getValue(c, 'Name')}</p><p className="text-[10px] font-bold text-gray-400 uppercase">{getValue(c, 'Rolle/Funktion')}</p></div>
                            </div>
                            {getValue(c, 'Telefon') && <a href={`tel:${getValue(c, 'Telefon')}`} className="bg-[#dccfbc]/10 p-3 rounded-full text-[#b5a48b]"><Phone size={20} fill="#b5a48b" /></a>}
                        </div>
                    );
                })}
            </div>
        </section>

        {patientPushStatus === 'granted' && (
            <div className="bg-[#EEF6EE] rounded-2xl p-4 flex items-center gap-2">
                <Check size={18} className="text-[#5B9E5B] shrink-0" strokeWidth={3} />
                <span className="text-sm font-bold text-[#3f7a3f]">Benachrichtigungen sind aktiviert</span>
            </div>
        )}
    </div>
  );

  const renderPlaner = () => (
    <div className="space-y-6 animate-in fade-in pb-12">
        <div className="text-center mb-6">
            <div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><CalendarDays size={32} className="text-[#b5a48b]" /></div>
            <h2 className="text-3xl font-black">Besuchs-Planer</h2>
            <p className="text-xs text-gray-400 mt-2 px-6">Ihre kommenden Termine & Einsätze.</p>
        </div>
        
        <div className="flex justify-center">
            <button onClick={() => setActiveModal('new-appointment')} className="bg-white py-3 px-6 rounded-full shadow-sm border border-[#F9F7F4] flex items-center gap-2 text-[#b5a48b] font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all">
                <PlusCircle size={16} /> Termin anfragen
            </button>
        </div>
        
        {upcomingBesuche.map((b, i) => {
            const proposed = getProposedDetails(b);
            const showTime = getValue(b, 'Uhrzeit') ? formatTime(getValue(b, 'Uhrzeit')) : (proposed ? proposed.time : "--:--");
            const showDate = getValue(b, 'Uhrzeit') ? formatDate(getValue(b, 'Uhrzeit')) : (proposed ? proposed.date : "-");
            const isProposed = !getValue(b, 'Uhrzeit') && proposed;
            const isHighlighted = highlightedIds.includes(b.id);
            const showDauer = formatDauer(getValue(b, 'Dauer'));

            return (
              <div key={b.id} className={`bg-white rounded-[2rem] shadow-sm border text-left overflow-hidden transition-all duration-700 ${isHighlighted ? 'border-[#b5a48b] ring-4 ring-[#b5a48b] ring-opacity-30 bg-[#FFFBEB] scale-105' : 'border-gray-100'}`}>
                <div className="p-6 flex items-center gap-6">
                    <div className="text-center min-w-[60px]">
                        <p className={`text-xl font-bold ${isProposed ? 'text-gray-400 italic' : 'text-gray-300'}`}>{showTime}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">UHR</p>
                    </div>
                    <div className="flex-1 border-l border-gray-100 pl-5 text-left">
                        <p className="font-black text-[#3A3A3A] text-lg mb-2">{getDisplayTitle(b)}</p>
                        <div className="flex items-center gap-2"><User size={12} className="text-gray-400"/><p className="text-sm text-gray-500">{getValue(b, 'Pfleger_Name') || "Zuweisung folgt"}</p></div>
                        <p className={`text-[10px] mt-3 font-bold uppercase tracking-wider text-left ${isProposed ? 'text-gray-400 italic' : 'text-[#b5a48b]'}`}>Am {showDate}</p>
                    </div>
                    {showDauer && (
                        <div className="text-center min-w-[56px]">
                            <p className="text-xl text-gray-300">{showDauer}</p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase">DAUER</p>
                        </div>
                    )}
                </div>
                {confirmedTermine.includes(b.id) || getValue(b, 'Status') === "Bestätigt" ? (
                    <div className="bg-[#e6f4ea] text-[#1e4620] py-4 text-center font-black uppercase text-xs flex items-center justify-center gap-2 animate-in slide-in-from-bottom-2"><Check size={16} strokeWidth={3}/> Termin angenommen</div>
                ) : pendingChanges.includes(b.id) || getValue(b, 'Status') === "Änderungswunsch" || getValue(b, 'Status') === "Anfrage" ? (
                    <div className="bg-[#fff7ed] text-[#c2410c] py-4 text-center font-black uppercase text-xs flex items-center justify-center gap-2 animate-in slide-in-from-bottom-2"><AlertCircle size={16} strokeWidth={3}/> Warten auf Rückmeldung</div>
                ) : editingTermin === b.id ? (
                    <div className="bg-[#fdfcfb] border-t p-4 animate-in slide-in-from-bottom-2">
                        <p className="text-[10px] font-black uppercase text-[#b5a48b] mb-2">Neuen Wunschtermin wählen:</p>
                        <div className="flex gap-2 mb-2">
                            <input type="date" value={newTerminDate} onChange={(e)=>setNewTerminDate(e.target.value)} className="bg-white border rounded-xl p-2 flex-1 text-sm outline-none min-w-0" style={{ colorScheme: 'light' }} />
                            <input type="time" value={newTerminTime} onChange={(e)=>setNewTerminTime(e.target.value)} className="bg-white border rounded-xl p-2 w-24 text-sm outline-none" style={{ colorScheme: 'light' }} />
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => { setEditingTermin(null); setNewTerminTime(""); }} className="p-2 bg-gray-100 rounded-xl"><X size={18} className="text-gray-400"/></button>
                            <button onClick={() => handleTerminReschedule(b.id, unbox(getValue(b, 'Uhrzeit')))} className="px-4 py-2 bg-[#b5a48b] text-white rounded-xl font-bold text-xs uppercase flex-1">Senden</button>
                        </div>
                    </div>
                ) : (
                    <div className="flex border-t border-gray-100">
                        <button onClick={() => handleTerminConfirm(b.id)} className="flex-1 bg-[#e6f4ea] hover:bg-[#d1e7d8] text-[#1e4620] py-4 font-black uppercase text-[10px] tracking-wider transition-colors border-r border-white">Termin ok</button>
                        <button onClick={() => setEditingTermin(b.id)} className="flex-1 bg-[#fce8e6] hover:bg-[#fadbd8] text-[#8a1c14] py-4 font-black uppercase text-[10px] tracking-wider transition-colors">Termin ändern</button>
                    </div>
                )}
              </div>
            );
        })}

        {pastBesuche.length > 0 && (
            <div className="pt-8 text-center">
                <button onClick={() => setShowArchive(!showArchive)} className="text-[#b5a48b] font-black uppercase text-[10px] flex items-center justify-center gap-2 mx-auto active:opacity-50">
                    {showArchive ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} Vergangene Besuche ({pastBesuche.length})
                </button>
                {showArchive && (
                    <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-4">
                        {pastBesuche.slice().reverse().map((b, i) => (
                            <div key={b.id} className="bg-gray-50 rounded-[2rem] border border-gray-100 text-left overflow-hidden opacity-70 grayscale">
                                <div className="p-6 flex items-center gap-6">
                                    <div className="text-center min-w-[60px]"><p className="text-xl font-bold text-gray-400">{formatTime(getValue(b, 'Uhrzeit'))}</p></div>
                                    <div className="flex-1 border-l border-gray-200 pl-5 text-left"><p className="font-bold text-gray-500 text-lg mb-1">{getDisplayTitle(b)}</p><p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider text-left">War am {formatDate(getValue(b, 'Uhrzeit'))}</p></div><History size={20} className="text-gray-300 mr-2"/>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}
    </div>
  );

  const renderHochladen = () => {
    // FILTER: Nur Dokumente anzeigen, die zum aktuellen Context passen
    const filteredDocs = sichtbareDokumente.filter(d => unbox(d.Typ) === uploadContext);

    return (
        <div className="space-y-4 animate-in fade-in pb-12">
            <div className="text-center mb-6">
                <div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><Upload size={32} className="text-[#b5a48b]" /></div>
                <h2 className="text-3xl font-black">Dokumente</h2>
                <p className="text-xs text-gray-400 mt-2 px-6">Ihr Archiv & Upload für Nachweise.</p>
            </div>
            
            {/* BUTTONS MIT BADGES */}
            <div className="flex flex-col gap-4">
                <button onClick={() => { setUploadContext('Leistungsnachweis'); setActiveModal('folder'); }} className="bg-white rounded-[2.2rem] p-6 shadow-sm border border-gray-50 flex items-center gap-5 active:scale-95 transition-all text-left relative">
                    <div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b]"><FileCheck size={32} /></div>
                    <div className="flex-1"><h3 className="font-black">Leistungsnachweise</h3><p className="text-[10px] text-gray-400 uppercase">Archiv & Upload</p></div>
                    <ChevronRight className="text-gray-300" />
                    {unseenNachweise > 0 && (
                        <div className="absolute top-4 right-4 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                    )}
                </button>
                <button onClick={() => { setUploadContext('Rechnung'); setActiveModal('folder'); }} className="bg-white rounded-[2.2rem] p-6 shadow-sm border border-gray-50 flex items-center gap-5 active:scale-95 transition-all text-left relative">
                    <div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b]"><Euro size={32} /></div>
                    <div className="flex-1"><h3 className="font-black">Rechnungen</h3><p className="text-[10px] text-gray-400 uppercase">Archiv & Upload</p></div>
                    <ChevronRight className="text-gray-300" />
                    {unseenRechnungen > 0 && (
                        <div className="absolute top-4 right-4 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                    )}
                </button>
            </div>

            <div className="flex flex-col items-center gap-3 mt-4 scale-110 origin-top">
                <button onClick={() => setActiveModal('video')} className="flex items-center gap-2 bg-white px-6 py-3 rounded-full shadow-md border text-[#b5a48b] text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all">
                    <Play size={14} fill="#b5a48b" /> So funktioniert's
                </button>
                
                {/* KI-Assistent deaktiviert */}
                {false && (
                <div className="bg-[#dccfbc]/10 rounded-[1.5rem] p-5 text-center w-full max-w-xs">
                    <p className="text-[#b5a48b] text-xs">Fragen zu Ihren Dokumenten?</p>
                    <button onClick={()=>setActiveModal('ki-telefon')} className="mt-1 text-[#b5a48b] font-black uppercase text-xs underline">KI-Assistent fragen</button>
                </div>
                )}
            </div>

            <div className="mt-8 text-center border-t border-gray-100 pt-6">
                <button onClick={() => setActiveModal('revoke-consent')} className="text-red-400 text-[10px] font-bold uppercase hover:text-red-600 transition-colors">
                    ❌ Digitale Rechnungen deaktivieren
                </button>
            </div>
        </div>
    );
  };

  const renderUrlaub = () => (
    <div className="space-y-6 animate-in fade-in">
        <div className="text-center mb-6">
            <div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><Plane size={32} className="text-[#b5a48b]" /></div>
            <h2 className="text-3xl font-black">Urlaubsplanung</h2>
            <p className="text-xs text-gray-400 mt-2 px-6">Teilen Sie uns ihre Abwesenheiten mit.</p>
        </div>
        <div className="bg-white rounded-[3rem] p-8 shadow-xl border border-gray-100 space-y-6">
            <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-[#b5a48b]">Von wann</label>
                <div className="bg-[#F9F7F4] p-2 rounded-2xl flex items-center px-4"><CalendarIcon size={20} className="text-gray-400 mr-3"/><input type="date" value={urlaubStart} onChange={(e)=>setUrlaubStart(e.target.value)} className="bg-transparent w-full p-2 outline-none font-bold" style={{ colorScheme: 'light' }} /></div>
            </div>
            <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-[#b5a48b]">Bis wann</label>
                <div className="bg-[#F9F7F4] p-2 rounded-2xl flex items-center px-4"><CalendarIcon size={20} className="text-gray-400 mr-3"/><input type="date" value={urlaubEnde} onChange={(e)=>setUrlaubEnde(e.target.value)} className="bg-transparent w-full p-2 outline-none font-bold" style={{ colorScheme: 'light' }} /></div>
            </div>
            <button onClick={() => submitData('Urlaubsmeldung', `Urlaub von ${formatDate(urlaubStart)} bis ${formatDate(urlaubEnde)}`)} disabled={isSending || !urlaubStart || !urlaubEnde} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-3">
                {isSending ? <RefreshCw className="animate-spin" /> : <Send size={18} />} <span>{sentStatus === 'success' ? 'Eingetragen!' : 'Eintragen'}</span>
            </button>
        </div>
        <p className="text-[10px] text-gray-300 text-center px-10">Hinweis: Einsätze pausieren in diesem Zeitraum.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-white pb-32 text-left select-none font-sans text-[#3A3A3A]" onMouseMove={handleDrag} onTouchMove={handleDrag} onMouseUp={() => isDragging.current = false} onTouchEnd={() => isDragging.current = false}>
      
      {errorMsg && (
          <div className="fixed top-24 left-4 right-4 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-2xl relative flex items-center gap-3 animate-in slide-in-from-top shadow-lg">
              <AlertTriangle size={24} className="shrink-0"/>
              <div>
                  <strong className="font-bold">Verbindungsproblem</strong>
                  <span className="block text-xs mt-1">{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg(null)} className="absolute top-2 right-2"><X size={16}/></button>
          </div>
      )}

      {showUpdateBanner && (
          <button 
            onClick={handleBannerClick}
            className="fixed top-0 left-0 right-0 z-[100] bg-[#3A3A3A] text-white p-8 shadow-2xl flex flex-col items-center justify-center animate-in slide-in-from-top duration-500 w-full text-center cursor-pointer border-b-4 border-[#b5a48b]"
          >
              <div className="flex items-center gap-3 mb-2">
                  <div className="bg-white/20 p-3 rounded-full animate-bounce"><Bell size={32} /></div>
                  <span className="font-black text-xl uppercase tracking-wide">Neuer Hinweis für Sie</span>
              </div>
              <p className="text-base opacity-90 font-bold underline decoration-2 underline-offset-4 text-[#b5a48b]">Hier tippen zum Aktualisieren</p>
          </button>
      )}

      <header className={`py-4 px-6 bg-[#dccfbc] text-white flex justify-between items-center shadow-sm transition-all duration-300 ${showUpdateBanner ? 'mt-32' : ''}`}>
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11" />
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-3 mb-1.5">
             <button onClick={() => fetchData(true)} className={`bg-white/20 p-3 rounded-full ${loading ? 'animate-spin' : ''}`}><RefreshCw size={20}/></button>
             <button onClick={() => { localStorage.clear(); setPatientId(null); setToken(null); }} className="bg-white/20 p-3 rounded-full"><LogOut size={20}/></button>
          </div>
          <p className="text-xs font-bold italic">{getValue(patientData, 'Name')}</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 pt-6">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'planer' && renderPlaner()}
        {activeTab === 'hochladen' && renderHochladen()}
        {activeTab === 'urlaub' && renderUrlaub()}
      </main>
      
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 border-t flex justify-around p-5 pb-11 z-50 rounded-t-[3rem] shadow-2xl">{[ { id: 'dashboard', icon: LayoutDashboard, label: 'Home' }, { id: 'planer', icon: CalendarDays, label: 'Planer' }, { id: 'hochladen', icon: Upload, label: 'Upload' }, { id: 'urlaub', icon: Plane, label: 'Urlaub' } ].map((t) => (
        <button 
            key={t.id} 
            onClick={() => { setActiveTab(t.id); if (Date.now() - lastFetchTimeRef.current > 45000) fetchData(true); }}
            className={`flex flex-col items-center gap-1.5 transition-all relative ${activeTab === t.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}
        >
            <div className="relative">
                <t.icon size={22} strokeWidth={activeTab === t.id ? 3 : 2} />
                
                {/* ROTER PUNKT (Nur ungelesene) */}
                {t.id === 'hochladen' && unseenDocsCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-in zoom-in" />
                )}
            </div>
            <span className="text-[9px] font-black uppercase">{t.label}</span>
        </button>
      ))}</nav>
      
      {/* KI Button deaktiviert */}
      {false && (
      <button onMouseDown={() => isDragging.current = true} onTouchStart={() => isDragging.current = true} onClick={() => { if (!isDragging.current) setActiveModal('ki-telefon'); }} style={{ right: kiPos.x, bottom: kiPos.y, touchAction: 'none' }} className="fixed z-[60] w-20 h-20 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-2 border-white active:scale-90 transition-transform cursor-move"><Mic size={24} fill="white" /><span className="text-[9px] font-bold mt-0.5 leading-tight text-center">24h<br/>KI Hilfe</span></button>
      )}

      {activeModal && (<div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in"><div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
         {activeModal === 'video' && (<div className="bg-black w-full max-w-md h-[50vh] rounded-[2rem] overflow-hidden relative shadow-2xl animate-in zoom-in-95 flex items-center justify-center"><button onClick={()=>setActiveModal(null)} className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white"><X size={20}/></button><div className="text-white text-center"><PlayCircle size={64} className="opacity-20 mx-auto"/><p className="mt-4 font-bold text-xs uppercase tracking-widest">Video wird geladen...</p></div></div>)}
         
         {/* KI Modal deaktiviert */}
         {false && activeModal === 'ki-telefon' && (<div className="bg-white w-full max-w-md h-[85vh] rounded-[3rem] overflow-hidden relative animate-in slide-in-from-bottom-10"><iframe src="https://app.centrals.ai/centrals/embed/Pflegedienst" className="w-full h-full border-none" /><button onClick={()=>setActiveModal(null)} className="absolute top-6 right-6 bg-black/20 p-2 rounded-full text-white"><X/></button></div>)}

         {activeModal === 'new-appointment' && (<div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left"><button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button><div className="space-y-6"><h3 className="text-xl font-black flex items-center gap-3"><CalendarDays className="text-[#dccfbc]"/> Neuer Termin</h3><p className="text-xs text-gray-400">Schlagen Sie einen Tag vor. Wir bestätigen kurzfristig.</p><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Wunschdatum</label><input type="date" value={requestDate} onChange={(e)=>setRequestDate(e.target.value)} className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none font-bold" style={{ colorScheme: 'light' }} /></div><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Uhrzeit (Optional)</label><input type="time" value={requestTime} onChange={(e)=>setRequestTime(e.target.value)} className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none font-bold" style={{ colorScheme: 'light' }} /></div><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Grund (Tätigkeit)</label><input type="text" value={requestReason} onChange={(e)=>setRequestReason(e.target.value)} placeholder="z.B. Einkaufen, Arzt..." className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none text-sm" /></div><button onClick={handleNewTerminRequest} disabled={isSending || !requestDate} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2">{isSending ? <RefreshCw className="animate-spin" size={16}/> : <Send size={16} />} {sentStatus === 'success' ? 'Anfrage gesendet!' : 'Anfrage senden'}</button></div></div>)}
         
         {activeModal === 'folder' && (
            <div className="bg-white w-full max-w-md max-h-[88vh] rounded-t-[3rem] p-6 shadow-2xl relative animate-in slide-in-from-bottom-10 flex flex-col">
                <div className="shrink-0 flex justify-between items-center mb-5">
                    <h3 className="text-2xl font-black">{uploadContext}</h3>
                    <button onClick={()=>setActiveModal(null)} className="bg-gray-100 p-2 rounded-full"><X size={20}/></button>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 pr-1">
                    {uploadContext === 'Rechnung' ? (() => {
                        const rechnungen = sichtbareDokumente.filter(d => unbox(d.Typ) === 'Rechnung' && unbox(d.Richtung) === 'Vom Pflegedienst');
                        const offen = rechnungen.filter(d => !d.Bezahlt);
                        const bezahlt = rechnungen.filter(d => d.Bezahlt);
                        const RechnungCard = (doc: any, offenVariant: boolean) => (
                            <div key={doc.id} className={`rounded-2xl p-5 min-h-[88px] ${offenVariant
                                ? 'border-l-4 border-orange-400 bg-orange-50/40 border border-orange-100'
                                : 'bg-gray-50 border border-gray-100'}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <p className="text-lg font-bold text-[#3A3A3A] truncate min-w-0">{unbox(doc.Dateiname) || 'Rechnung'}</p>
                                    {offenVariant
                                        ? <span className="shrink-0 text-sm font-black uppercase text-orange-700 bg-orange-100 px-3 py-1 rounded-full">Offen</span>
                                        : <span className="shrink-0 text-sm font-black uppercase text-green-800 bg-green-100 px-3 py-1 rounded-full">Bezahlt</span>}
                                </div>
                                {doc.Datum && <p className="text-sm text-[#6b5f4e] mt-1">{formatDate(doc.Datum)}</p>}
                                <div className="flex gap-3 mt-4">
                                    <button onClick={() => { markAsSeen(doc.id); window.open(doc.Link, '_blank'); }} className="flex-1 min-h-[48px] py-4 rounded-2xl bg-[#F9F7F4] text-[#6b5f4e] font-bold text-base flex items-center justify-center gap-2 active:scale-95 transition-all"><Eye size={18}/> Vorschau</button>
                                    <button onClick={() => { markAsSeen(doc.id); downloadRechnung({ url: doc.Link, dateiname: unbox(doc.Dateiname) }); }} className="flex-1 min-h-[48px] py-4 rounded-2xl bg-[#b5a48b] text-white font-bold text-base flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"><Download size={18}/> Herunterladen</button>
                                </div>
                            </div>
                        );
                        return (
                            <div className="space-y-6">
                                {offen.length > 0 && (
                                    <div>
                                        <p className="text-sm font-black uppercase text-orange-600 mb-3">Noch zu bezahlen ({offen.length})</p>
                                        <div className="space-y-4">{offen.map(d => RechnungCard(d, true))}</div>
                                    </div>
                                )}
                                {bezahlt.length > 0 && (
                                    <div>
                                        <p className="text-sm font-black uppercase text-gray-400 mb-3">Archiv ({bezahlt.length})</p>
                                        <div className="space-y-4">{bezahlt.map(d => RechnungCard(d, false))}</div>
                                    </div>
                                )}
                                {rechnungen.length === 0 && (
                                    <div className="bg-gray-50 p-5 rounded-2xl flex items-center gap-4 opacity-60">
                                        <Euro className="text-gray-300"/>
                                        <p className="text-base font-bold text-gray-400">Noch keine Rechnungen</p>
                                    </div>
                                )}
                            </div>
                        );
                    })() : sichtbareDokumente.filter(d => unbox(d.Typ) === uploadContext).length > 0 ? (
                        <div className="space-y-4">
                            {sichtbareDokumente.filter(d => unbox(d.Typ) === uploadContext).map(doc => {
                                const isUnseen = unseenDocIds.includes(doc.id);
                                const istUnterschrieben = (unbox(doc.Dateiname) || '').startsWith('Unterschrieben_');
                                const kannUnterschreiben = unbox(doc.Typ) === 'Leistungsnachweis' && unbox(doc.Richtung) === 'Vom Pflegedienst' && !doc.Vom_Patienten_Bestaetigt_Am;
                                return (
                                <div
                                    key={doc.id}
                                    className={`relative rounded-2xl p-5 min-h-[88px] border ${isUnseen ? 'border-[#b5a48b] bg-[#FFFBEB]' : 'border-gray-100 bg-white'}`}
                                >
                                    {isUnseen && <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full -mt-1 -mr-1 shadow-sm" />}
                                    <div className="flex items-start gap-3">
                                        <div className={`p-3 rounded-full shrink-0 ${isUnseen ? 'bg-[#b5a48b] text-white' : 'bg-[#dccfbc]/20 text-[#b5a48b]'}`}>
                                            <FileText size={22}/>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-lg font-bold text-[#3A3A3A] flex items-center gap-2">
                                                <span className="truncate min-w-0">{unbox(doc.Dateiname) || "Dokument"}</span>
                                                {isUnseen && (
                                                    <span className="inline-flex items-center gap-1 text-red-600 text-sm font-black uppercase shrink-0">
                                                        <span className="w-2 h-2 bg-red-500 rounded-full" /> Neu
                                                    </span>
                                                )}
                                            </p>
                                            {istUnterschrieben && (
                                                <p className="text-sm text-green-700 font-bold flex items-center gap-1 mt-1">
                                                    <Check size={16}/> Unterschrieben
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-3 mt-4">
                                        <button onClick={() => { markAsSeen(doc.id); window.open(doc.Link, '_blank'); }} className="flex-1 min-h-[48px] py-4 rounded-2xl bg-[#F9F7F4] text-[#6b5f4e] font-bold text-base flex items-center justify-center gap-2 active:scale-95 transition-all"><Eye size={18}/> Öffnen</button>
                                        {kannUnterschreiben && (
                                            <button onClick={() => { markAsSeen(doc.id); openSignModal(doc); }} className="flex-1 min-h-[48px] py-4 rounded-2xl bg-[#b5a48b] text-white font-bold text-base flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"><PenLine size={18}/> Unterschreiben</button>
                                        )}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="bg-gray-50 p-5 rounded-2xl flex items-center gap-4 opacity-60">
                            <FileText className="text-gray-300"/>
                            <p className="text-base font-bold text-gray-400">Noch keine Dokumente</p>
                        </div>
                    )}

                    {/* Upload dezent, unter der Liste (nur falls der Patient selbst etwas einreicht) */}
                    <div className="mt-8 flex flex-col items-center">
                        <button onClick={() => setActiveModal('upload')} className="flex items-center gap-2 text-sm text-[#b5a48b] border border-[#e0dccf] px-4 py-2 rounded-full active:scale-95 transition-all">
                            <Plus size={16}/> Eigenes Dokument hochladen
                        </button>
                        <p className="text-xs text-gray-400 mt-2 text-center">Nur nötig, falls Sie selbst etwas einreichen möchten.</p>
                    </div>
                </div>
            </div>
         )}

         {activeModal === 'sign' && signDoc && (() => {
            const istZweiSchritt = unbox(signDoc.Typ) === 'Leistungsnachweis';
            const sigVorhanden = signaturStep === 1 ? !!sigKlient : !!sigBestaetigung;
            return (
            <div className="bg-white w-full max-w-2xl max-h-[95vh] rounded-t-[3rem] p-6 shadow-2xl relative animate-in slide-in-from-bottom-10 flex flex-col">
                <button onClick={closeSignModal} className="absolute top-5 right-5 p-2 bg-gray-100 rounded-full z-10"><X size={20}/></button>
                <div className="shrink-0">
                    {istZweiSchritt && <p className="text-[10px] font-black uppercase text-[#b5a48b]">Schritt {signaturStep} von 2</p>}
                    <h3 className="text-xl font-black mb-1 pr-10">{signaturStep === 1 ? 'Unterschrift des Klienten' : 'Bestätigung der erbrachten Leistungen'}</h3>
                    <p className="text-xs text-gray-400 mb-3 flex items-center gap-2">
                        {unbox(signDoc.Dateiname) || "Dokument"}
                        <a href={signDoc.Link} target="_blank" rel="noreferrer" className="text-[#b5a48b] font-black uppercase inline-flex items-center gap-1"><ExternalLink size={10}/> Ansehen</a>
                    </p>
                </div>

                <div className="flex-1 min-h-0 flex flex-col justify-center">
                    {!isLandscape ? (
                        <div className="bg-[#FAF3E9] rounded-2xl p-8 text-center">
                            <RotateCcw size={40} className="text-[#b5a48b] mx-auto mb-3" />
                            <p className="font-bold text-[#6b5f4e]">Bitte drehen Sie Ihr Gerät ins Querformat zum Unterschreiben.</p>
                        </div>
                    ) : signaturStep === 1 ? (
                        <SignaturePad key="klient" onChange={setSigKlient} clearRef={sigClearRef} />
                    ) : (
                        <SignaturePad key="bestaetigung" onChange={setSigBestaetigung} clearRef={sigClearRef} />
                    )}
                    {isLandscape && !sigVorhanden && (
                        <p className="text-[11px] text-gray-400 text-center mt-2 shrink-0">Bitte zuerst unterschreiben.</p>
                    )}
                </div>

                <div className="flex gap-3 mt-4 shrink-0">
                    {isLandscape && (
                        <button onClick={() => sigClearRef.current && sigClearRef.current()} className="flex-1 bg-[#F9F7F4] text-[#b5a48b] py-4 rounded-2xl font-black uppercase">Löschen</button>
                    )}
                    {signaturStep === 2 && (
                        <button onClick={() => setSignaturStep(1)} className="flex-1 bg-[#F9F7F4] text-[#b5a48b] py-4 rounded-2xl font-black uppercase">Zurück</button>
                    )}
                    {istZweiSchritt && signaturStep === 1 ? (
                        <button disabled={!sigKlient} onClick={() => setSignaturStep(2)} className="flex-1 bg-[#b5a48b] text-white py-4 rounded-2xl font-black uppercase disabled:opacity-40 active:scale-95 transition-all">Weiter</button>
                    ) : (
                        <button disabled={!sigVorhanden || isSigning} onClick={handleSignSubmit} className="flex-1 bg-[#b5a48b] text-white py-4 rounded-2xl font-black uppercase disabled:opacity-40 flex items-center justify-center gap-2 active:scale-95 transition-all">
                            {isSigning ? <RefreshCw className="animate-spin" size={18}/> : 'Bestätigen & Absenden'}
                        </button>
                    )}
                </div>
            </div>
            );
         })()}

         {activeModal === 'revoke-consent' && (
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left border-t-4 border-red-400">
                <button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
                <div className="space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="bg-red-100 p-3 rounded-full text-red-500"><AlertTriangle size={32}/></div>
                        <h3 className="text-xl font-black text-gray-800">Wirklich deaktivieren?</h3>
                    </div>
                    
                    <div className="bg-gray-50 p-4 rounded-2xl text-sm text-gray-600 space-y-2">
                        <p>Wenn Sie die digitale Rechnungsstellung deaktivieren:</p>
                        <ul className="list-disc ml-4 space-y-1">
                            <li>Erhalten Sie Rechnungen zukünftig wieder <strong>per Post</strong>.</li>
                            <li>Dauert der Versand länger.</li>
                            <li>Verlieren Sie den digitalen Zugriff hier in der App für neue Dokumente.</li>
                        </ul>
                        <p className="text-xs text-gray-400 mt-2">Bereits erhaltene Dokumente bleiben sichtbar.</p>
                    </div>

                    <button onClick={handleRevokeConsent} disabled={isSending} className="w-full bg-red-500 text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2 hover:bg-red-600 transition-colors">
                        {isSending ? <RefreshCw className="animate-spin" size={16}/> : 'Ja, widerrufen'}
                    </button>
                    <button onClick={() => setActiveModal(null)} className="w-full text-gray-400 font-bold uppercase text-xs">Abbrechen</button>
                </div>
            </div>
         )}

         {activeModal === 'lohn-choice' && selectedLohn && (
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left">
                <button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
                <div className="space-y-6">
                    <h3 className="text-xl font-black flex items-center gap-3"><Euro className="text-[#dccfbc]"/> {formatMonat(selectedLohn.zeitraum)}</h3>
                    <button onClick={() => { window.open(selectedLohn.url, '_blank'); setActiveModal(null); }} className="w-full bg-[#F9F7F4] text-[#3A3A3A] py-5 rounded-2xl font-black uppercase shadow-sm flex justify-center items-center gap-2 active:scale-95 transition-all">
                        <Eye size={18}/> Vorschau
                    </button>
                    <button onClick={() => handleLohnDownload(selectedLohn)} disabled={lohnDownloading} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2 disabled:opacity-50 active:scale-95 transition-all">
                        {lohnDownloading ? <RefreshCw className="animate-spin" size={18}/> : <Download size={18}/>} Herunterladen
                    </button>
                </div>
            </div>
         )}

         {activeModal === 'upload' && (<div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left"><button onClick={() => setActiveModal('folder')} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button><div className="space-y-6"><h3 className="text-xl font-black flex items-center gap-3">{uploadContext === 'Rechnung' ? <Euro className="text-[#dccfbc]"/> : <FileText className="text-[#dccfbc]"/>} Hochladen</h3><div className="border-2 border-dashed border-[#dccfbc] rounded-[2rem] p-8 text-center bg-[#F9F7F4] relative"><input type="file" multiple accept="image/*,.pdf" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} className="absolute inset-0 opacity-0 cursor-pointer" /><Upload className="mx-auto text-[#dccfbc] mb-2" size={32}/><p className="text-xs font-black text-[#b5a48b] uppercase tracking-widest">{selectedFiles.length > 0 ? `${selectedFiles.length} ausgewählt` : "Datei auswählen"}</p></div><button onClick={() => submitData(uploadContext + '-Upload', 'Dokument')} disabled={isSending || selectedFiles.length === 0} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2">{isSending && <RefreshCw className="animate-spin" size={16}/>}{sentStatus === 'success' ? 'Erfolgreich!' : 'Absenden'}</button></div></div>)}
      </div>)}
    </div>
  );
}
// Vercel Force Update Fix
