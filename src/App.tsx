import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, ClipboardList, Settings, 
  Phone, User, RefreshCw, FileText, Activity,
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, ChevronRight
} from 'lucide-react';

const N8N_BASE_URL = 'https://karlskiagentur.app.n8n.cloud/webhook';

// --- HELFER-FUNKTIONEN (Wichtig für n8n Daten) ---
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
    if (short) { const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; return days[d.getDay()]; }
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  } catch { return val; }
};

const formatTime = (raw: any) => {
  const val = unbox(raw);
  if (!val) return "--:--";
  // Wenn Zeit als ISO String kommt (2024-01-01T10:00:00)
  if (val.includes('T')) return val.split('T')[1].substring(0, 5);
  return val.substring(0, 5);
};

export default function App() {
  const [patientId, setPatientId] = useState<string | null>(localStorage.getItem('active_patient_id'));
  const [fullName, setFullName] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [tagebuchSubTab, setTagebuchSubTab] = useState<'vital' | 'berichte'>('vital');
  const [loading, setLoading] = useState(false);
  
  // States für die Daten
  const [patientData, setPatientData] = useState<any>(null);
  const [contactData, setContactData] = useState<any[]>([]);
  const [besuche, setBesuche] = useState<any[]>([]);
  const [vitalDaten, setVitalDaten] = useState<any[]>([]);
  
  // UI States
  const [activeModal, setActiveModal] = useState<'rezept' | 'termin' | 'ki-telefon' | null>(null);
  const [terminStep, setTerminStep] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [newTaetigkeit, setNewTaetigkeit] = useState("");
  const [newDatum, setNewDatum] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // DRAGGABLE BUTTON LOGIC
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

  const resetAllData = () => {
    setPatientData(null);
    setContactData([]);
    setBesuche([]);
    setVitalDaten([]);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(false);
    resetAllData();
    
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
      } else { setLoginError(true); }
    } catch (e) { setLoginError(true); }
    finally { setIsLoggingIn(false); }
  };

  const handleLogout = () => {
    localStorage.removeItem('active_patient_id');
    setPatientId(null);
    resetAllData();
    setActiveTab('dashboard');
  };

  const fetchData = async () => {
    if (!patientId) return;
    try {
      setLoading(true);
      // Alle Endpunkte abfragen
      const [resP, resC, resB, resV] = await Promise.all([
        fetch(`${N8N_BASE_URL}/get_data_patienten?patientId=${patientId}`),
        fetch(`${N8N_BASE_URL}/get_data_kontakte?patientId=${patientId}`),
        fetch(`${N8N_BASE_URL}/get_data_besuche?patientId=${patientId}`),
        fetch(`${N8N_BASE_URL}/get_data_vitalwerte?patientId=${patientId}`)
      ]);
      
      const jsonP = await resP.json(); 
      const jsonC = await resC.json();
      const jsonB = await resB.json(); 
      const jsonV = await resV.json();

      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      
      // --- DAS IST DER FIX FÜR DIE KONTAKTE (Doppelte Verschachtelung) ---
      let cList = [];
      if (jsonC.data && Array.isArray(jsonC.data) && jsonC.data.length > 0 && jsonC.data[0].data && Array.isArray(jsonC.data[0].data)) {
        cList = jsonC.data[0].data; // Fall A: Doppelt verpackt
      } else if (jsonC.data && Array.isArray(jsonC.data)) {
        cList = jsonC.data; // Fall B: Einfach verpackt
      } else if (Array.isArray(jsonC) && jsonC.length > 0 && jsonC[0].data) {
        cList = jsonC[0].data; // Fall C: Array Wrapper
      } else if (Array.isArray(jsonC)) {
        cList = jsonC; // Fall D: Direkt
      }
      setContactData(cList);
      
      // Besuche und Vitalwerte (mit Sicherheitschecks)
      const bList = Array.isArray(jsonB.data) ? jsonB.data : (jsonB.data && jsonB.data.data ? jsonB.data.data : []);
      setBesuche(Array.isArray(bList) ? bList : []);

      const vList = Array.isArray(jsonV.data) ? jsonV.data : (jsonV.data && jsonV.data.data ? jsonV.data.data : []);
      setVitalDaten(Array.isArray(vList) ? vList : []);

    } catch (e) { console.error(e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

  const submitService = async (type: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('patientId', patientId!);
      formData.append('patientName', unbox(patientData?.Name));
      formData.append('typ', type);
      // Hier würde der echte File Upload passieren
      // const response = await fetch(...)
      
      // Simulierter Erfolg
      setTimeout(() => { 
          setSentStatus('success');
          setTimeout(() => { setActiveModal(null); setSentStatus('idle'); }, 1500);
      }, 1000);
    } catch (e) { setSentStatus('error'); }
    finally { setIsSending(false); }
  };

  // --- LOGIN SCREEN ---
  if (!patientId) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6 text-left">
        <div className="w-full max-w-sm space-y-8 text-center">
          <div>
            <div className="w-64 h-64 flex items-center justify-center mx-auto mb-1">
                <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <p className="text-gray-400 font-medium mb-3">Patienten-Portal Login</p>
          </div>
          <form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl space-y-4">
            <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none border-none font-medium text-left" placeholder="Vollständiger Name" required />
            <input type="password" inputMode="numeric" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none border-none tracking-widest font-medium text-left" placeholder="Login-Code" required />
            <button type="submit" disabled={isLoggingIn} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold shadow-lg uppercase tracking-widest text-sm">
                {isLoggingIn ? "Lade..." : "Anmelden"}
            </button>
          </form>
          {loginError && <p className="text-red-500 text-xs mt-4 font-bold">Login fehlgeschlagen.</p>}
        </div>
      </div>
    );
  }

  // --- HAUPT APP ---
  return (
    <div 
      className="min-h-screen bg-white font-sans pb-32 text-[#3A3A3A] text-left select-none"
      onMouseMove={handleDrag}
      onTouchMove={handleDrag}
      onMouseUp={() => isDragging.current = false}
      onTouchEnd={() => isDragging.current = false}
    >
      <style>{`
        @keyframes slow-blink { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.9; } }
        .animate-slow-blink { animation: slow-blink 3s infinite ease-in-out; }
      `}</style>

      <header className="py-4 px-6 bg-[#dccfbc] text-white shadow-sm relative flex justify-between items-center">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11 w-auto object-contain" />
        <div className="flex flex-col items-end">
          <button onClick={handleLogout} className="bg-white/20 p-2 rounded-full text-white mb-1 active:scale-90 transition-all"><LogOut size={18}/></button>
          <p className="text-sm font-bold italic opacity-90 text-right leading-tight">{unbox(patientData?.Name)}</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 pt-8">
        
        {/* --- DASHBOARD TAB --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center">
               <div><p className="text-[10px] uppercase font-bold opacity-80 mb-1 tracking-widest">Status</p><h2 className="text-3xl font-black tracking-tight">{unbox(patientData?.Pflegegrad)}</h2></div>
               <div className="bg-white/20 p-4 rounded-2xl"><CalendarIcon size={28}/></div>
            </div>

            <section className="space-y-6">
              <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 leading-none uppercase tracking-widest text-[10px] text-gray-400">Stammdaten</h3>
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-4">
                <div className="flex justify-between items-end border-b border-gray-50 pb-3"><span className="text-sm text-gray-400">Geburtsdatum</span><span className="text-sm font-bold text-gray-800">{formatDate(patientData?.Geburtsdatum)}</span></div>
                <div className="flex justify-between items-end border-b border-gray-50 pb-3"><span className="text-sm text-gray-400">Versicherung</span><span className="text-sm font-bold text-gray-800">{unbox(patientData?.Versicherung)}</span></div>
                <div className="pt-2"><p className="text-sm text-gray-400 mb-1">Anschrift</p><p className="text-sm font-bold text-gray-800 leading-snug">{unbox(patientData?.Anschrift)}</p></div>
              </div>
            </section>

            <section className="space-y-6">
              <div className="flex justify-between items-center border-l-4 border-[#dccfbc] pl-4">
                  <h3 className="font-black text-lg leading-none uppercase tracking-widest text-[10px] text-gray-400">Kontakte ({contactData.length})</h3>
                  {loading && <RefreshCw className="animate-spin text-[#dccfbc]" size={14}/>}
              </div>
              <div className="space-y-3">
                {contactData.length > 0 ? contactData.map((c: any, i: number) => {
                  const name = unbox(c.Name || c.fields?.Name);
                  const rolle = unbox(c['Rolle/Funktion'] || c.fields?.['Rolle/Funktion']);
                  const tel = unbox(c.Telefon || c.fields?.Telefon);
                  
                  return (
                    <div key={i} className="bg-white rounded-[2rem] p-4 flex items-center justify-between shadow-sm border border-gray-100">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-[#F9F7F4] rounded-2xl flex items-center justify-center font-black text-[#dccfbc] text-lg">
                          {name ? name[0] : <User size={20}/>}
                        </div>
                        <div>
                          <p className="font-black text-lg leading-tight text-left">{name}</p>
                          <p className="text-[10px] font-bold text-gray-400 tracking-wide uppercase text-left">{rolle}</p>
                        </div>
                      </div>
                      {tel && (
                        <a href={`tel:${tel}`} className="bg-[#dccfbc]/10 p-3 rounded-full text-[#b5a48b] active:scale-90 transition-all">
                          <Phone size={20} fill="#b5a48b" />
                        </a>
                      )}
                    </div>
                  );
                }) : (
                  <p className="text-center text-gray-300 text-xs italic pt-4">Keine Kontakte hinterlegt.</p>
                )}
              </div>
            </section>
          </div>
        )}
        
        {/* --- PLANER TAB --- */}
        {activeTab === 'planer' && (
          <div className="space-y-6 animate-in fade-in">
             <div className="text-center mb-6">
                <h2 className="text-xl font-black text-[#3A3A3A]">Besuchs-Planer</h2>
                <p className="text-xs text-gray-400">Geplante Einsätze für diese Woche</p>
             </div>
             
             <div className="space-y-4">
                {besuche.length > 0 ? besuche.map((b: any, i: number) => (
                    <div key={i} className="flex gap-4">
                        <div className="flex flex-col items-center pt-2 min-w-[50px]">
                            <span className="text-xl font-black text-[#b5a48b]">{formatTime(b.Uhrzeit)}</span>
                            <span className="text-[9px] uppercase font-bold text-gray-300">UHR</span>
                            <div className="h-full w-0.5 bg-gray-100 mt-2 rounded-full"></div>
                        </div>
                        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 w-full mb-2">
                            <h3 className="font-bold text-gray-800 text-sm mb-1">{unbox(b.Taetigkeit) || "Pflegeeinsatz"}</h3>
                            <div className="flex items-center gap-2 mt-2">
                                <div className="w-6 h-6 rounded-full bg-gray-200 overflow-hidden"><img src={`https://ui-avatars.com/api/?name=${unbox(b.Mitarbeiter)}&background=random`} alt="MA" /></div>
                                <span className="text-xs text-gray-500 font-medium">{unbox(b.Mitarbeiter)}</span>
                            </div>
                        </div>
                    </div>
                )) : <p className="text-center text-gray-300 italic py-10">Keine Besuche geplant.</p>}
             </div>
          </div>
        )}

        {/* --- TAGEBUCH TAB --- */}
        {activeTab === 'tagebuch' && (
          <div className="space-y-6 animate-in fade-in">
             <h2 className="text-xl font-black text-[#3A3A3A] mb-4">Pflegetagebuch</h2>
             
             {/* Sub-Navigation */}
             <div className="flex bg-[#F9F7F4] p-1 rounded-2xl mb-6">
                <button onClick={()=>setTagebuchSubTab('vital')} className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${tagebuchSubTab === 'vital' ? 'bg-white shadow-sm text-[#b5a48b]' : 'text-gray-400'}`}>Vitalwerte</button>
                <button onClick={()=>setTagebuchSubTab('berichte')} className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${tagebuchSubTab === 'berichte' ? 'bg-white shadow-sm text-[#b5a48b]' : 'text-gray-400'}`}>Berichte</button>
             </div>

             {tagebuchSubTab === 'vital' && (
                 <div className="space-y-3">
                    <h3 className="text-xs font-black uppercase text-gray-400 mb-2 pl-2">Letzte Messwerte</h3>
                    {vitalDaten.length > 0 ? vitalDaten.map((v:any, i:number) => (
                        <div key={i} className="bg-white p-4 rounded-[2rem] flex justify-between items-center shadow-sm border border-gray-50">
                            <div className="flex items-center gap-4">
                                <div className="bg-[#dccfbc]/20 p-3 rounded-2xl text-[#b5a48b]"><Activity size={20}/></div>
                                <div>
                                    <p className="font-bold text-sm text-gray-800">{unbox(v.Typ)}</p>
                                    <p className="text-[10px] text-gray-400">{formatDate(v.Datum)}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-lg font-black text-[#3A3A3A]">{unbox(v.Wert)}</p>
                                <p className="text-[10px] uppercase font-bold text-gray-400">{unbox(v.Einheit)}</p>
                            </div>
                        </div>
                    )) : <p className="text-center text-gray-300 text-xs italic py-10">Keine Vitalwerte vorhanden.</p>}
                 </div>
             )}

             {tagebuchSubTab === 'berichte' && (
                 <div className="text-center py-10">
                     <FileText className="mx-auto text-gray-200 mb-4" size={48}/>
                     <p className="text-gray-400 text-sm">Keine Berichte verfügbar.</p>
                 </div>
             )}
          </div>
        )}

        {/* --- SERVICE TAB --- */}
        {activeTab === 'service' && (
          <div className="space-y-6 animate-in fade-in">
             <div className="mb-6">
                <h2 className="text-xl font-black text-[#3A3A3A]">Service-Center</h2>
                <p className="text-xs text-gray-400">Schnelle Hilfe bei Formalitäten</p>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <button onClick={()=>setActiveModal('rezept')} className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 text-left active:scale-95 transition-all">
                    <div className="bg-[#dccfbc]/20 w-12 h-12 rounded-2xl flex items-center justify-center text-[#b5a48b] mb-3"><FileText size={24}/></div>
                    <p className="font-bold text-sm leading-tight text-gray-800">Rezept<br/>anfordern</p>
                </button>
                <button onClick={()=>{setTerminStep(1); setActiveModal('termin');}} className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 text-left active:scale-95 transition-all">
                    <div className="bg-[#dccfbc]/20 w-12 h-12 rounded-2xl flex items-center justify-center text-[#b5a48b] mb-3"><RefreshCw size={24}/></div>
                    <p className="font-bold text-sm leading-tight text-gray-800">Termin<br/>ändern</p>
                </button>
             </div>

             <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 mt-6">
                <h3 className="font-black text-sm border-l-4 border-[#dccfbc] pl-3 mb-4 uppercase text-gray-400">Nachbestellung</h3>
                <input type="text" placeholder="z.B. Medikamenten-Name" className="w-full bg-[#F9F7F4] p-4 rounded-xl text-sm outline-none mb-3"/>
                <textarea placeholder="Anmerkungen..." className="w-full bg-[#F9F7F4] p-4 rounded-xl text-sm outline-none mb-4 h-24 resize-none"></textarea>
                <button className="w-full bg-[#d2c2ad] text-white font-bold py-4 rounded-xl uppercase text-xs tracking-widest">Bestellung absenden</button>
             </div>
          </div>
        )}

      </main>

      {/* --- KI BUTTON --- */}
      <button 
        onMouseDown={() => isDragging.current = true}
        onTouchStart={() => isDragging.current = true}
        onClick={() => { if (!isDragging.current) setActiveModal('ki-telefon'); }}
        style={{ right: kiPos.x, bottom: kiPos.y, touchAction: 'none' }}
        className="fixed z-[60] w-20 h-20 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-4 border-white animate-slow-blink cursor-move active:scale-90 transition-transform"
      >
        <Mic size={24} fill="white" />
        <span className="text-[10px] font-bold text-center mt-0.5 leading-none">KI 24/7<br/>Hilfe</span>
      </button>

      {/* --- NAVIGATION --- */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-gray-50 flex justify-around p-5 pb-11 rounded-t-[3rem] shadow-2xl z-50">
        {[{ id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' }, { id: 'planer', icon: CalendarDays, label: 'Planer' }, { id: 'tagebuch', icon: ClipboardList, label: 'Tagebuch' }, { id: 'service', icon: Settings, label: 'Service' }].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === tab.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}><tab.icon size={22} strokeWidth={activeTab === tab.id ? 3 : 2} /><span className="text-[10px] font-black uppercase tracking-tighter">{tab.label}</span></button>
        ))}
      </nav>

      {/* --- MODALS --- */}
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
          {activeModal === 'ki-telefon' ? (
             <div className="bg-white w-full max-w-md h-[85vh] rounded-[3rem] overflow-hidden relative shadow-2xl animate-in slide-in-from-bottom-10"><iframe src="https://app.centrals.ai/centrals/embed/Pflegedienst" width="100%" height="100%" className="border-none" /><button onClick={()=>setActiveModal(null)} className="absolute top-6 right-6 bg-white/30 backdrop-blur-md p-3 rounded-full text-white"><X/></button></div>
          ) : (
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left"><button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
              {activeModal === 'rezept' && (<div className="space-y-6"><h3 className="text-xl font-black flex items-center gap-3"><FileText className="text-[#dccfbc]"/> Rezept-Upload</h3><div className="border-2 border-dashed border-[#dccfbc] rounded-[2rem] p-8 text-center bg-[#F9F7F4] relative"><input type="file" multiple accept="image/*,.pdf" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} className="absolute inset-0 opacity-0 cursor-pointer" /><Upload className="mx-auto text-[#dccfbc] mb-2" size={32}/><p className="text-xs font-black text-[#b5a48b] uppercase tracking-widest">{selectedFiles.length > 0 ? `${selectedFiles.length} ausgewählt` : "Klicken zum Hochladen"}</p></div><button onClick={() => submitService('Rezept anfordern')} disabled={isSending || selectedFiles.length === 0} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-lg">{sentStatus === 'success' ? 'Gesendet!' : 'Rezept senden'}</button></div>)}
              {activeModal === 'termin' && (<div className="space-y-6 text-left"><h3 className="text-xl font-black flex items-center gap-3"><RefreshCw className="text-[#dccfbc]"/> Termin ändern</h3>{terminStep === 1 ? (<div className="space-y-4"><input type="text" value={newTaetigkeit} onChange={(e)=>setNewTaetigkeit(e.target.value)} placeholder="Grund des Termins..." className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" /><button onClick={()=>setTerminStep(2)} disabled={!newTaetigkeit} className="w-full bg-[#dccfbc] text-white py-5 rounded-2xl font-black uppercase tracking-widest">Weiter</button></div>) : (<div className="space-y-4"><input type="date" value={newDatum} onChange={(e)=>setNewDatum(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none font-black" style={{ colorScheme: 'light' }} /><button onClick={() => submitService('Termin ändern')} disabled={!newDatum || isSending} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg">{sentStatus === 'success' ? 'Anfrage gesendet!' : 'Termin anfragen'}</button></div>)}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}