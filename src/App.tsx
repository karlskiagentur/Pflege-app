import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, CalendarDays, ClipboardList, Settings, 
  Phone, Heart, User, RefreshCw, FileText, Activity,
  X, Upload, Mic, Lock, LogOut, Calendar as CalendarIcon
} from 'lucide-react';

const N8N_BASE_URL = 'https://karlskiagentur.app.n8n.cloud/webhook';

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
  if (val.includes('T')) return val.split('T')[1].substring(0, 5);
  return val;
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
  const [patientData, setPatientData] = useState<any>(null);
  const [contactData, setContactData] = useState<any>(null);
  const [besuche, setBesuche] = useState<any[]>([]);
  const [vitalDaten, setVitalDaten] = useState<any[]>([]);
  
  const [activeModal, setActiveModal] = useState<'rezept' | 'termin' | 'ki-telefon' | null>(null);
  const [terminStep, setTerminStep] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [newTaetigkeit, setNewTaetigkeit] = useState("");
  const [newDatum, setNewDatum] = useState("");
  const [sonstigesMessage, setSonstigesMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(false);
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
    setPatientData(null);
    setActiveTab('dashboard');
  };

  const fetchData = async () => {
    if (!patientId) return;
    try {
      setLoading(true);
      const [resP, resC, resB, resV] = await Promise.all([
        fetch(`${N8N_BASE_URL}/get_data_patienten?patientId=${patientId}`),
        fetch(`${N8N_BASE_URL}/get_data_kontakte?patientId=${patientId}`),
        fetch(`${N8N_BASE_URL}/get_data_besuche?patientId=${patientId}`),
        fetch(`${N8N_BASE_URL}/get_data_vitalwerte?patientId=${patientId}`)
      ]);
      const jsonP = await resP.json(); const jsonC = await resC.json();
      const jsonB = await resB.json(); const jsonV = await resV.json();
      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      if (jsonC.status === "success") setContactData(Array.isArray(jsonC.data) ? jsonC.data : [jsonC.data]);
      setBesuche(Array.isArray(jsonB.data) ? jsonB.data : []);
      setVitalDaten(Array.isArray(jsonV.data) ? jsonV.data : []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

  const submitService = async (type: string) => {
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('patientId', patientId!);
      formData.append('patientName', unbox(patientData?.Name));
      formData.append('typ', type);
      const response = await fetch(`${N8N_BASE_URL}/service_submit`, { method: 'POST', body: formData });
      if (response.ok) {
        setSentStatus('success');
        setTimeout(() => { setActiveModal(null); setSentStatus('idle'); }, 2000);
      }
    } catch (e) { setSentStatus('error'); }
    setIsSending(false);
  };

  if (!patientId) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6 text-left">
        <div className="w-full max-w-sm space-y-8 text-center">
          <div>
            <div className="w-64 h-64 flex items-center justify-center mx-auto mb-2">
                <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <p className="text-gray-400 font-medium mb-6">Patienten-Portal Login</p>
          </div>
          <form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl space-y-4">
            <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none border-none font-medium" placeholder="Vollständiger Name" required />
            <input type="password" inputMode="numeric" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none border-none tracking-widest font-medium" placeholder="Login-Code" required />
            <button type="submit" className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold shadow-lg uppercase tracking-widest text-sm">Anmelden</button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F9F7F4]"><RefreshCw className="animate-spin text-[#b5a48b]" size={40} /></div>;

  return (
    <div className="min-h-screen bg-white font-sans pb-32 text-[#3A3A3A] text-left">
      <style>{`
        @keyframes slow-blink { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.9; } }
        .animate-slow-blink { animation: slow-blink 3s infinite ease-in-out; }
      `}</style>
      <header className="py-4 px-6 bg-[#dccfbc] text-white shadow-sm relative flex justify-between items-center">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11 w-auto object-contain" />
        <div className="flex flex-col items-end">
          <button onClick={handleLogout} className="bg-white/20 p-2 rounded-full text-white mb-1"><LogOut size={18}/></button>
          <p className="text-sm font-bold italic opacity-90 text-right leading-tight">{unbox(patientData?.Name)}</p>
        </div>
      </header>
      <main className="max-w-md mx-auto px-6 pt-8">
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center">
               <div><p className="text-[10px] uppercase font-bold opacity-80 mb-1">Status</p><h2 className="text-3xl font-black">{unbox(patientData?.Pflegegrad)}</h2></div>
               <div className="bg-white/20 p-4 rounded-2xl"><CalendarIcon size={28}/></div>
            </div>
            <section className="space-y-6">
              <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Stammdaten</h3>
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-4">
                <div className="flex justify-between items-end border-b border-gray-50 pb-3"><span className="text-sm text-gray-400">Geburtsdatum</span><span className="text-sm font-bold text-gray-800">{formatDate(patientData?.Geburtsdatum)}</span></div>
                <div className="flex justify-between items-end border-b border-gray-50 pb-3"><span className="text-sm text-gray-400">Versicherung</span><span className="text-sm font-bold text-gray-800">{unbox(patientData?.Versicherung)}</span></div>
                <div className="pt-2"><p className="text-sm text-gray-400 mb-1">Anschrift</p><p className="text-sm font-bold text-gray-800 leading-snug">{unbox(patientData?.Anschrift)}</p></div>
              </div>
            </section>
            <section className="space-y-6">
              <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Kontakte</h3>
              <div className="space-y-3">
                {contactData && contactData.map((c: any, i: number) => (
                  <div key={i} className="bg-white rounded-[2rem] p-4 flex items-center justify-between shadow-sm border border-gray-100">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-[#F9F7F4] rounded-2xl flex items-center justify-center font-black text-[#dccfbc] text-lg">{unbox(c.name)[0]}</div>
                      <div><p className="font-black text-lg text-left">{unbox(c.name)}</p><p className="text-[10px] font-bold text-gray-400 uppercase text-left">{unbox(c.rolle)}</p></div>
                    </div>
                    {c.telefon && <a href={`tel:${unbox(c.telefon)}`} className="bg-[#dccfbc]/10 p-3 rounded-full text-[#b5a48b]"><Phone size={20} fill="#b5a48b" /></a>}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
        {activeTab === 'tagebuch' && (
          <div className="space-y-8 animate-in fade-in">
            <h2 className="text-3xl font-black tracking-tighter">Pflegetagebuch</h2>
            <div className="bg-gray-100/50 p-1.5 rounded-[1.5rem] flex border border-gray-100">
              <button onClick={() => setTagebuchSubTab('vital')} className={`flex-1 py-4 rounded-2xl text-sm font-black transition-all ${tagebuchSubTab === 'vital' ? 'bg-white shadow-md text-[#b5a48b]' : 'text-gray-400'}`}>Vitalwerte</button>
              <button onClick={() => setTagebuchSubTab('berichte')} className={`flex-1 py-4 rounded-2xl text-sm font-black transition-all ${tagebuchSubTab === 'berichte' ? 'bg-white shadow-md text-[#b5a48b]' : 'text-gray-400'}`}>Berichte</button>
            </div>
            {tagebuchSubTab === 'vital' ? (
              <div className="space-y-8">
                <h3 className="font-black text-lg text-[#3A3A3A] pl-2 -mb-4 text-left">Pulsverlauf (Letzte 5 Tage)</h3>
                <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-50 relative overflow-hidden">
                  <div className="h-40 relative flex items-end justify-between px-2">
                    <div className="absolute left-0 h-full flex flex-col justify-between text-[10px] font-bold text-gray-300 pointer-events-none py-1 z-20"><span>120</span><span>100</span><span>80</span><span>60</span><span>40</span></div>
                    <svg className="absolute inset-0 w-full h-full px-10 py-4" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <line x1="0" y1="0" x2="100" y2="0" stroke="#f3f3f3" strokeWidth="0.5" /><line x1="0" y1="25" x2="100" y2="25" stroke="#f3f3f3" strokeWidth="0.5" /><line x1="0" y1="50" x2="100" y2="50" stroke="#f3f3f3" strokeWidth="0.5" /><line x1="0" y1="75" x2="100" y2="75" stroke="#f3f3f3" strokeWidth="0.5" /><line x1="0" y1="100" x2="100" y2="100" stroke="#f3f3f3" strokeWidth="0.5" />
                      <polyline fill="none" stroke="#dccfbc" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={vitalDaten.filter(v=>v.PULS).slice(0,5).map((v,idx)=> { const val = Number(v.PULS); const y = 100 - ((val - 40) / 80) * 100; return `${idx*25},${y}`; }).join(' ')} />
                    </svg>
                    {['Fr', 'Do', 'Mi', 'Di', 'Mo'].map((day, i) => (<div key={i} className="flex flex-col items-center gap-3 z-10"><div className="w-2.5 h-2.5 rounded-full bg-[#b5a48b] border-2 border-white"></div><span className="text-[10px] font-bold text-gray-400 uppercase">{day}</span></div>))}
                  </div>
                </div>
                <h3 className="font-black text-lg text-[#3A3A3A] pl-2 -mb-4 text-left">Letzte Messwerte</h3>
                <div className="space-y-4">
                  {vitalDaten.slice(0, 3).map((v, i) => (
                    <div key={i} className="bg-white rounded-[2rem] p-7 shadow-sm border border-gray-50 flex items-center justify-between">
                      <span className="font-black text-lg text-gray-400">{formatDate(v.Zeitpunkt, true)}</span>
                      <div className="flex gap-8"><div className="text-center"><p className="text-[8px] font-black text-gray-300 uppercase mb-1">RR</p><p className="text-sm font-black text-gray-600">{v['RR (Blutdruck)'] || "-"}</p></div><div className="text-center"><p className="text-[8px] font-black text-gray-300 uppercase mb-1">Puls</p><p className="text-sm font-black text-gray-600">{v.PULS || "-"}</p></div></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (<div className="space-y-4">{vitalDaten.filter(v => unbox(v.Berichtstext)).map((v, i) => (<div key={i} className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-50 text-left"><div className="flex justify-between items-center mb-2"><span className="text-[10px] font-black text-[#b5a48b] uppercase">{unbox(v.Typ) || "Bericht"}</span><span className="text-[10px] text-gray-300 font-bold">{formatDate(v.Zeitpunkt)}</span></div><p className="text-sm text-gray-600 italic">"{unbox(v.Berichtstext)}"</p></div>))}</div>)}
          </div>
        )}
        {activeTab === 'planer' && (
          <div className="space-y-6 animate-in fade-in text-left">
            <h2 className="text-3xl font-black tracking-tighter">Besuchs-Planer</h2>
            {besuche.map((b, i) => (
              <div key={i} className="bg-white rounded-[2rem] p-6 flex items-center gap-6 shadow-sm border border-gray-100">
                <div className="text-center min-w-[60px]"><p className="text-xl font-bold text-gray-300">{formatTime(b.Uhrzeit)}</p><p className="text-[10px] text-gray-400 font-bold uppercase">UHR</p></div>
                <div className="flex-1 border-l border-gray-100 pl-5"><p className="font-black text-[#3A3A3A] text-lg mb-2">{unbox(b.Tätigkeit)}</p><div className="flex items-center gap-2"><User size={12} className="text-gray-400"/><p className="text-sm text-gray-500">{unbox(b.Pfleger_Name) || "Zuweisung folgt"}</p></div><p className="text-[10px] text-[#b5a48b] mt-3 font-bold uppercase">Am {formatDate(b.Datum)}</p></div>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'service' && (
          <div className="space-y-6 animate-in fade-in text-left">
            <h2 className="text-3xl font-black tracking-tighter">Service-Center</h2>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setActiveModal('rezept')} className="bg-white rounded-3xl p-6 shadow-sm flex flex-col items-center gap-3 border"><FileText className="text-[#dccfbc]" size={32} /><span className="text-[10px] font-black uppercase">Rezept</span></button>
              <button onClick={() => { setActiveModal('termin'); setTerminStep(1); }} className="bg-white rounded-3xl p-6 shadow-sm flex flex-col items-center gap-3 border"><RefreshCw className="text-[#dccfbc]" size={32} /><span className="text-[10px] font-black uppercase">Termin</span></button>
            </div>
            <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 mt-4"><h3 className="font-black mb-4 text-xs uppercase text-[#b5a48b]">Nachricht an das Team</h3><textarea value={sonstigesMessage} onChange={(e) => setSonstigesMessage(e.target.value)} placeholder="Wie können wir helfen?" className="w-full bg-[#F9F7F4] rounded-2xl p-4 text-sm h-32 outline-none border-none resize-none mb-4" /><button onClick={() => submitService('Sonstiges')} disabled={isSending || !sonstigesMessage.trim()} className="w-full bg-[#dccfbc] text-white py-5 rounded-2xl font-black uppercase shadow-md disabled:bg-gray-100">Nachricht senden</button></div>
          </div>
        )}
      </main>
      <button onClick={() => setActiveModal('ki-telefon')} className="fixed right-6 bottom-32 z-[60] w-20 h-20 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-4 border-white animate-slow-blink"><Mic size={24} fill="white" /><span className="text-[10px] font-bold text-center mt-0.5 leading-none">KI 24/7<br/>Hilfe</span></button>
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-gray-50 flex justify-around p-5 pb-11 rounded-t-[3rem] shadow-2xl z-50">
        {[{ id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' }, { id: 'planer', icon: CalendarDays, label: 'Planer' }, { id: 'tagebuch', icon: ClipboardList, label: 'Tagebuch' }, { id: 'service', icon: Settings, label: 'Service' }].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === tab.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}><tab.icon size={22} strokeWidth={activeTab === tab.id ? 3 : 2} /><span className="text-[10px] font-black uppercase tracking-tighter">{tab.label}</span></button>
        ))}
      </nav>
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 animate-in fade-in">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveModal(null)}></div>
          {activeModal === 'ki-telefon' ? (
             <div className="bg-white w-full max-w-md h-[85vh] rounded-[3rem] overflow-hidden relative shadow-2xl animate-in slide-in-from-bottom-10"><iframe src="https://app.centrals.ai/centrals/embed/Pflegedienst" width="100%" height="100%" className="border-none" /><button onClick={()=>setActiveModal(null)} className="absolute top-6 right-6 bg-white/30 backdrop-blur-md p-3 rounded-full text-white"><X/></button></div>
          ) : (
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative animate-in slide-in-from-bottom-10 text-left"><button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full"><X size={20}/></button>
              {activeModal === 'rezept' && (<div className="space-y-6"><h3 className="text-xl font-black flex items-center gap-3"><FileText className="text-[#dccfbc]"/> Rezept-Upload</h3><div className="border-2 border-dashed border-[#dccfbc] rounded-[2rem] p-8 text-center bg-[#F9F7F4] relative"><input type="file" multiple accept="image/*,.pdf" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} className="absolute inset-0 opacity-0 cursor-pointer" /><Upload className="mx-auto text-[#dccfbc] mb-2" size={32}/><p className="text-xs font-black text-[#b5a48b] uppercase tracking-widest">{selectedFiles.length > 0 ? `${selectedFiles.length} ausgewählt` : "Klicken zum Hochladen"}</p></div><button onClick={() => submitService('Rezept anfordern')} disabled={isSending || selectedFiles.length === 0} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-lg">Rezept senden</button></div>)}
              {activeModal === 'termin' && (<div className="space-y-6 text-left"><h3 className="text-xl font-black flex items-center gap-3"><RefreshCw className="text-[#dccfbc]"/> Termin ändern</h3>{terminStep === 1 ? (<div className="space-y-4"><input type="text" value={newTaetigkeit} onChange={(e)=>setNewTaetigkeit(e.target.value)} placeholder="Grund des Termins..." className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" /><button onClick={()=>setTerminStep(2)} disabled={!newTaetigkeit} className="w-full bg-[#dccfbc] text-white py-5 rounded-2xl font-black uppercase tracking-widest">Weiter</button></div>) : (<div className="space-y-4"><input type="date" value={newDatum} onChange={(e)=>setNewDatum(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none font-black" /><button onClick={() => submitService('Termin ändern')} disabled={!newDatum || isSending} className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-black uppercase shadow-lg">Anfragen</button></div>)}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}