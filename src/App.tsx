import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, CalendarDays, ClipboardList, Settings, 
  Phone, Mic, LogOut, Calendar as CalendarIcon, RefreshCw, ChevronRight 
} from 'lucide-react';

const N8N_BASE_URL = 'https://karlskiagentur.app.n8n.cloud/webhook';

// Helfer zum Entpacken der Daten
const unbox = (val: any): string => {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) return unbox(val[0]);
  return String(val);
};

export default function App() {
  const [patientId, setPatientId] = useState<string | null>(localStorage.getItem('active_patient_id'));
  const [fullName, setFullName] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [contactData, setContactData] = useState<any[]>([]);
  const [patientData, setPatientData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Daten laden (Die bewährte v4.0 Logik, aber ohne sichtbare Logs)
  const fetchData = async () => {
    const id = patientId || localStorage.getItem('active_patient_id');
    if (!id || id === "null") return;

    try {
      setLoading(true);
      const [resP, resC] = await Promise.all([
        fetch(`${N8N_BASE_URL}/get_data_patienten?patientId=${id}`),
        fetch(`${N8N_BASE_URL}/get_data_kontakte?patientId=${id}`)
      ]);
      
      const jsonP = await resP.json(); 
      const jsonC = await resC.json();

      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      
      // --- LOGIK: DOPPELTE VERSCHACHTELUNG LÖSEN ---
      let list = [];
      if (jsonC.data && Array.isArray(jsonC.data) && jsonC.data.length > 0 && jsonC.data[0].data && Array.isArray(jsonC.data[0].data)) {
        list = jsonC.data[0].data; // Doppelt verpackt
      } else if (jsonC.data && Array.isArray(jsonC.data)) {
        list = jsonC.data; // Einfach verpackt
      } else if (Array.isArray(jsonC) && jsonC.length > 0 && jsonC[0].data) {
        list = jsonC[0].data; // Array Wrapper
      } else if (Array.isArray(jsonC)) {
        list = jsonC; // Direktes Array
      }
      
      setContactData(list);

    } catch (e) {
      console.error("Fehler beim Laden:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
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
  };

  // --- LOGIN SCREEN ---
  if (!patientId) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6 text-left">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl space-y-4 w-full max-w-sm">
          <div className="w-64 h-64 mx-auto mb-1">
             <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" placeholder="Name" required />
          <input type="password" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" placeholder="Code" required />
          <button type="submit" className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold uppercase shadow-lg">Anmelden</button>
        </form>
      </div>
    );
  }

  // --- HAUPT NAVIGATION & VIEWS ---
  return (
    <div className="min-h-screen bg-white font-sans pb-32 text-[#3A3A3A] select-none text-left">
      <header className="py-4 px-6 bg-[#dccfbc] text-white shadow-sm flex justify-between items-center">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" className="h-11 w-auto object-contain" alt="Logo" />
        <button onClick={() => { localStorage.clear(); setPatientId(null); }} className="bg-white/20 p-2 rounded-full active:scale-90"><LogOut size={18}/></button>
      </header>

      <main className="max-w-md mx-auto px-6 pt-8">
        
        {/* --- DASHBOARD --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Status Karte */}
            <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center">
              <div>
                <p className="text-[10px] uppercase font-bold opacity-80 mb-1">Status</p>
                <h2 className="text-3xl font-black">{unbox(patientData?.Pflegegrad) || "Lädt..."}</h2>
              </div>
              <div className="bg-white/20 p-4 rounded-2xl"><CalendarIcon size={28}/></div>
            </div>

            {/* Kontakte Liste */}
            <section className="space-y-6">
              <div className="flex justify-between items-center border-l-4 border-[#dccfbc] pl-4">
                <h3 className="font-black text-lg uppercase tracking-widest text-[10px] text-gray-400">
                  Kontakte ({contactData.length})
                </h3>
                {loading && <RefreshCw className="animate-spin text-[#dccfbc]" size={16}/>}
              </div>
              
              <div className="space-y-3">
                {contactData.length > 0 ? contactData.map((c: any, i: number) => {
                  const name = unbox(c.Name);
                  const rolle = unbox(c['Rolle/Funktion']);
                  const tel = unbox(c.Telefon);

                  return (
                    <div key={i} className="bg-white rounded-[2rem] p-4 flex items-center justify-between shadow-sm border border-gray-100">
                      <div className="flex items-center gap-4 text-left">
                        <div className="w-12 h-12 bg-[#F9F7F4] rounded-2xl flex items-center justify-center font-black text-[#dccfbc] text-lg">
                          {name ? name[0] : "?"}
                        </div>
                        <div>
                          <p className="font-black text-lg leading-tight">{name || "Name fehlt"}</p>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{rolle}</p>
                        </div>
                      </div>
                      {tel && (
                        <a href={`tel:${tel}`} className="bg-[#dccfbc]/10 p-3 rounded-full text-[#b5a48b] active:scale-90 transition-transform">
                          <Phone size={20} fill="#b5a48b" />
                        </a>
                      )}
                    </div>
                  );
                }) : (
                  <p className="text-center text-gray-300 text-xs italic pt-4">Keine Kontakte gefunden.</p>
                )}
              </div>
            </section>
          </div>
        )}

        {/* --- PLANER (Platzhalter) --- */}
        {activeTab === 'planer' && (
          <div className="flex flex-col items-center justify-center h-64 text-center animate-in fade-in zoom-in-95">
            <CalendarDays size={48} className="text-[#dccfbc] mb-4" />
            <h2 className="text-xl font-black text-[#d2c2ad]">Dein Wochenplan</h2>
            <p className="text-gray-400 text-xs mt-2 max-w-[200px]">Hier erscheinen bald deine Pflegetermine und Besuche.</p>
          </div>
        )}

        {/* --- TAGEBUCH (Platzhalter) --- */}
        {activeTab === 'tagebuch' && (
          <div className="flex flex-col items-center justify-center h-64 text-center animate-in fade-in zoom-in-95">
            <ClipboardList size={48} className="text-[#dccfbc] mb-4" />
            <h2 className="text-xl font-black text-[#d2c2ad]">Pflegetagebuch</h2>
            <p className="text-gray-400 text-xs mt-2 max-w-[200px]">Dokumentiere hier Vitalwerte und besondere Vorkommnisse.</p>
          </div>
        )}

        {/* --- SERVICE (Platzhalter) --- */}
        {activeTab === 'service' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-8">
            <h2 className="text-xl font-black text-[#3A3A3A] pl-2">Einstellungen</h2>
            <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 space-y-4">
               <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                 <span className="font-bold text-sm">Benachrichtigungen</span>
                 <div className="w-10 h-6 bg-[#dccfbc] rounded-full relative"><div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm"></div></div>
               </div>
               <div className="flex justify-between items-center">
                 <span className="font-bold text-sm">Dunkelmodus</span>
                 <div className="w-10 h-6 bg-gray-200 rounded-full relative"><div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm"></div></div>
               </div>
            </div>
            <div className="bg-[#dccfbc]/10 rounded-[2rem] p-6 text-center">
               <p className="text-[#b5a48b] font-bold text-xs uppercase">Hilfe benötigt?</p>
               <button className="mt-2 bg-[#b5a48b] text-white px-6 py-2 rounded-xl text-sm font-bold shadow-md">Support anrufen</button>
            </div>
          </div>
        )}

      </main>

      {/* --- BOTTOM NAVIGATION --- */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-gray-50 flex justify-around p-5 pb-11 rounded-t-[3rem] shadow-2xl z-50">
        <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'dashboard' ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}>
          <LayoutDashboard size={22} strokeWidth={3} />
          <span className="text-[10px] font-black uppercase tracking-tighter">Home</span>
        </button>
        <button onClick={() => setActiveTab('planer')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'planer' ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}>
          <CalendarDays size={22} />
          <span className="text-[10px] font-black uppercase tracking-tighter">Planer</span>
        </button>
        <button onClick={() => setActiveTab('tagebuch')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'tagebuch' ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}>
          <ClipboardList size={22} />
          <span className="text-[10px] font-black uppercase tracking-tighter">Tagebuch</span>
        </button>
        <button onClick={() => setActiveTab('service')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'service' ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}>
          <Settings size={22} />
          <span className="text-[10px] font-black uppercase tracking-tighter">Service</span>
        </button>
      </nav>

      {/* --- KI BUTTON --- */}
      <button className="fixed right-6 bottom-32 z-[60] w-20 h-20 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-4 border-white animate-pulse active:scale-95 transition-transform">
        <Mic size={24} fill="white" /><span className="text-[10px] font-bold text-center mt-0.5 leading-none">KI 24/7<br/>Hilfe</span>
      </button>
    </div>
  );
}