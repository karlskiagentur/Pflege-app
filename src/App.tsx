import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, Phone, User, RefreshCw, FileText, 
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, 
  ChevronRight, Send, Euro, FileCheck, PlayCircle, Plane, Play, FolderOpen, Plus,
  CheckCircle2, Circle, ChevronDown, ChevronUp
} from 'lucide-react';

// WICHTIG: Dein n8n Workflow muss auf "Active" (Grün) stehen!
const N8N_BASE_URL = 'https://karlskiagentur.app.n8n.cloud/webhook';

const unbox = (val: any): string => {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) return unbox(val[0]);
  return String(val);
};

export default function App() {
  const [patientId, setPatientId] = useState<string | null>(localStorage.getItem('active_patient_id'));
  const [fullName, setFullName] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  
  const [patientData, setPatientData] = useState<any>(null);
  const [contactData, setContactData] = useState<any[]>([]);
  const [besuche, setBesuche] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAllTasks, setShowAllTasks] = useState(false);

  const [activeModal, setActiveModal] = useState<'folder' | 'upload' | 'video' | 'ki-telefon' | null>(null);
  const [uploadContext, setUploadContext] = useState<'Rechnung' | 'Leistungsnachweis' | ''>(''); 
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [urlaubStart, setUrlaubStart] = useState("");
  const [urlaubEnde, setUrlaubEnde] = useState("");
  const [kiPos, setKiPos] = useState({ x: 24, y: 120 });
  const isDragging = useRef(false);

  // --- DATEN LADEN (GET) ---
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
      
      const jsonP = await resP.json(); 
      const jsonC = await resC.json();
      const jsonB = await resB.json(); 
      const jsonT = await resT.json(); // Hier kommen die Aufgaben

      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      
      const extract = (json: any) => {
        if (!json) return [];
        if (json.data && Array.isArray(json.data)) {
           // Fall: n8n schachtelt Daten manchmal tief
           if (json.data[0]?.data && Array.isArray(json.data[0].data)) return json.data[0].data;
           return json.data;
        }
        if (Array.isArray(json)) return json;
        return [];
      };

      setContactData(extract(jsonC));
      setBesuche(extract(jsonB));
      
      // --- AUFGABEN INTELLIGENT VERARBEITEN ---
      const rawTasks = extract(jsonT);
      const mappedTasks = rawTasks.map((t: any) => {
        // n8n liefert Daten manchmal flach oder im 'fields' Objekt
        // Wir prüfen beides, damit es garantiert klappt.
        const text = t.fields?.Aufgabentext || t.Aufgabentext || t.text || "Aufgabe ohne Titel";
        const status = t.fields?.Status || t.Status || "";
        
        return {
          id: t.id, // Die echte Record-ID (rec...)
          text: unbox(text),
          done: unbox(status) === "Erledigt"
        };
      });
      setTasks(mappedTasks);

    } catch (e) { console.error("Ladefehler:", e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

  // --- AUFGABE UPDATE (POST) ---
  const toggleTask = async (id: string, currentStatus: boolean) => {
    // 1. Sofort in der App anzeigen (schnelles Feedback)
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !currentStatus } : t));

    try {
      // 2. An n8n senden (Hintergrund)
      await fetch(`${N8N_BASE_URL}/update_task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: id, done: !currentStatus })
      });
      // 3. Kurz warten und neu laden zur Sicherheit
      setTimeout(fetchData, 1000);
    } catch (e) { 
        console.error("Sync Fehler:", e); 
        // Falls Fehler: Rückgängig machen (optional)
        setTasks(prev => prev.map(t => t.id === id ? { ...t, done: currentStatus } : t));
    }
  };

  // --- LOGIN & UPLOAD LOGIK ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const res = await fetch(`${N8N_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, code: loginCode })
      });
      const data = await res.json();
      if (data.status === "success" && data.patientId) {
        localStorage.setItem('active_patient_id', data.patientId);
        setPatientId(data.patientId);
      }
    } catch (e) { console.error(e); }
    finally { setIsLoggingIn(false); }
  };

  const submitData = async (type: string, payload: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('patientId', patientId!);
      formData.append('patientName', unbox(patientData?.Name));
      formData.append('typ', type);
      formData.append('nachricht', payload);
      await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
      setSentStatus('success');
      setTimeout(() => { 
        if (activeModal === 'upload') setActiveModal('folder');
        else setActiveModal(null);
        setSentStatus('idle');
      }, 1500);
    } catch (e) { setSentStatus('error'); }
    setIsSending(false);
  };

  if (!patientId) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6 text-left">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl w-full max-w-sm">
          <img src="/logo.png" alt="Logo" className="w-48 mx-auto mb-6" />
          <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4 outline-none" placeholder="Vollständiger Name" required />
          <input type="password" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4 outline-none" placeholder="Login-Code" required />
          <button type="submit" className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold uppercase shadow-lg">Anmelden</button>
        </form>
      </div>
    );
  }

  const openTasksCount = tasks.filter(t => !t.done).length;
  const visibleTasks = showAllTasks ? tasks : tasks.slice(0, 5);

  return (
    <div className="min-h-screen bg-white pb-32 text-left select-none font-sans text-[#3A3A3A]">
      <header className="py-4 px-6 bg-[#dccfbc] text-white flex justify-between items-center shadow-sm">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11" />
        <div className="flex flex-col items-end">
          <button onClick={() => { localStorage.clear(); setPatientId(null); }} className="bg-white/20 p-2 rounded-full mb-1"><LogOut size={18}/></button>
          <p className="text-[10px] font-bold italic">{unbox(patientData?.Name)}</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 pt-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center">
               <div><p className="text-[10px] uppercase font-bold opacity-80 mb-1 tracking-widest">Status</p><h2 className="text-3xl font-black">{unbox(patientData?.Pflegegrad)}</h2></div>
               <CalendarIcon size={28}/>
            </div>

            <section className="space-y-4">
              <div className="flex justify-between items-center border-l-4 border-[#dccfbc] pl-4">
                  <h3 className="font-black text-lg uppercase tracking-widest text-[10px] text-gray-400">Aufgaben ({openTasksCount} offen)</h3>
                  {loading && <RefreshCw size={14} className="animate-spin text-gray-300"/>}
              </div>
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 space-y-3">
                 {tasks.length > 0 ? visibleTasks.map((t) => (
                    <button key={t.id} onClick={() => toggleTask(t.id, t.done)} className="w-full flex items-center gap-3 text-left active:opacity-70 transition-opacity group">
                        {t.done ? <CheckCircle2 size={24} className="text-[#dccfbc] shrink-0" /> : <Circle size={24} className="text-gray-200 shrink-0 group-hover:text-[#b5a48b]" />}
                        <span className={`text-sm ${t.done ? 'text-gray-300 line-through' : 'font-bold text-gray-700'}`}>{t.text}</span>
                    </button>
                 )) : <p className="text-center text-gray-300 py-4 italic text-xs">Alles erledigt oder keine Aufgaben.</p>}
                 
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
                <div className="flex justify-between border-b pb-2"><span>Geburtsdatum</span><span className="font-bold">{unbox(patientData?.Geburtsdatum)}</span></div>
                <div className="flex justify-between border-b pb-2"><span>Versicherung</span><span className="font-bold">{unbox(patientData?.Versicherung)}</span></div>
                <div><p className="text-gray-400">Anschrift</p><p className="font-bold">{unbox(patientData?.Anschrift)}</p></div>
              </div>
            </section>
          </div>
        )}

        {/* TAB: PLANER */}
        {activeTab === 'planer' && (
          <div className="space-y-6 animate-in fade-in">
            <h2 className="text-3xl font-black">Besuchs-Planer</h2>
            {besuche.map((b, i) => (
              <div key={i} className="bg-white rounded-[2rem] p-6 flex items-center gap-6 shadow-sm border border-gray-100 text-left">
                <div className="text-center min-w-[60px]"><p className="text-xl font-bold text-gray-300">{(unbox(b.Uhrzeit)).substring(0,5)}</p><p className="text-[10px] text-gray-400 font-bold uppercase">UHR</p></div>
                <div className="flex-1 border-l pl-5">
                  <p className="font-black text-lg">{unbox(b.Tätigkeit)}</p>
                  <p className="text-xs text-gray-500 mt-1">{unbox(b.Pfleger_Name) || "Zuweisung folgt"}</p>
                  <p className="text-[10px] text-[#b5a48b] mt-2 font-bold uppercase">Am {formatDate(b.Datum)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB: HOCHLADEN */}
        {activeTab === 'hochladen' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="mb-5 text-center"><h2 className="text-2xl font-black">Dokumente</h2><p className="text-xs text-gray-400 mt-1">Ihr Archiv & Upload</p></div>
            <div className="flex flex-col gap-4">
              <button onClick={() => { setUploadContext('Leistungsnachweis'); setActiveModal('folder'); }} className="bg-white rounded-[2.2rem] p-6 shadow-sm border border-gray-50 flex items-center gap-5 active:scale-95 transition-all text-left">
                <div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b]"><FileCheck size={32} /></div>
                <div className="flex-1"><h3 className="font-black">Leistungsnachweise</h3><p className="text-[10px] text-gray-400 uppercase">Archiv & Upload</p></div>
                <ChevronRight className="text-gray-300" />
              </button>
              <button onClick={() => { setUploadContext('Rechnung'); setActiveModal('folder'); }} className="bg-white rounded-[2.2rem] p-6 shadow-sm border border-gray-50 flex items-center gap-5 active:scale-95 transition-all text-left">
                <div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b]"><Euro size={32} /></div>
                <div className="flex-1"><h3 className="font-black">Rechnungen</h3><p className="text-[10px] text-gray-400 uppercase">Archiv & Upload</p></div>
                <ChevronRight className="text-gray-300" />
              </button>
            </div>
            <div className="flex justify-center pt-4">
                <button onClick={() => setActiveModal('video')} className="flex items-center gap-2 bg-white px-6 py-3 rounded-full shadow-md border text-[#b5a48b] text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"><Play size={14} fill="#b5a48b" /> So funktioniert's</button>
            </div>
            <div className="bg-[#dccfbc]/10 rounded-[1.5rem] p-5 text-center mt-2"><p className="text-[#b5a48b] text-xs">Fragen zu Ihren Dokumenten?</p><button onClick={()=>setActiveModal('ki-telefon')} className="mt-1 text-[#b5a48b] font-black uppercase text-xs underline">KI-Assistent fragen</button></div>
          </div>
        )}

        {/* TAB: URLAUB */}
        {activeTab === 'urlaub' && (
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
                <button onClick={() => submitData('Urlaubsmeldung', `Urlaub von ${urlaubStart} bis ${urlaubEnde}`)} disabled={isSending || !urlaubStart || !urlaubEnde} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg disabled:opacity-50 active:scale-95 transition-all">{isSending ? <RefreshCw className="animate-spin" /> : <Send size={18} />} {sentStatus === 'success' ? 'Eingetragen!' : 'Eintragen'}</button>
            </div>
            <p className="text-[10px] text-gray-300 text-center px-10">Hinweis: Einsätze pausieren in diesem Zeitraum.</p>
          </div>
        )}
      </main>

      {/* NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 border-t flex justify-around p-5 pb-11 z-50 rounded-t-[3rem] shadow-2xl">
        {[ { id: 'dashboard', icon: LayoutDashboard, label: 'Home' }, { id: 'planer', icon: CalendarDays, label: 'Planer' }, { id: 'hochladen', icon: Upload, label: 'Upload' }, { id: 'urlaub', icon: Plane, label: 'Urlaub' } ].map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === t.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}><t.icon size={22} strokeWidth={activeTab === t.id ? 3 : 2} /><span className="text-[9px] font-black uppercase">{t.label}</span></button>
        ))}
      </nav>

      {/* KI BUTTON */}
      <button onMouseDown={() => isDragging.current = true} onTouchStart={() => isDragging.current = true} onClick={() => { if (!isDragging.current) setActiveModal('ki-telefon'); }} style={{ right: kiPos.x, bottom: kiPos.y, touchAction: 'none' }} className="fixed z-[60] w-16 h-16 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-2 border-white active:scale-90 transition-transform"><Mic size={24} fill="white" /><span className="text-[8px] font-bold mt-0.5">KI Hilfe</span></button>

      {/* MODALS */}
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
          {activeModal === 'video' && (
             <div className="bg-black w-full max-w-md h-[50vh] rounded-[2rem] overflow-hidden relative shadow-2xl animate-in zoom-in-95 flex items-center justify-center">
                 <button onClick={()=>setActiveModal(null)} className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white"><X size={20}/></button>
                 <div className="text-white text-center"><PlayCircle size={64} className="opacity-20 mx-auto"/><p className="mt-4 font-bold text-xs uppercase tracking-widest">Video wird geladen...</p></div>
             </div>
          )}
          {activeModal === 'ki-telefon' && (
             <div className="bg-white w-full max-w-md h-[85vh] rounded-[3rem] overflow-hidden relative animate-in slide-in-from-bottom-10"><iframe src="https://app.centrals.ai/centrals/embed/Pflegedienst" className="w-full h-full border-none" /><button onClick={()=>setActiveModal(null)} className="absolute top-6 right-6 bg-black/20 p-2 rounded-full text-white"><X/></button></div>
          )}
          {activeModal === 'folder' && (
            <div className="bg-white w-full max-w-md h-[80vh] rounded-t-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10">
                <div className="flex justify-between items-center mb-8">
                    <h3 className="text-2xl font-black">{uploadContext}</h3>
                    <button onClick={()=>setActiveModal(null)} className="bg-gray-100 p-2 rounded-full"><X size={20}/></button>
                </div>
                <button onClick={() => setActiveModal('upload')} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase flex items-center justify-center gap-2 mb-8 shadow-lg active:scale-95 transition-all"><Plus size={20}/> Neu hochladen</button>
                <div className="space-y-4">
                    <p className="text-[10px] font-black text-gray-400 uppercase">Bisherige Dokumente</p>
                    <div className="bg-gray-50 p-4 rounded-2xl flex items-center gap-4 opacity-50"><FileText className="text-gray-300"/><p className="text-sm font-bold text-gray-400">Archiv ist leer</p></div>
                </div>
            </div>
          )}
          {activeModal === 'upload' && (
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left">
              <button onClick={() => setActiveModal('folder')} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
              <div className="space-y-6">
                <h3 className="text-xl font-black flex items-center gap-3">{uploadContext === 'Rechnung' ? <Euro className="text-[#dccfbc]"/> : <FileText className="text-[#dccfbc]"/>} Hochladen</h3>
                <div className="border-2 border-dashed border-[#dccfbc] rounded-[2rem] p-8 text-center bg-[#F9F7F4] relative">
                  <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} className="absolute inset-0 opacity-0 cursor-pointer" />
                  <Upload className="mx-auto text-[#dccfbc] mb-2" size={32}/><p className="text-xs font-black text-[#b5a48b] uppercase tracking-widest">{selectedFiles.length > 0 ? `${selectedFiles.length} ausgewählt` : "Datei auswählen"}</p>
                </div>
                <button onClick={() => submitData(uploadContext + '-Upload', 'Dokument')} disabled={isSending || selectedFiles.length === 0} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex justify-center items-center gap-2">{isSending && <RefreshCw className="animate-spin" size={16}/>}{sentStatus === 'success' ? 'Erfolgreich!' : 'Absenden'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}