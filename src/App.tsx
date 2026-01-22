import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, 
  Phone, User, RefreshCw, FileText, 
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, 
  ChevronRight, Send, Euro, FileCheck, PlayCircle, Plane, Play
} from 'lucide-react';

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
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  } catch { return val; }
};

const formatTime = (raw: any) => {
  const val = unbox(raw);
  if (!val) return "--:--";
  if (val.includes('T')) return val.split('T')[1].substring(0, 5);
  return val.substring(0, 5);
};

export default function App() {
  // --- STATES ---
  const [patientId, setPatientId] = useState<string | null>(localStorage.getItem('active_patient_id'));
  const [fullName, setFullName] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  
  // Daten States
  const [patientData, setPatientData] = useState<any>(null);
  const [contactData, setContactData] = useState<any[]>([]);
  const [besuche, setBesuche] = useState<any[]>([]);
  
  // UI States für Modals & Uploads
  const [activeModal, setActiveModal] = useState<'upload' | 'video' | 'ki-telefon' | null>(null);
  const [uploadContext, setUploadContext] = useState<'Rechnung' | 'Leistungsnachweis' | ''>(''); 
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // URLAUB STATE
  const [urlaubStart, setUrlaubStart] = useState("");
  const [urlaubEnde, setUrlaubEnde] = useState("");

  // Draggable Button Logic
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

  const fetchData = async () => {
    if (!patientId) return;
    try {
      setLoading(true);
      const [resP, resC, resB] = await Promise.all([
        fetch(`${N8N_BASE_URL}/get_data_patienten?patientId=${patientId}`),
        fetch(`${N8N_BASE_URL}/get_data_kontakte?patientId=${patientId}`),
        fetch(`${N8N_BASE_URL}/get_data_besuche?patientId=${patientId}`),
      ]);
      
      const jsonP = await resP.json(); 
      const jsonC = await resC.json();
      const jsonB = await resB.json(); 

      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      
      const extract = (json: any) => {
        if (json.data && Array.isArray(json.data) && json.data[0]?.data) return json.data[0].data;
        if (json.data && Array.isArray(json.data)) return json.data;
        if (Array.isArray(json)) return json;
        return [];
      };

      setContactData(extract(jsonC));
      setBesuche(extract(jsonB).sort((a:any, b:any) => new Date(unbox(a.Datum)).getTime() - new Date(unbox(b.Datum)).getTime()));

    } catch (e) { console.error(e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

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
      } else { setLoginError(true); }
    } catch (e) { setLoginError(true); }
    finally { setIsLoggingIn(false); }
  };

  // Allgemeine Submit Funktion
  const submitData = async (type: string, payload: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('patientId', patientId!);
      formData.append('patientName', unbox(patientData?.Name));
      formData.append('typ', type);
      formData.append('nachricht', payload);
      
      const response = await fetch(`${N8N_BASE_URL}/service_submit`, { 
        method: 'POST', 
        body: formData 
      });

      if (response.ok) {
        setSentStatus('success');
        setSelectedFiles([]);
        setTimeout(() => { 
            setActiveModal(null); 
            setSentStatus('idle'); 
            setUrlaubStart("");
            setUrlaubEnde("");
        }, 2000);
      }
    } catch (e) { setSentStatus('error'); }
    setIsSending(false);
  };

  const openUploadModal = (type: 'Rechnung' | 'Leistungsnachweis') => {
    setUploadContext(type);
    setSelectedFiles([]);
    setSentStatus('idle');
    setActiveModal('upload');
  };

  if (!patientId) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6 text-left">
        <div className="w-full max-w-sm text-center">
          <div className="w-64 h-64 mx-auto mb-1"><img src="/logo.png" alt="Logo" className="w-full h-full object-contain" /></div>
          <form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl space-y-4 text-left">
            <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" placeholder="Vollständiger Name" required />
            <input type="password" inputMode="numeric" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" placeholder="Login-Code" required />
            <button type="submit" className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold uppercase shadow-lg">Anmelden</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen bg-white font-sans pb-32 text-[#3A3A3A] text-left select-none"
      onMouseMove={handleDrag} onTouchMove={handleDrag}
      onMouseUp={() => isDragging.current = false} onTouchEnd={() => isDragging.current = false}
    >
      <header className="py-4 px-6 bg-[#dccfbc] text-white shadow-sm flex justify-between items-center">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11 w-auto object-contain" />
        <div className="flex flex-col items-end">
          <button onClick={() => { localStorage.clear(); setPatientId(null); }} className="bg-white/20 p-2 rounded-full text-white mb-1"><LogOut size={18}/></button>
          <p className="text-sm font-bold italic opacity-90">{unbox(patientData?.Name)}</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 pt-6">
        
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center">
               <div><p className="text-[10px] uppercase font-bold opacity-80 mb-1 tracking-widest">Status</p><h2 className="text-3xl font-black">{unbox(patientData?.Pflegegrad)}</h2></div>
               <div className="bg-white/20 p-4 rounded-2xl"><CalendarIcon size={28}/></div>
            </div>
            <section className="space-y-6">
              <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Stammdaten</h3>
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-4">
                <div className="flex justify-between items-end border-b border-gray-50 pb-3"><span className="text-sm text-gray-400">Geburtsdatum</span><span className="text-sm font-bold text-gray-800">{formatDate(patientData?.Geburtsdatum)}</span></div>
                <div className="flex justify-between items-end border-b border-gray-50 pb-3"><span className="text-sm text-gray-400">Versicherung</span><span className="text-sm font-bold text-gray-800">{unbox(patientData?.Versicherung)}</span></div>
                <div className="pt-2"><p className="text-sm text-gray-400 mb-1 text-left">Anschrift</p><p className="text-sm font-bold text-gray-800 leading-snug text-left">{unbox(patientData?.Anschrift)}</p></div>
              </div>
            </section>
            <section className="space-y-6">
              <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Kontakte</h3>
              <div className="space-y-3">
                {contactData.map((c: any, i: number) => (
                  <div key={i} className="bg-white rounded-[2rem] p-4 flex items-center justify-between shadow-sm border border-gray-100">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-[#F9F7F4] rounded-2xl flex items-center justify-center font-black text-[#dccfbc] text-lg">{unbox(c.Name)[0]}</div>
                      <div className="text-left"><p className="font-black text-lg leading-tight">{unbox(c.Name)}</p><p className="text-[10px] font-bold text-gray-400 uppercase">{unbox(c['Rolle/Funktion'])}</p></div>
                    </div>
                    {unbox(c.Telefon) && <a href={`tel:${unbox(c.Telefon)}`} className="bg-[#dccfbc]/10 p-3 rounded-full text-[#b5a48b]"><Phone size={20} fill="#b5a48b" /></a>}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* PLANER TAB */}
        {activeTab === 'planer' && (
          <div className="space-y-6 animate-in fade-in">
            <h2 className="text-3xl font-black tracking-tighter">Besuchs-Planer</h2>
            {besuche.map((b, i) => (
              <div key={i} className="bg-white rounded-[2rem] p-6 flex items-center gap-6 shadow-sm border border-gray-100">
                <div className="text-center min-w-[60px]"><p className="text-xl font-bold text-gray-300">{formatTime(b.Uhrzeit)}</p><p className="text-[10px] text-gray-400 font-bold uppercase">UHR</p></div>
                <div className="flex-1 border-l border-gray-100 pl-5 text-left"><p className="font-black text-[#3A3A3A] text-lg mb-2">{unbox(b.Tätigkeit)}</p><div className="flex items-center gap-2"><User size={12} className="text-gray-400"/><p className="text-sm text-gray-500">{unbox(b.Pfleger_Name) || "Zuweisung folgt"}</p></div><p className="text-[10px] text-[#b5a48b] mt-3 font-bold uppercase tracking-wider text-left">Am {formatDate(b.Datum)}</p></div>
              </div>
            ))}
          </div>
        )}

        {/* TAB: HOCHLADEN (Größe: -10% vom Original, Play Button neu) */}
        {activeTab === 'hochladen' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="mb-5 text-center">
                <h2 className="text-2xl font-black tracking-tighter text-[#3A3A3A]">Dokumente</h2>
                <p className="text-xs text-gray-400 mt-1">Senden Sie uns hier Ihre Unterlagen.</p>
            </div>
            
            <div className="flex flex-col gap-4">
              {/* BUTTON 1: LEISTUNGSNACHWEISE (Padding 7 = ca. 10% weniger als 8) */}
              <button 
                onClick={() => openUploadModal('Leistungsnachweis')}
                className="bg-white rounded-[2.2rem] p-7 shadow-sm border border-gray-50 flex items-center gap-5 active:scale-95 transition-all text-left"
              >
                <div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b] shrink-0">
                  <FileCheck size={36} strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-black text-[#3A3A3A] leading-tight">Leistungs-<br/>nachweise</h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Unterschrieben</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-full text-gray-300">
                  <ChevronRight size={20} />
                </div>
              </button>

              {/* BUTTON 2: RECHNUNGEN */}
              <button 
                onClick={() => openUploadModal('Rechnung')}
                className="bg-white rounded-[2.2rem] p-7 shadow-sm border border-gray-50 flex items-center gap-5 active:scale-95 transition-all text-left"
              >
                <div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b] shrink-0">
                  <Euro size={36} strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-black text-[#3A3A3A] leading-tight">Rechnungen<br/>einreichen</h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Foto oder PDF</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-full text-gray-300">
                  <ChevronRight size={20} />
                </div>
              </button>
            </div>
            
            {/* VIDEO BUTTON DAZWISCHEN (Mit Play Symbol) */}
            <div className="flex justify-center py-2">
                <button 
                    onClick={() => setActiveModal('video')}
                    className="flex items-center gap-2 bg-white px-6 py-3 rounded-full shadow-md border border-gray-100 text-[#b5a48b] text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform"
                >
                    <Play size={14} fill="#b5a48b" className="text-[#b5a48b]" />
                    So funktioniert's
                </button>
            </div>
            
            <div className="bg-[#dccfbc]/10 rounded-[1.5rem] p-5 text-center mt-2">
               <p className="text-[#b5a48b] text-xs">Fragen zu Ihren Dokumenten?</p>
               <button onClick={()=>setActiveModal('ki-telefon')} className="mt-1 text-[#b5a48b] font-black uppercase text-xs underline">KI-Assistent fragen</button>
            </div>
          </div>
        )}

        {/* TAB: URLAUB (Text angepasst) */}
        {activeTab === 'urlaub' && (
          <div className="space-y-6 animate-in fade-in">
            <div className="mb-6 text-center">
                <div className="w-16 h-16 bg-[#F9F7F4] rounded-full flex items-center justify-center mx-auto mb-4">
                    <Plane size={32} className="text-[#b5a48b]" />
                </div>
                <h2 className="text-3xl font-black tracking-tighter text-[#3A3A3A]">Urlaubsplanung</h2>
                <p className="text-xs text-gray-400 mt-2 px-6">Teilen Sie uns ihre Urlaube/Abwesenheiten mit.</p>
            </div>

            <div className="bg-white rounded-[3rem] p-8 shadow-xl border border-gray-100 space-y-6">
                
                {/* START DATUM */}
                <div className="space-y-2 text-left">
                    <label className="text-[10px] font-black uppercase text-[#b5a48b] tracking-widest ml-2">Von wann (Erster Tag)</label>
                    <div className="bg-[#F9F7F4] p-2 rounded-2xl flex items-center px-4">
                        <CalendarIcon size={20} className="text-gray-400 mr-3"/>
                        <input 
                            type="date" 
                            value={urlaubStart} 
                            onChange={(e) => setUrlaubStart(e.target.value)}
                            className="bg-transparent w-full py-3 outline-none text-gray-700 font-bold"
                            style={{ colorScheme: 'light' }}
                        />
                    </div>
                </div>

                {/* ENDE DATUM */}
                <div className="space-y-2 text-left">
                    <label className="text-[10px] font-black uppercase text-[#b5a48b] tracking-widest ml-2">Bis wann (Letzter Tag)</label>
                    <div className="bg-[#F9F7F4] p-2 rounded-2xl flex items-center px-4">
                        <CalendarIcon size={20} className="text-gray-400 mr-3"/>
                        <input 
                            type="date" 
                            value={urlaubEnde} 
                            onChange={(e) => setUrlaubEnde(e.target.value)}
                            className="bg-transparent w-full py-3 outline-none text-gray-700 font-bold"
                            style={{ colorScheme: 'light' }}
                        />
                    </div>
                </div>

                {/* INFO BOX */}
                {(urlaubStart && urlaubEnde) && (
                    <div className="bg-[#dccfbc]/10 p-4 rounded-2xl text-center">
                        <p className="text-[#b5a48b] text-xs font-bold">
                            Zeitraum ausgewählt: {new Date(urlaubStart).toLocaleDateString()} - {new Date(urlaubEnde).toLocaleDateString()}
                        </p>
                    </div>
                )}

                <button 
                    onClick={() => submitData('Urlaubsmeldung', `Urlaub von ${urlaubStart} bis ${urlaubEnde}`)} 
                    disabled={isSending || !urlaubStart || !urlaubEnde} 
                    className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50 mt-4"
                >
                    {isSending ? <RefreshCw className="animate-spin" /> : <Send size={18} />}
                    {sentStatus === 'success' ? 'Eingetragen!' : 'Urlaub eintragen'}
                </button>
            </div>

            <p className="text-[10px] text-gray-300 text-center px-10">
                Hinweis: Pflegeeinsätze werden für diesen Zeitraum automatisch pausiert.
            </p>
          </div>
        )}
      </main>

      {/* KI BUTTON */}
      <button 
        onMouseDown={() => isDragging.current = true} onTouchStart={() => isDragging.current = true}
        onClick={() => { if (!isDragging.current) setActiveModal('ki-telefon'); }}
        style={{ right: kiPos.x, bottom: kiPos.y, touchAction: 'none' }}
        className="fixed z-[60] w-20 h-20 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-4 border-white cursor-move active:scale-90 transition-transform"
      ><Mic size={24} fill="white" /><span className="text-[10px] font-bold text-center mt-0.5 leading-none">KI 24/7<br/>Hilfe</span></button>

      {/* NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-gray-50 flex justify-around p-5 pb-11 rounded-t-[3rem] shadow-2xl z-50">
        {[
          { id: 'dashboard', icon: LayoutDashboard, label: 'Home' }, 
          { id: 'planer', icon: CalendarDays, label: 'Planer' }, 
          { id: 'hochladen', icon: Upload, label: 'Hochladen' }, 
          { id: 'urlaub', icon: Plane, label: 'Urlaub' }
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === tab.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}><tab.icon size={22} strokeWidth={activeTab === tab.id ? 3 : 2} /><span className="text-[10px] font-black uppercase tracking-tighter">{tab.label}</span></button>
        ))}
      </nav>

      {/* MODALS */}
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
          
          {/* VIDEO POPUP */}
          {activeModal === 'video' && (
             <div className="bg-black w-full max-w-md h-[50vh] rounded-[2rem] overflow-hidden relative shadow-2xl animate-in zoom-in-95 flex items-center justify-center">
                 <button onClick={()=>setActiveModal(null)} className="absolute top-4 right-4 bg-white/20 backdrop-blur-md p-2 rounded-full text-white z-20"><X size={20}/></button>
                 <div className="text-white text-center">
                     <PlayCircle size={64} className="mx-auto mb-4 opacity-50"/>
                     <p className="font-bold">Erklärvideo wird geladen...</p>
                 </div>
             </div>
          )}

          {/* KI CHAT */}
          {activeModal === 'ki-telefon' && (
             <div className="bg-white w-full max-w-md h-[85vh] rounded-[3rem] overflow-hidden relative shadow-2xl animate-in slide-in-from-bottom-10"><iframe src="https://app.centrals.ai/centrals/embed/Pflegedienst" width="100%" height="100%" className="border-none" /><button onClick={()=>setActiveModal(null)} className="absolute top-6 right-6 bg-white/30 backdrop-blur-md p-3 rounded-full text-white"><X/></button></div>
          )}

          {/* UPLOAD MODAL */}
          {activeModal === 'upload' && (
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left">
              <button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
              <div className="space-y-6">
                <h3 className="text-xl font-black flex items-center gap-3">
                  {uploadContext === 'Rechnung' ? <Euro className="text-[#dccfbc]"/> : <FileText className="text-[#dccfbc]"/>} 
                  {uploadContext} hochladen
                </h3>
                <div className="border-2 border-dashed border-[#dccfbc] rounded-[2rem] p-8 text-center bg-[#F9F7F4] relative">
                  <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} className="absolute inset-0 opacity-0 cursor-pointer" />
                  <Upload className="mx-auto text-[#dccfbc] mb-2" size={32}/>
                  <p className="text-xs font-black text-[#b5a48b] uppercase tracking-widest">{selectedFiles.length > 0 ? `${selectedFiles.length} ausgewählt` : "Klicken zum Hochladen"}</p>
                </div>
                <button 
                  onClick={() => submitData(uploadContext + '-Upload', 'Datei Upload')} 
                  disabled={isSending || selectedFiles.length === 0} 
                  className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-lg flex justify-center items-center gap-2"
                >
                  {isSending && <RefreshCw className="animate-spin" size={16}/>}
                  {sentStatus === 'success' ? 'Gesendet!' : 'Absenden'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}