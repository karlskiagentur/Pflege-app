<<<<<<< HEAD
[B[B git add src/App.tsx
git add src/App.tsx
=======
Hier ist **Version 77.0**.

Ich habe die Fehlermeldung angepasst und den Code vollständig geprüft. Er enthält alle Funktionen (Badges, optionaler Haken, Widerruf, etc.) und ist bereit zum Kopieren.

```tsx
import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, Phone, User, RefreshCw, FileText, 
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, 
  ChevronRight, Send, Euro, FileCheck, PlayCircle, Plane, Play, Plus,
  CheckCircle2, Circle, ChevronDown, ChevronUp, Check, PlusCircle, AlertCircle, History, Bell, AlertTriangle, ExternalLink
} from 'lucide-react';

// Deine n8n Live-URL
const N8N_BASE_URL = 'https://karlskiagentur.app.n8n.cloud/webhook';
const AGGREGATOR_ENDPOINT = 'get_full_app_data'; 

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
  const [fullName, setFullName] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null); 
  
  const [consentGiven, setConsentGiven] = useState(false);
  const [showConsentInfo, setShowConsentInfo] = useState(false);

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
  const [activeModal, setActiveModal] = useState<'folder' | 'upload' | 'video' | 'ki-telefon' | 'new-appointment' | 'revoke-consent' | null>(null);
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
    const id = patientId || localStorage.getItem('active_patient_id');
    if (!id || id === "null") return;

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
        const response = await fetch(`${N8N_BASE_URL}/${AGGREGATOR_ENDPOINT}?patientId=${id}`, { 
            signal: controller.signal 
        });
        
        if (!response.ok) throw new Error(`Server Fehler: ${response.status}`);
        
        let json = await response.json();
        
        if (Array.isArray(json) && json.length > 0) {
            json = json[0];
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
                Link: getFileUrl(d, 'Datei') 
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
                sortedBesuche.forEach(newItem => {
                    const oldItem = besucheRef.current.find(old => old.id === newItem.id);
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

  // Dokument als gelesen markieren
  const markAsSeen = (id: string) => {
      if (!seenDocIds.includes(id)) {
          const newSeen = [...seenDocIds, id];
          setSeenDocIds(newSeen);
          localStorage.setItem('seen_docs', JSON.stringify(newSeen));
      }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setLoginError(null);

    setIsLoggingIn(true);
    try {
      const res = await fetch(`${N8N_BASE_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fullName, code: loginCode }) });
      const data = await res.json();
      if (data.status === "success" && data.patientId) {
        localStorage.setItem('active_patient_id', data.patientId); setPatientId(data.patientId);
      } else { 
          // HIER IST DIE GEWÜNSCHTE ÄNDERUNG
          setLoginError("Das eingegebene Passwort ist falsch"); 
      }
    } catch (e) { setLoginError("Verbindungsfehler beim Login."); } finally { setIsLoggingIn(false); }
  };

  const handleRevokeConsent = async () => {
    setIsSending(true);
    try {
        const formData = new FormData();
        formData.append('patientId', patientId!);
        formData.append('patientName', getValue(patientData, 'Name'));
        formData.append('typ', 'Widerruf_Digitale_Rechnung'); 
        formData.append('nachricht', 'Der Patient hat die Einwilligung für digitale Rechnungen widerrufen.');
        await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        setSentStatus('success');
        setTimeout(() => { 
            setActiveModal(null); 
            setSentStatus('idle'); 
            alert("Einstellung gespeichert. Sie erhalten Rechnungen zukünftig per Post.");
        }, 1500);
    } catch (e) {
        setSentStatus('error');
    }
    setIsSending(false);
  };

  const toggleTask = async (id: string, currentStatus: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !currentStatus } : t));
    try {
      await fetch(`${N8N_BASE_URL}/update_task`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: id, done: !currentStatus }) });
    } catch (e) { console.error(e); }
  };

  const handleTerminConfirm = async (recordId: string) => {
    setConfirmedTermine([...confirmedTermine, recordId]); 
    try {
        const formData = new FormData();
        formData.append('patientId', patientId!);
        formData.append('typ', 'Termin_bestatigen');
        formData.append('recordId', recordId);
        await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        setTimeout(() => fetchData(true), 1500); 
    } catch(e) { console.error(e); }
  };

  const handleTerminReschedule = async (recordId: string, oldDateRaw: string) => {
    if(!newTerminDate) return;
    setIsSending(true);
    setPendingChanges([...pendingChanges, recordId]);
    setEditingTermin(null);
    try {
        const formData = new FormData();
        formData.append('patientId', patientId!);
        formData.append('typ', 'Terminverschiebung');
        formData.append('recordId', recordId);
        let nachricht = `Verschiebung gewünscht von ${formatDate(oldDateRaw)} auf ${formatDate(newTerminDate)}`;
        if (newTerminTime) nachricht += ` um ca. ${newTerminTime} Uhr`;
        formData.append('nachricht', nachricht);
        await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        setNewTerminDate(""); setNewTerminTime(""); 
        setTimeout(() => fetchData(true), 1500);
    } catch(e) { console.error(e); }
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
        formData.append('patientId', patientId!);
        formData.append('patientName', getValue(patientData, 'Name'));
        formData.append('typ', 'Terminanfrage');
        formData.append('betreff', saveReason || "Terminanfrage");
        let note = `Wunschtermin: ${formatDate(saveDate)}`;
        if (saveTime) note += ` um ${saveTime} Uhr`;
        formData.append('nachricht', note);
        await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        setTimeout(() => fetchData(true), 2000);
      } catch (e) { 
          setSentStatus('error');
          setBesuche(prev => prev.filter(b => b.id !== tempId));
      }
      setIsSending(false);
  };

  const submitData = async (type: string, payload: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('patientId', patientId!);
      formData.append('patientName', getValue(patientData, 'Name'));
      if (activeModal === 'upload' && selectedFiles.length > 0) {
          formData.append('typ', type.replace('-Upload', '')); formData.append('file', selectedFiles[0]); 
          await fetch(`${N8N_BASE_URL}/upload_document`, { method: 'POST', body: formData });
      } else {
          formData.append('typ', type); formData.append('nachricht', payload);
          await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
      }
      setSentStatus('success');
      setTimeout(() => { if (activeModal === 'upload') setActiveModal('folder'); else setActiveModal(null); setSentStatus('idle'); setUrlaubStart(""); setUrlaubEnde(""); setSelectedFiles([]); fetchData(true); }, 1500);
    } catch (e) { console.error(e); setSentStatus('error'); }
    setIsSending(false);
  };

  const handleBannerClick = () => {
      fetchData(true).then(() => setShowUpdateBanner(false));
  };

  // Login Screen
  if (!patientId) return (
    <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl w-full max-w-sm">
            <img src="/logo.png" alt="Logo" className="w-48 mx-auto mb-6" />
            <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4 outline-none" placeholder="Vollständiger Name" required />
            <input type="password" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4 outline-none" placeholder="Login-Code" required />
            
            <div className="mb-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className={`mt-1 w-5 h-5 rounded border flex items-center justify-center shrink-0 ${consentGiven ? 'bg-[#b5a48b] border-[#b5a48b]' : 'border-gray-300'}`}>
                        {consentGiven && <Check size={14} className="text-white" />}
                    </div>
                    <input type="checkbox" className="hidden" checked={consentGiven} onChange={(e) => setConsentGiven(e.target.checked)} />
                    <span className="text-xs text-gray-500 leading-tight select-none">
                        (Optional) Ich bin damit einverstanden, Rechnungen und Dokumente in elektronischer Form (PDF) zu erhalten.
                    </span>
                </label>
            </div>

            <div className="mb-6">
                <button type="button" onClick={() => setShowConsentInfo(!showConsentInfo)} className="text-[10px] font-bold text-[#b5a48b] flex items-center gap-1 uppercase tracking-wide">
                    {showConsentInfo ? <ChevronUp size={12}/> : <ChevronRight size={12}/>} 
                    🔎 Weitere Informationen
                </button>
                {showConsentInfo && (
                    <div className="mt-2 bg-gray-50 p-3 rounded-xl text-[10px] text-gray-500 space-y-2 animate-in slide-in-from-top-2">
                        <p>Ihre Rechnungen werden Ihnen auf Wunsch elektronisch bereitgestellt (eIDAS konform).</p>
                        <p>Sie können diese Einwilligung jederzeit widerrufen.</p>
                    </div>
                )}
            </div>

            {loginError && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2 animate-pulse">
                    <AlertTriangle size={16}/> {loginError}
                </div>
            )}

            <button type="submit" disabled={isLoggingIn} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold uppercase shadow-lg active:scale-95 transition-all disabled:opacity-50">
                {isLoggingIn ? <RefreshCw className="animate-spin mx-auto"/> : 'Anmelden'}
            </button>
        </form>
    </div>
  );

  const openTasksCount = tasks.filter(t => !t.done).length;
  // Berechne ungelesene Dokumente
  const unseenDocs = documents.filter(d => !seenDocIds.includes(d.id));
  const unseenDocsCount = unseenDocs.length;
  
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
    const filteredDocs = documents.filter(d => unbox(d.Typ) === uploadContext);

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
                <div className="bg-[#dccfbc]/10 rounded-[1.5rem] p-5 text-center w-full max-w-xs">
                    <p className="text-[#b5a48b] text-xs">Fragen zu Ihren Dokumenten?</p>
                    <button onClick={()=>setActiveModal('ki-telefon')} className="mt-1 text-[#b5a48b] font-black uppercase text-xs underline">KI-Assistent fragen</button>
                </div>
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
             <button onClick={() => { localStorage.clear(); setPatientId(null); }} className="bg-white/20 p-3 rounded-full"><LogOut size={20}/></button>
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
            onClick={() => setActiveTab(t.id)} 
            className={`flex flex-col items-center gap-1.5 transition-all relative ${activeTab === t.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}
        >
            <div className="relative">
                <t.icon size={22} strokeWidth={activeTab === t.id ? 3 : 2} />
                
                {/* INTELLIGENTER BADGE (Nur ungelesene) */}
                {t.id === 'hochladen' && unseenDocsCount > 0 && (
                    <div className="absolute -top-2 -right-3 bg-red-600 text-white text-[9px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white animate-in zoom-in">
                        {unseenDocsCount}
                    </div>
                )}
            </div>
            <span className="text-[9px] font-black uppercase">{t.label}</span>
        </button>
      ))}</nav>
      
      <button onMouseDown={() => isDragging.current = true} onTouchStart={() => isDragging.current = true} onClick={() => { if (!isDragging.current) setActiveModal('ki-telefon'); }} style={{ right: kiPos.x, bottom: kiPos.y, touchAction: 'none' }} className="fixed z-[60] w-20 h-20 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-2 border-white active:scale-90 transition-transform cursor-move"><Mic size={24} fill="white" /><span className="text-[9px] font-bold mt-0.5 leading-tight text-center">24h<br/>KI Hilfe</span></button>
      
      {activeModal && (<div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in"><div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
         {activeModal === 'video' && (<div className="bg-black w-full max-w-md h-[50vh] rounded-[2rem] overflow-hidden relative shadow-2xl animate-in zoom-in-95 flex items-center justify-center"><button onClick={()=>setActiveModal(null)} className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white"><X size={20}/></button><div className="text-white text-center"><PlayCircle size={64} className="opacity-20 mx-auto"/><p className="mt-4 font-bold text-xs uppercase tracking-widest">Video wird geladen...</p></div></div>)}
         {activeModal === 'ki-telefon' && (<div className="bg-white w-full max-w-md h-[85vh] rounded-[3rem] overflow-hidden relative animate-in slide-in-from-bottom-10"><iframe src="https://app.centrals.ai/centrals/embed/Pflegedienst" className="w-full h-full border-none" /><button onClick={()=>setActiveModal(null)} className="absolute top-6 right-6 bg-black/20 p-2 rounded-full text-white"><X/></button></div>)}
         {activeModal === 'new-appointment' && (<div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left"><button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button><div className="space-y-6"><h3 className="text-xl font-black flex items-center gap-3"><CalendarDays className="text-[#dccfbc]"/> Neuer Termin</h3><p className="text-xs text-gray-400">Schlagen Sie einen Tag vor. Wir bestätigen kurzfristig.</p><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Wunschdatum</label><input type="date" value={requestDate} onChange={(e)=>setRequestDate(e.target.value)} className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none font-bold" style={{ colorScheme: 'light' }} /></div><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Uhrzeit (Optional)</label><input type="time" value={requestTime} onChange={(e)=>setRequestTime(e.target.value)} className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none font-bold" style={{ colorScheme: 'light' }} /></div><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Grund (Tätigkeit)</label><input type="text" value={requestReason} onChange={(e)=>setRequestReason(e.target.value)} placeholder="z.B. Einkaufen, Arzt..." className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none text-sm" /></div><button onClick={handleNewTerminRequest} disabled={isSending || !requestDate} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2">{isSending ? <RefreshCw className="animate-spin" size={16}/> : <Send size={16} />} {sentStatus === 'success' ? 'Anfrage gesendet!' : 'Anfrage senden'}</button></div></div>)}
         
         {activeModal === 'folder' && (
            <div className="bg-white w-full max-w-md h-[80vh] rounded-t-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10">
                <div className="flex justify-between items-center mb-8">
                    <h3 className="text-2xl font-black">{uploadContext}</h3>
                    <button onClick={()=>setActiveModal(null)} className="bg-gray-100 p-2 rounded-full"><X size={20}/></button>
                </div>
                <button onClick={() => setActiveModal('upload')} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase flex items-center justify-center gap-2 mb-8 shadow-lg active:scale-95 transition-all">
                    <Plus size={20}/> Neu hochladen
                </button>
                
                <div className="space-y-4">
                    <p className="text-[10px] font-black text-gray-400 uppercase">Bisherige Dokumente</p>
                    {documents.filter(d => unbox(d.Typ) === uploadContext).length > 0 ? (
                        <div className="space-y-3">
                            {documents.filter(d => unbox(d.Typ) === uploadContext).map(doc => {
                                const isUnseen = !seenDocIds.includes(doc.id);
                                return (
                                <a 
                                    key={doc.id} 
                                    href={doc.Link} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    onClick={() => markAsSeen(doc.id)} 
                                    className={`bg-white border p-4 rounded-2xl flex items-center gap-4 hover:shadow-md transition-shadow group relative ${isUnseen ? 'border-[#b5a48b] bg-[#FFFBEB]' : 'border-gray-100'}`}
                                >
                                    {isUnseen && <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full -mt-1 -mr-1 shadow-sm" />}
                                    <div className={`p-3 rounded-full ${isUnseen ? 'bg-[#b5a48b] text-white' : 'bg-[#dccfbc]/10 text-[#b5a48b]'}`}>
                                        <FileText size={20}/>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm truncate ${isUnseen ? 'font-black text-black' : 'font-bold text-gray-700'}`}>{unbox(doc.Dateiname) || "Dokument"}</p>
                                        <p className="text-[10px] text-gray-400 uppercase flex items-center gap-1">
                                            Öffnen <ExternalLink size={10}/>
                                        </p>
                                    </div>
                                </a>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="bg-gray-50 p-4 rounded-2xl flex items-center gap-4 opacity-50">
                            <FileText className="text-gray-300"/>
                            <p className="text-sm font-bold text-gray-400">Archiv ist leer</p>
                        </div>
                    )}
                </div>
            </div>
         )}

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

         {activeModal === 'upload' && (<div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left"><button onClick={() => setActiveModal('folder')} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button><div className="space-y-6"><h3 className="text-xl font-black flex items-center gap-3">{uploadContext === 'Rechnung' ? <Euro className="text-[#dccfbc]"/> : <FileText className="text-[#dccfbc]"/>} Hochladen</h3><div className="border-2 border-dashed border-[#dccfbc] rounded-[2rem] p-8 text-center bg-[#F9F7F4] relative"><input type="file" multiple accept="image/*,.pdf" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} className="absolute inset-0 opacity-0 cursor-pointer" /><Upload className="mx-auto text-[#dccfbc] mb-2" size={32}/><p className="text-xs font-black text-[#b5a48b] uppercase tracking-widest">{selectedFiles.length > 0 ? `${selectedFiles.length} ausgewählt` : "Datei auswählen"}</p></div><button onClick={() => submitData(uploadContext + '-Upload', 'Dokument')} disabled={isSending || selectedFiles.length === 0} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2">{isSending && <RefreshCw className="animate-spin" size={16}/>}{sentStatus === 'success' ? 'Erfolgreich!' : 'Absenden'}</button></div></div>)}
      </div>)}
    </div>
  );
}

```
>>>>>>> a289283f2ed0696d05313741edca0ebe9930cc2d
