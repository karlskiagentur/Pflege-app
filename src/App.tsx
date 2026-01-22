import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, Settings, 
  Phone, User, RefreshCw, FileText, 
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, 
  ChevronRight, Send, Euro, FileCheck
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
  const [activeModal, setActiveModal] = useState<'upload' | 'termin' | 'ki-telefon' | null>(null);
  const [uploadContext, setUploadContext] = useState<'Rechnung' | 'Leistungsnachweis' | 'Rezept' | ''>(''); // Was wird hochgeladen?
  
  const [terminStep, setTerminStep] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [newTaetigkeit, setNewTaetigkeit] = useState("");
  const [newDatum, setNewDatum] = useState("");
  const [sonstigesMessage, setSonstigesMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'success' | 'error'>('idle');

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

  const submitService = async (type: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('patientId', patientId!);
      formData.append('patientName', unbox(patientData?.Name));
      formData.append('typ', type);
      formData.append('nachricht', sonstigesMessage);
      
      // Hinweis: File Upload würde hier die selectedFiles anhängen
      // selectedFiles.forEach(file => formData.append('files', file));

      const response = await fetch(`${N8N_BASE_URL}/service_submit`, { 
        method: 'POST', 
        body: formData 
      });

      if (response.ok) {
        setSentStatus('success');
        setSonstigesMessage("");
        setSelectedFiles([]);
        setTimeout(() => { setActiveModal(null); setSentStatus('idle'); }, 2000);
      }
    } catch (e) { setSentStatus('error'); }
    setIsSending(false);
  };

  // Hilfsfunktion zum Öffnen des Upload Modals
  const openUploadModal = (type: 'Rechnung' | 'Leistungsnachweis' | 'Rezept') => {
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

      <main className="max-w-md mx-auto px-6 pt-8">
        
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

        {/* NEU: HOCHLADEN TAB (Ehemals Tagebuch) */}
        {activeTab === 'hochladen' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="mb-6 text-center">
                <h2 className="text-3xl font-black tracking-tighter text-[#3A3A3A]">Dokumente</h2>
                <p className="text-xs text-gray-400 mt-2">Laden Sie hier Nachweise und Rechnungen direkt hoch.</p>
            </div>
            
            <div className="flex flex-col gap-5">
              {/* BUTTON 1: LEISTUNGSNACHWEISE */}
              <button 
                onClick={() => openUploadModal('Leistungsnachweis')}
                className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-50 flex items-center gap-6 active:scale-95 transition-all text-left"
              >
                <div className="bg-[#dccfbc]/20 p-5 rounded-3xl text-[#b5a48b]">
                  <FileCheck size={40} strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-[#3A3A3A]">Leistungs-<br/>nachweise</h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Unterschrieben hochladen</p>
                </div>
                <div className="ml-auto bg-gray-50 p-3 rounded-full text-gray-300">
                  <ChevronRight size={20} />
                </div>
              </button>

              {/* BUTTON 2: RECHNUNGEN */}
              <button 
                onClick={() => openUploadModal('Rechnung')}
                className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-50 flex items-center gap-6 active:scale-95 transition-all text-left"
              >
                <div className="bg-[#dccfbc]/20 p-5 rounded-3xl text-[#b5a48b]">
                  <Euro size={40} strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-[#3A3A3A]">Rechnungen<br/>einreichen</h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Hier Foto/PDF senden</p>
                </div>
                <div className="ml-auto bg-gray-50 p-3 rounded-full text-gray-300">
                  <ChevronRight size={20} />
                </div>
              </button>
            </div>
            
            <div className="bg-[#dccfbc]/10 rounded-[2rem] p-6 text-center mt-4">
               <p className="text-[#b5a48b] text-xs">Fragen zu Ihren Dokumenten?</p>
               <button onClick={()=>setActiveModal('ki-telefon')} className="mt-2 text-[#b5a48b] font-black uppercase text-xs underline">KI-Assistent fragen</button>
            </div>
          </div>
        )}

        {/* SERVICE TAB */}
        {activeTab === 'service' && (
          <div className="space-y-6 animate-in fade-in">
            <h2 className="text-3xl font-black tracking-tighter mb-8">Service-Center</h2>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => openUploadModal('Rezept')} className="bg-white rounded-[2.5rem] p-8 shadow-sm flex flex-col items-center gap-4 border border-gray-50 active:scale-95 transition-all">
                <div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b]"><FileText size={32} /></div>
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Rezept</span>
              </button>
              <button onClick={() => { setActiveModal('termin'); setTerminStep(1); }} className="bg-white rounded-[2.5rem] p-8 shadow-sm flex flex-col items-center gap-4 border border-gray-50 active:scale-95 transition-all">
                <div className="bg-[#dccfbc]/20 p-4 rounded-2xl text-[#b5a48b]"><RefreshCw size={32} /></div>
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Termin</span>
              </button>
            </div>
            <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 mt-6 text-left">
              <h3 className="font-black mb-4 text-xs uppercase text-[#b5a48b] tracking-widest">Nachbestellung / Sonstiges</h3>
              <textarea 
                value={sonstigesMessage} 
                onChange={(e) => setSonstigesMessage(e.target.value)} 
                placeholder="Benötigen Sie Medikamente oder Pflegehilfsmittel?" 
                className="w-full bg-[#F9F7F4] rounded-2xl p-5 text-sm h-40 outline-none border-none resize-none mb-4 text-left font-medium" 
              />
              <button 
                onClick={() => submitService('Nachbestellung')} 
                disabled={isSending || !sonstigesMessage.trim()} 
                className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50"
              >
                {isSending ? <RefreshCw className="animate-spin" /> : <Send size={18} />}
                {sentStatus === 'success' ? 'Gesendet!' : 'Nachricht senden'}
              </button>
            </div>
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

      {/* NAVIGATION - NEU: "HOCHLADEN" statt TAGEBUCH */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-gray-50 flex justify-around p-5 pb-11 rounded-t-[3rem] shadow-2xl z-50">
        {[
          { id: 'dashboard', icon: LayoutDashboard, label: 'Home' }, 
          { id: 'planer', icon: CalendarDays, label: 'Planer' }, 
          { id: 'hochladen', icon: Upload, label: 'Hochladen' }, // UPDATED ICON & LABEL
          { id: 'service', icon: Settings, label: 'Service' }
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === tab.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}><tab.icon size={22} strokeWidth={activeTab === tab.id ? 3 : 2} /><span className="text-[10px] font-black uppercase tracking-tighter">{tab.label}</span></button>
        ))}
      </nav>

      {/* MODALS */}
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
          
          {/* KI CHAT */}
          {activeModal === 'ki-telefon' && (
             <div className="bg-white w-full max-w-md h-[85vh] rounded-[3rem] overflow-hidden relative shadow-2xl animate-in slide-in-from-bottom-10"><iframe src="https://app.centrals.ai/centrals/embed/Pflegedienst" width="100%" height="100%" className="border-none" /><button onClick={()=>setActiveModal(null)} className="absolute top-6 right-6 bg-white/30 backdrop-blur-md p-3 rounded-full text-white"><X/></button></div>
          )}

          {/* UPLOAD MODAL (Dynamisch für Rezept, Rechnung, Nachweis) */}
          {activeModal === 'upload' && (
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left">
              <button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
              <div className="space-y-6">
                <h3 className="text-xl font-black flex items-center gap-3">
                  {/* Icon basierend auf Kontext */}
                  {uploadContext === 'Rechnung' ? <Euro className="text-[#dccfbc]"/> : <FileText className="text-[#dccfbc]"/>} 
                  {uploadContext} hochladen
                </h3>
                <div className="border-2 border-dashed border-[#dccfbc] rounded-[2rem] p-8 text-center bg-[#F9F7F4] relative">
                  <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} className="absolute inset-0 opacity-0 cursor-pointer" />
                  <Upload className="mx-auto text-[#dccfbc] mb-2" size={32}/>
                  <p className="text-xs font-black text-[#b5a48b] uppercase tracking-widest">{selectedFiles.length > 0 ? `${selectedFiles.length} ausgewählt` : "Klicken zum Hochladen"}</p>
                </div>
                <button 
                  onClick={() => submitService(uploadContext + '-Upload')} 
                  disabled={isSending || selectedFiles.length === 0} 
                  className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-lg flex justify-center items-center gap-2"
                >
                  {isSending && <RefreshCw className="animate-spin" size={16}/>}
                  {sentStatus === 'success' ? 'Gesendet!' : 'Absenden'}
                </button>
              </div>
            </div>
          )}

          {/* TERMIN MODAL */}
          {activeModal === 'termin' && (
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left">
              <button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
              <div className="space-y-6 text-left">
                <h3 className="text-xl font-black flex items-center gap-3"><RefreshCw className="text-[#dccfbc]"/> Termin ändern</h3>
                {terminStep === 1 ? (
                  <div className="space-y-4">
                    <input type="text" value={newTaetigkeit} onChange={(e)=>setNewTaetigkeit(e.target.value)} placeholder="Welcher Termin soll geändert werden?" className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" />
                    <button onClick={()=>setTerminStep(2)} disabled={!newTaetigkeit} className="w-full bg-[#dccfbc] text-white py-5 rounded-2xl font-black uppercase tracking-widest">Weiter</button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <input type="date" value={newDatum} onChange={(e)=>setNewDatum(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none font-black" style={{ colorScheme: 'light' }} />
                    <button onClick={() => submitService('Termin-Änderung')} disabled={!newDatum || isSending} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg">Anfrage senden</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}