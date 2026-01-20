import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, CalendarDays, ClipboardList, Settings, 
  Phone, Mic, LogOut, Calendar as CalendarIcon, RefreshCw 
} from 'lucide-react';

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
  
  const [contactData, setContactData] = useState<any[]>([]);
  const [patientData, setPatientData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  // Debug-Logs für den Screen
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = (msg: string) => setLogs(prev => [`> ${msg}`, ...prev]);

  const fetchData = async () => {
    const id = patientId || localStorage.getItem('active_patient_id');
    if (!id || id === "null") return;

    try {
      setLoading(true);
      addLog("Lade Daten...");
      
      const [resP, resC] = await Promise.all([
        fetch(`${N8N_BASE_URL}/get_data_patienten?patientId=${id}`),
        fetch(`${N8N_BASE_URL}/get_data_kontakte?patientId=${id}`)
      ]);
      
      const jsonP = await resP.json(); 
      const jsonC = await resC.json();

      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      
      // --- HIER IST DIE LOGIK FÜR DEINEN SCREENSHOT ---
      let list = [];

      // Fall A: Die Struktur aus deinem Screenshot (Array mit 1 Objekt, darin "data")
      if (Array.isArray(jsonC) && jsonC.length > 0 && jsonC[0].data) {
        addLog("Struktur erkannt: Wrapper [ { data: ... } ]");
        list = jsonC[0].data; // Wir gehen IN das Paket
      }
      // Fall B: Normale Liste
      else if (Array.isArray(jsonC)) {
        addLog("Struktur erkannt: Direkte Liste");
        list = jsonC;
      }
      else {
        addLog("Unbekannte Struktur (siehe Konsole)");
        console.log("RAW DATA:", jsonC);
      }

      setContactData(list);
      addLog(`${list.length} Kontakte geladen.`);

    } catch (e) {
      addLog(`Fehler: ${String(e)}`);
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

  if (!patientId) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-left">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl space-y-4 w-full max-w-sm">
          <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" placeholder="Name" required />
          <input type="password" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" placeholder="Code" required />
          <button type="submit" className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold uppercase shadow-lg">Anmelden</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-sans pb-32 text-[#3A3A3A] select-none text-left">
      <header className="py-4 px-6 bg-[#dccfbc] text-white shadow-sm flex justify-between items-center">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" className="h-11 w-auto object-contain" alt="Logo" />
        <div className="flex items-center gap-2">
            <span className="text-[10px] opacity-50 font-mono">v2.0</span>
            <button onClick={() => { localStorage.clear(); setPatientId(null); }} className="bg-white/20 p-2 rounded-full active:scale-90"><LogOut size={18}/></button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 pt-8">
        
        {/* --- DEBUG LOG AUF DEM BILDSCHIRM --- */}
        <div className="bg-black text-green-400 p-4 rounded-xl mb-6 font-mono text-[10px] h-24 overflow-auto shadow-lg border-2 border-gray-800">
          <strong>SYSTEM STATUS v2.0:</strong>
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>

        <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center mb-8 animate-in fade-in">
          <div>
            <p className="text-[10px] uppercase font-bold opacity-80 mb-1">Status</p>
            <h2 className="text-3xl font-black">{unbox(patientData?.Pflegegrad) || "Lädt..."}</h2>
          </div>
          <div className="bg-white/20 p-4 rounded-2xl"><CalendarIcon size={28}/></div>
        </div>

        <section className="space-y-6 animate-in slide-in-from-bottom-4">
          <div className="flex justify-between items-center border-l-4 border-[#dccfbc] pl-4">
             <h3 className="font-black text-lg uppercase tracking-widest text-[10px] text-gray-400">
               Kontakte ({contactData.length})
             </h3>
             {loading && <RefreshCw className="animate-spin text-[#dccfbc]" size={16}/>}
          </div>
          
          <div className="space-y-3">
            {contactData.length > 0 ? contactData.map((c: any, i: number) => {
               // HIER: Zugriff direkt auf "Name", "Rolle/Funktion" (wie im Airtable Screenshot)
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
                    <a href={`tel:${tel}`} className="bg-[#dccfbc]/10 p-3 rounded-full text-[#b5a48b] active:scale-90">
                      <Phone size={20} fill="#b5a48b" />
                    </a>
                  )}
                </div>
               );
            }) : (
              <p className="text-center text-gray-300 text-xs italic pt-4">
                 {loading ? "Daten werden geladen..." : "Keine Kontakte gefunden."}
              </p>
            )}
          </div>
        </section>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-gray-50 flex justify-around p-5 pb-11 rounded-t-[3rem] shadow-2xl z-50">
        <button className="flex flex-col items-center gap-1.5 text-[#b5a48b] scale-110"><LayoutDashboard size={22} strokeWidth={3} /><span className="text-[10px] font-black uppercase tracking-tighter">Dashboard</span></button>
        <button className="flex flex-col items-center gap-1.5 text-gray-300"><CalendarDays size={22} /><span className="text-[10px] font-black uppercase tracking-tighter">Planer</span></button>
        <button className="flex flex-col items-center gap-1.5 text-gray-300"><ClipboardList size={22} /><span className="text-[10px] font-black uppercase tracking-tighter">Tagebuch</span></button>
        <button className="flex flex-col items-center gap-1.5 text-gray-300"><Settings size={22} /><span className="text-[10px] font-black uppercase tracking-tighter">Service</span></button>
      </nav>
    </div>
  );
}