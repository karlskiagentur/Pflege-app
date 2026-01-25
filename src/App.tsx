import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, Phone, User, RefreshCw, FileText, 
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, 
  ChevronRight, Send, Euro, FileCheck, PlayCircle, Plane, Play, Plus,
  CheckCircle2, Circle, ChevronDown, ChevronUp, Check, PlusCircle, Clock, AlertCircle
} from 'lucide-react';

// Deine n8n Live-URL
const N8N_BASE_URL = 'https://karlskiagentur.app.n8n.cloud/webhook';

// --- HELFER-FUNKTIONEN ---
const unbox = (val: any): string => {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) return unbox(val[0]);
  return String(val);
};

const formatDate = (raw: any, short = false) => {
  const val = unbox(raw);
  if (!val || val === "-") return "-";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    if (short) { 
      const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; 
      return days[d.getDay()]; 
    }
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${d.getFullYear()}`;
  } catch { return val; }
};

const formatTime = (raw: any) => {
  const val = unbox(raw);
  if (!val) return "--:--";
  if (val.includes('T')) return val.split('T')[1].substring(0, 5);
  return val.substring(0, 5);
};

// Titel-Logik (Fallback für alte Einträge, neue kommen jetzt direkt richtig aus Airtable)
const getDisplayTitle = (b: any) => {
  const title = unbox(b.Tätigkeit);
  const note = unbox(b.Notiz_Patient);
  
  // Alte Logik für "Terminanfrage App" Einträge
  if ((title === "Terminanfrage App" || unbox(b.Status) === "Anfrage") && note) {
     if (note.includes("Grund:")) return note.split("Grund:")[1].trim(); 
     if (note.includes("Wunschdatum")) return "Terminanfrage"; 
  }
  return title;
};

export default function App() {
  // --- STATES ---
  const [patientId, setPatientId] = useState<string | null>(localStorage.getItem('active_patient_id'));
  const [fullName, setFullName] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  
  // Daten
  const [patientData, setPatientData] = useState<any>(null);
  const [contactData, setContactData] = useState<any[]>([]);
  const [besuche, setBesuche] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAllTasks, setShowAllTasks] = useState(false);

  // UI / Modals
  const [activeModal, setActiveModal] = useState<'folder' | 'upload' | 'video' | 'ki-telefon' | 'new-appointment' | null>(null);
  const [uploadContext, setUploadContext] = useState<'Rechnung' | 'Leistungsnachweis' | ''>(''); 
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Termin Management
  const [confirmedTermine, setConfirmedTermine] = useState<string[]>([]);
  const [editingTermin, setEditingTermin] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<string[]>([]);
  
  // Änderungswunsch Daten
  const [newTerminDate, setNewTerminDate] = useState(""); 
  const [newTerminTime, setNewTerminTime] = useState(""); 
  
  // Neue Terminanfrage Daten
  const [requestDate, setRequestDate] = useState("");
  const [requestTime, setRequestTime] = useState(""); // NEU: Uhrzeit für Anfrage
  const [requestReason, setRequestReason] = useState("");

  // Urlaub
  const [urlaubStart, setUrlaubStart] = useState("");
  const [urlaubEnde, setUrlaubEnde] = useState("");

  // KI Button
  const [kiPos, setKiPos] = useState({ x: 24, y: 120 });
  const isDragging = useRef(false);

  const handleDrag = (e: any) => {
    if (!isDragging.current) return;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    setKiPos({
      x: Math.max(10, window.innerWidth - clientX - 40),
      y: Math.max(10, window.innerHeight - clientY - 40)
    });
  };

  // --- DATEN LADEN ---
  const fetchData = async () => {
    const id = patientId || localStorage.getItem('active_patient_id');
    if (!id || id === "null") return;
    try {
      setLoading(true);
      const [resP, resC, resB, resT] = await Promise.all([
        fetch(`${N8N_BASE_URL}/get_data_patienten?patientId=${id}`),
        fetch(`${N8N_BASE_URL}/get_data_kontakte?patientId=${id}`),
        fetch(`${N8N_BASE_URL}/get_data_besuche?patientId=${id}`),
        fetch(`${N8N_BASE_URL}/get_tasks?patientId=${id}`)
      ]);
      
      const jsonP = await resP.json(); const jsonC = await resC.json();
      const jsonB = await resB.json(); const jsonT = await resT.json();

      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      
      const extract = (json: any) => {
        if (!json) return [];
        if (json.data && Array.isArray(json.data)) {
           if (json.data[0]?.data && Array.isArray(json.data[0].data)) return json.data[0].data;
           return json.data;
        }
        if (Array.isArray(json)) return json;
        return [];
      };

      setContactData(extract(jsonC));

      const rawBesuche = extract(jsonB);
      const mappedBesuche = rawBesuche.map((b: any) => {
          const fields = b.fields || b;
          return { id: b.id, ...fields };
      });
      setBesuche(mappedBesuche.sort((a:any, b:any) => new Date(unbox(a.Datum)).getTime() - new Date(unbox(b.Datum)).getTime()));
      
      const rawTasks = extract(jsonT);
      setTasks(rawTasks.map((t: any) => {
        const data = t.fields || t; 
        return { id: t.id, text: unbox(data.Aufgabentext || data.text || "Aufgabe"), done: unbox(data.Status) === "Erledigt" };
      }));

    } catch (e) { console.error("Ladefehler:", e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

  // --- LOGIN ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setIsLoggingIn(true);
    try {
      const res = await fetch(`${N8N_BASE_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fullName, code: loginCode }) });
      const data = await res.json();
      if (data.status === "success" && data.patientId) {
        localStorage.setItem('active_patient_id', data.patientId); setPatientId(data.patientId);
      }
    } catch (e) { console.error(e); } finally { setIsLoggingIn(false); }
  };

  // --- ACTIONS ---
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
    } catch(e) { console.error("Fehler beim Bestätigen", e); }
  };

  const handleTerminReschedule = async (recordId: string, oldDate: string) => {
    if(!newTerminDate) return;
    setIsSending(true);
    setPendingChanges([...pendingChanges, recordId]);
    setEditingTermin(null);

    try {
        const formData = new FormData();
        formData.append('patientId', patientId!);
        formData.append('typ', 'Terminverschiebung');
        formData.append('recordId', recordId);
        
        let nachricht = `Verschiebung gewünscht von ${formatDate(oldDate)} auf ${formatDate(newTerminDate)}`;
        if (newTerminTime) nachricht += ` um ca. ${newTerminTime} Uhr`;
        
        formData.append('nachricht', nachricht);
        await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        
        setNewTerminDate(""); setNewTerminTime(""); 
    } catch(e) { console.error(e); }
    setIsSending(false);
  };

  // NEU: Neue Terminanfrage (mit Betreff & Nachricht Split)
  const handleNewTerminRequest = async () => {
      if(!requestDate) return;
      setIsSending(true);
      try {
        const formData = new FormData();
        formData.append('patientId', patientId!);
        formData.append('patientName', unbox(patientData?.Name));
        formData.append('typ', 'Terminanfrage');
        
        // 1. Der GRUND geht in 'betreff' -> landet in Airtable Spalte "Tätigkeit"
        formData.append('betreff', requestReason || "Terminanfrage");
        
        // 2. DATUM & ZEIT geht in 'nachricht' -> landet in Airtable Spalte "Notiz_Patient"
        let note = `Wunschtermin: ${formatDate(requestDate)}`;
        if (requestTime) note += ` um ${requestTime} Uhr`;
        formData.append('nachricht', note);
        
        await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
        
        setSentStatus('success');
        setTimeout(() => { setActiveModal(null); setSentStatus('idle'); setRequestDate(""); setRequestTime(""); setRequestReason(""); }, 1500);
      } catch (e) { setSentStatus('error'); }
      setIsSending(false);
  };

  const submitData = async (type: string, payload: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('patientId', patientId!);
      formData.append('patientName', unbox(patientData?.Name));
      if (activeModal === 'upload' && selectedFiles.length > 0) {
          formData.append('typ', type.replace('-Upload', '')); formData.append('file', selectedFiles[0]); 
          await fetch(`${N8N_BASE_URL}/upload_document`, { method: 'POST', body: formData });
      } else {
          formData.append('typ', type); formData.append('nachricht', payload);
          await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
      }
      setSentStatus('success');
      setTimeout(() => { if (activeModal === 'upload') setActiveModal('folder'); else setActiveModal(null); setSentStatus('idle'); setUrlaubStart(""); setUrlaubEnde(""); setSelectedFiles([]); }, 1500);
    } catch (e) { console.error(e); setSentStatus('error'); }
    setIsSending(false);
  };

  if (!patientId) return <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6"><form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl w-full max-w-sm"><img src="/logo.png" alt="Logo" className="w-48 mx-auto mb-6" /><input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4 outline-none" placeholder="Vollständiger Name" required /><input type="password" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4 outline-none" placeholder="Login-Code" required /><button type="submit" className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold uppercase shadow-lg">Anmelden</button></form></div>;

  const openTasksCount = tasks.filter(t => !t.done).length;

  return (
    <div className="min-h-screen bg-white pb-32 text-left select-none font-sans text-[#3A3A3A]" onMouseMove={handleDrag} onTouchMove={handleDrag} onMouseUp={() => isDragging.current = false} onTouchEnd={() => isDragging.current = false}>
      <header className="py-4 px-6 bg-[#dccfbc] text-white flex justify-between items-center shadow-sm"><img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11" /><div className="flex flex-col items-end"><button onClick={() => { localStorage.clear(); setPatientId(null); }} className="bg-white/20 p-2 rounded-full mb-1"><LogOut size={18}/></button><p className="text-[10px] font-bold italic">{unbox(patientData?.Name)}</p></div></header>

      <main className="max-w-md mx-auto px-6 pt-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center"><div><p className="text-[10px] uppercase font-bold opacity-80 mb-1 tracking-widest">Status</p><h2 className="text-3xl font-black">{unbox(patientData?.Pflegegrad)}</h2></div><CalendarIcon size={28}/></div>
            <section className="space-y-4"><div className="flex justify-between items-center border-l-4 border-[#dccfbc] pl-4"><h3 className="font-black text-lg uppercase tracking-widest text-[10px] text-gray-400">Aufgaben ({openTasksCount} offen)</h3>{loading && <RefreshCw size={14} className="animate-spin text-gray-300"/>}</div><div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 space-y-3">{tasks.length > 0 ? tasks.slice(0,5).map((t) => (<button key={t.id} onClick={() => toggleTask(t.id, t.done)} className="w-full flex items-center gap-3 text-left active:opacity-70 transition-opacity group">{t.done ? <CheckCircle2 size={24} className="text-[#dccfbc] shrink-0" /> : <Circle size={24} className="text-gray-200 shrink-0 group-hover:text-[#b5a48b]" />}<span className={`text-sm ${t.done ? 'text-gray-300 line-through' : 'font-bold text-gray-700'}`}>{t.text}</span></button>)) : <p className="text-center text-gray-300 py-4 italic text-xs">Keine Aufgaben aktuell.</p>}{tasks.length > 5 && (<button onClick={() => setShowAllTasks(!showAllTasks)} className="w-full text-center text-[10px] font-black uppercase text-[#b5a48b] pt-2 border-t mt-2 flex items-center justify-center gap-1">{showAllTasks ? <><ChevronUp size={12}/> Weniger anzeigen</> : <><ChevronDown size={12}/> {tasks.length-5} weitere anzeigen</>}</button>)}</div></section>
            <section className="space-y-6"><h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Stammdaten</h3><div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-4 text-sm"><div className="flex justify-between border-b pb-2"><span>Geburtsdatum</span><span className="font-bold">{unbox(patientData?.Geburtsdatum)}</span></div><div className="flex justify-between border-b pb-2"><span>Versicherung</span><span className="font-bold">{unbox(patientData?.Versicherung)}</span></div><div><p className="text-gray-400">Anschrift</p><p className="font-bold text-[#3A3A3A]">{unbox(patientData?.Anschrift)}</p></div></div></section>
            <section className="space-y-6"><h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Kontakte</h3><div className="space-y-3">{contactData.map((c: any, i: number) => { const data = c.fields || c; return (<div key={i} className="bg-white rounded-[2rem] p-4 flex items-center justify-between shadow-sm border border-gray-100"><div className="flex items-center gap-4"><div className="w-12 h-12 bg-[#F9F7F4] rounded-2xl flex items-center justify-center font-black text-[#dccfbc] text-lg">{unbox(data.Name || "?")[0]}</div><div className="text-left"><p className="font-black text-lg leading-tight">{unbox(data.Name)}</p><p className="text-[10px] font-bold text-gray-400 uppercase">{unbox(data['Rolle/Funktion'])}</p></div></div>{unbox(data.Telefon) && <a href={`tel:${unbox(data.Telefon)}`} className="bg-[#dccfbc]/10 p-3 rounded-full text-[#b5a48b]"><Phone size={20} fill="#b5a48b" /></a>}</div>); })}</div></section>
          </div>
        )}

        {/* PLANER */}
        {activeTab === 'planer' && (
          <div className="space-y-6 animate-in fade-in pb-12">
            <div className="text-center mb-6"><div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><CalendarDays size={32} className="text-[#b5a48b]" /></div><h2 className="text-3xl font-black">Besuchs-Planer</h2><p className="text-xs text-gray-400 mt-2 px-6">Ihre kommenden Termine & Einsätze.</p></div>
            <div className="flex justify-center"><button onClick={() => setActiveModal('new-appointment')} className="bg-white py-3 px-6 rounded-full shadow-sm border border-[#F9F7F4] flex items-center gap-2 text-[#b5a48b] font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all"><PlusCircle size={16} /> Termin anfragen</button></div>
            {besuche.map((b, i) => (
              <div key={b.id} className="bg-white rounded-[2rem] shadow-sm border border-gray-100 text-left overflow-hidden">
                <div className="p-6 flex items-center gap-6">
                    <div className="text-center min-w-[60px]"><p className="text-xl font-bold text-gray-300">{formatTime(b.Uhrzeit)}</p><p className="text-[10px] text-gray-400 font-bold uppercase">UHR</p></div>
                    <div className="flex-1 border-l border-gray-100 pl-5 text-left"><p className="font-black text-[#3A3A3A] text-lg mb-2">{getDisplayTitle(b)}</p><div className="flex items-center gap-2"><User size={12} className="text-gray-400"/><p className="text-sm text-gray-500">{unbox(b.Pfleger_Name) || "Zuweisung folgt"}</p></div><p className="text-[10px] text-[#b5a48b] mt-3 font-bold uppercase tracking-wider text-left">Am {formatDate(b.Datum)}</p></div>
                </div>
                {confirmedTermine.includes(b.id) || unbox(b.Status) === "Bestätigt" ? (
                    <div className="bg-[#e6f4ea] text-[#1e4620] py-4 text-center font-black uppercase text-xs flex items-center justify-center gap-2 animate-in slide-in-from-bottom-2"><Check size={16} strokeWidth={3}/> Termin angenommen</div>
                ) : pendingChanges.includes(b.id) || unbox(b.Status) === "Änderungswunsch" ? (
                    <div className="bg-[#fff7ed] text-[#c2410c] py-4 text-center font-black uppercase text-xs flex items-center justify-center gap-2 animate-in slide-in-from-bottom-2"><AlertCircle size={16} strokeWidth={3}/> Warten auf Rückmeldung</div>
                ) : editingTermin === b.id ? (
                    <div className="bg-[#fdfcfb] border-t p-4 animate-in slide-in-from-bottom-2"><p className="text-[10px] font-black uppercase text-[#b5a48b] mb-2">Neuen Wunschtermin wählen:</p><div className="flex gap-2 mb-2"><input type="date" value={newTerminDate} onChange={(e)=>setNewTerminDate(e.target.value)} className="bg-white border rounded-xl p-2 flex-1 text-sm outline-none min-w-0" style={{ colorScheme: 'light' }} /><input type="time" value={newTerminTime} onChange={(e)=>setNewTerminTime(e.target.value)} className="bg-white border rounded-xl p-2 w-24 text-sm outline-none" style={{ colorScheme: 'light' }} /></div><div className="flex justify-end gap-2"><button onClick={() => { setEditingTermin(null); setNewTerminTime(""); }} className="p-2 bg-gray-100 rounded-xl"><X size={18} className="text-gray-400"/></button><button onClick={() => handleTerminReschedule(b.id, unbox(b.Datum))} className="px-4 py-2 bg-[#b5a48b] text-white rounded-xl font-bold text-xs uppercase flex-1">Senden</button></div></div>
                ) : (
                    <div className="flex border-t border-gray-100"><button onClick={() => handleTerminConfirm(b.id)} className="flex-1 bg-[#e6f4ea] hover:bg-[#d1e7d8] text-[#1e4620] py-4 font-black uppercase text-[10px] tracking-wider transition-colors border-r border-white">Termin ok</button><button onClick={() => setEditingTermin(b.id)} className="flex-1 bg-[#fce8e6] hover:bg-[#fadbd8] text-[#8a1c14] py-4 font-black uppercase text-[10px] tracking-wider transition-colors">Termin ändern</button></div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'hochladen' && (<div className="space-y-4 animate-in fade-in"><div className="text-center mb-6"><div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><Upload size={32} className="text-[#b5a48b]" /></div><h2 className="text-3xl font-black">Dokumente</h2><p className="text-xs text-gray-400 mt-2 px-6">Ihr Archiv & Upload für Nachweise.</p></div><div className="flex flex-col gap-4"><button onClick={() => { setUploadContext('Leistungsnachweis'); setActiveModal('folder'); }} className="bg-white rounded-[2.2rem] p-6 shadow-sm border border-gray-50 flex items-center gap-5 active:scale-95 transition-all text-left"><div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b]"><FileCheck size={32} /></div><div className="flex-1"><h3 className="font-black">Leistungsnachweise</h3><p className="text-[10px] text-gray-400 uppercase">Archiv & Upload</p></div><ChevronRight className="text-gray-300" /></button><button onClick={() => { setUploadContext('Rechnung'); setActiveModal('folder'); }} className="bg-white rounded-[2.2rem] p-6 shadow-sm border border-gray-50 flex items-center gap-5 active:scale-95 transition-all text-left"><div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b]"><Euro size={32} /></div><div className="flex-1"><h3 className="font-black">Rechnungen</h3><p className="text-[10px] text-gray-400 uppercase">Archiv & Upload</p></div><ChevronRight className="text-gray-300" /></button></div><div className="flex flex-col items-center gap-3 mt-4 scale-110 origin-top"><button onClick={() => setActiveModal('video')} className="flex items-center gap-2 bg-white px-6 py-3 rounded-full shadow-md border text-[#b5a48b] text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"><Play size={14} fill="#b5a48b" /> So funktioniert's</button><div className="bg-[#dccfbc]/10 rounded-[1.5rem] p-5 text-center w-full max-w-xs"><p className="text-[#b5a48b] text-xs">Fragen zu Ihren Dokumenten?</p><button onClick={()=>setActiveModal('ki-telefon')} className="mt-1 text-[#b5a48b] font-black uppercase text-xs underline">KI-Assistent fragen</button></div></div></div>)}
        {activeTab === 'urlaub' && (<div className="space-y-6 animate-in fade-in"><div className="text-center mb-6"><div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4"><Plane size={32} className="text-[#b5a48b]" /></div><h2 className="text-3xl font-black">Urlaubsplanung</h2><p className="text-xs text-gray-400 mt-2 px-6">Teilen Sie uns ihre Abwesenheiten mit.</p></div><div className="bg-white rounded-[3rem] p-8 shadow-xl border border-gray-100 space-y-6"><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Von wann</label><div className="bg-[#F9F7F4] p-2 rounded-2xl flex items-center px-4"><CalendarIcon size={20} className="text-gray-400 mr-3"/><input type="date" value={urlaubStart} onChange={(e)=>setUrlaubStart(e.target.value)} className="bg-transparent w-full p-2 outline-none font-bold" style={{ colorScheme: 'light' }} /></div></div><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Bis wann</label><div className="bg-[#F9F7F4] p-2 rounded-2xl flex items-center px-4"><CalendarIcon size={20} className="text-gray-400 mr-3"/><input type="date" value={urlaubEnde} onChange={(e)=>setUrlaubEnde(e.target.value)} className="bg-transparent w-full p-2 outline-none font-bold" style={{ colorScheme: 'light' }} /></div></div><button onClick={() => submitData('Urlaubsmeldung', `Urlaub von ${formatDate(urlaubStart)} bis ${formatDate(urlaubEnde)}`)} disabled={isSending || !urlaubStart || !urlaubEnde} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-3">{isSending ? <RefreshCw className="animate-spin" /> : <Send size={18} />} <span>{sentStatus === 'success' ? 'Eingetragen!' : 'Eintragen'}</span></button></div><p className="text-[10px] text-gray-300 text-center px-10">Hinweis: Einsätze pausieren in diesem Zeitraum.</p></div>)}
      </main>
      
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 border-t flex justify-around p-5 pb-11 z-50 rounded-t-[3rem] shadow-2xl">{[ { id: 'dashboard', icon: LayoutDashboard, label: 'Home' }, { id: 'planer', icon: CalendarDays, label: 'Planer' }, { id: 'hochladen', icon: Upload, label: 'Upload' }, { id: 'urlaub', icon: Plane, label: 'Urlaub' } ].map((t) => (<button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === t.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}><t.icon size={22} strokeWidth={activeTab === t.id ? 3 : 2} /><span className="text-[9px] font-black uppercase">{t.label}</span></button>))}</nav>
      <button onMouseDown={() => isDragging.current = true} onTouchStart={() => isDragging.current = true} onClick={() => { if (!isDragging.current) setActiveModal('ki-telefon'); }} style={{ right: kiPos.x, bottom: kiPos.y, touchAction: 'none' }} className="fixed z-[60] w-20 h-20 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-2 border-white active:scale-90 transition-transform cursor-move"><Mic size={24} fill="white" /><span className="text-[9px] font-bold mt-0.5 leading-tight text-center">24h<br/>KI Hilfe</span></button>
      
      {activeModal && (<div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in"><div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
         {activeModal === 'video' && (<div className="bg-black w-full max-w-md h-[50vh] rounded-[2rem] overflow-hidden relative shadow-2xl animate-in zoom-in-95 flex items-center justify-center"><button onClick={()=>setActiveModal(null)} className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white"><X size={20}/></button><div className="text-white text-center"><PlayCircle size={64} className="opacity-20 mx-auto"/><p className="mt-4 font-bold text-xs uppercase tracking-widest">Video wird geladen...</p></div></div>)}
         {activeModal === 'ki-telefon' && (<div className="bg-white w-full max-w-md h-[85vh] rounded-[3rem] overflow-hidden relative animate-in slide-in-from-bottom-10"><iframe src="https://app.centrals.ai/centrals/embed/Pflegedienst" className="w-full h-full border-none" /><button onClick={()=>setActiveModal(null)} className="absolute top-6 right-6 bg-black/20 p-2 rounded-full text-white"><X/></button></div>)}
         {activeModal === 'new-appointment' && (<div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left"><button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button><div className="space-y-6"><h3 className="text-xl font-black flex items-center gap-3"><CalendarDays className="text-[#dccfbc]"/> Neuer Termin</h3><p className="text-xs text-gray-400">Schlagen Sie einen Tag vor. Wir bestätigen kurzfristig.</p><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Wunschdatum</label><input type="date" value={requestDate} onChange={(e)=>setRequestDate(e.target.value)} className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none font-bold" style={{ colorScheme: 'light' }} /></div><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Uhrzeit (Optional)</label><input type="time" value={requestTime} onChange={(e)=>setRequestTime(e.target.value)} className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none font-bold" style={{ colorScheme: 'light' }} /></div><div className="space-y-2"><label className="text-[10px] font-black uppercase text-[#b5a48b]">Grund (Tätigkeit)</label><input type="text" value={requestReason} onChange={(e)=>setRequestReason(e.target.value)} placeholder="z.B. Einkaufen, Arzt..." className="bg-[#F9F7F4] w-full p-4 rounded-2xl outline-none text-sm" /></div><button onClick={handleNewTerminRequest} disabled={isSending || !requestDate} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2">{isSending ? <RefreshCw className="animate-spin" size={16}/> : <Send size={16} />} {sentStatus === 'success' ? 'Anfrage gesendet!' : 'Anfrage senden'}</button></div></div>)}
         {activeModal === 'folder' && (<div className="bg-white w-full max-w-md h-[80vh] rounded-t-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10"><div className="flex justify-between items-center mb-8"><h3 className="text-2xl font-black">{uploadContext}</h3><button onClick={()=>setActiveModal(null)} className="bg-gray-100 p-2 rounded-full"><X size={20}/></button></div><button onClick={() => setActiveModal('upload')} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase flex items-center justify-center gap-2 mb-8 shadow-lg active:scale-95 transition-all"><Plus size={20}/> Neu hochladen</button><div className="space-y-4"><p className="text-[10px] font-black text-gray-400 uppercase">Bisherige Dokumente</p><div className="bg-gray-50 p-4 rounded-2xl flex items-center gap-4 opacity-50"><FileText className="text-gray-300"/><p className="text-sm font-bold text-gray-400">Archiv ist leer</p></div></div></div>)}
         {activeModal === 'upload' && (<div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left"><button onClick={() => setActiveModal('folder')} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button><div className="space-y-6"><h3 className="text-xl font-black flex items-center gap-3">{uploadContext === 'Rechnung' ? <Euro className="text-[#dccfbc]"/> : <FileText className="text-[#dccfbc]"/>} Hochladen</h3><div className="border-2 border-dashed border-[#dccfbc] rounded-[2rem] p-8 text-center bg-[#F9F7F4] relative"><input type="file" multiple accept="image/*,.pdf" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} className="absolute inset-0 opacity-0 cursor-pointer" /><Upload className="mx-auto text-[#dccfbc] mb-2" size={32}/><p className="text-xs font-black text-[#b5a48b] uppercase tracking-widest">{selectedFiles.length > 0 ? `${selectedFiles.length} ausgewählt` : "Datei auswählen"}</p></div><button onClick={() => submitData(uploadContext + '-Upload', 'Dokument')} disabled={isSending || selectedFiles.length === 0} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2">{isSending && <RefreshCw className="animate-spin" size={16}/>}{sentStatus === 'success' ? 'Erfolgreich!' : 'Absenden'}</button></div></div>)}
      </div>)}
    </div>
  );
}