import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, Phone, User, RefreshCw, FileText, 
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, 
  ChevronRight, Send, Euro, FileCheck, PlayCircle, Plane, Play, FolderOpen, Plus,
  CheckCircle2, Circle, ChevronDown, ChevronUp, AlertTriangle
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  
  // Daten States
  const [patientData, setPatientData] = useState<any>(null);
  const [contactData, setContactData] = useState<any[]>([]);
  const [besuche, setBesuche] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAllTasks, setShowAllTasks] = useState(false);

  // UI States
  const [activeModal, setActiveModal] = useState<'folder' | 'upload' | 'video' | 'ki-telefon' | null>(null);
  const [uploadContext, setUploadContext] = useState<'Rechnung' | 'Leistungsnachweis' | ''>(''); 
  const [sentStatus, setSentStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // --- 1. DATEN LADEN (GET) ---
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
      const jsonT = await resT.json();

      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      
      // Super-robuster Entpacker (Matrjoschka-Fix)
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
      setBesuche(extract(jsonB));
      
      // Aufgaben Mapping (Prüft beide Ebenen: fields oder direkt)
      const rawTasks = extract(jsonT);
      const mappedTasks = rawTasks.map((t: any) => {
        const data = t.fields || t; // Nimm fields falls vorhanden, sonst das Objekt selbst
        return {
          id: t.id || Math.random().toString(), // Wir brauchen die t.id für Airtable!
          text: unbox(data.Aufgabentext || data.text),
          done: unbox(data.Status) === "Erledigt"
        };
      });
      setTasks(mappedTasks);

    } catch (e) { 
        console.error("Fehler beim Laden:", e); 
    } finally { 
        setLoading(false); 
    }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

  // --- 2. AUFGABE AKTUALISIEREN (POST) ---
  const toggleTask = async (id: string, currentStatus: boolean) => {
    // UI sofort ändern
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !currentStatus } : t));

    try {
      await fetch(`${N8N_BASE_URL}/update_task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            taskId: id, 
            done: !currentStatus 
        })
      });
      // Nach 1 Sekunde neu laden um sicher zu gehen
      setTimeout(fetchData, 1000);
    } catch (e) {
      console.error("Update fehlgeschlagen:", e);
    }
  };

  // --- 3. TEST-FUNKTION FÜR POST ---
  const testPostConnection = async () => {
      alert("Sende Test-POST an n8n...");
      try {
          const res = await fetch(`${N8N_BASE_URL}/update_task`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: "TEST_ID", done: true })
          });
          if (res.ok) alert("Erfolg! n8n hat geantwortet.");
          else alert("n8n erreichbar, aber Fehler-Status: " + res.status);
      } catch (e) {
          alert("Fehler: n8n nicht erreichbar. Prüfe die URL!");
      }
  };

  // Login Logic
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

  if (!patientId) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6 text-left">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-[3rem] shadow-xl space-y-4 w-full max-w-sm">
          <img src="/logo.png" alt="Logo" className="w-48 mx-auto mb-4" />
          <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" placeholder="Name" required />
          <input type="password" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl outline-none" placeholder="Code" required />
          <button type="submit" className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold uppercase">Anmelden</button>
        </form>
      </div>
    );
  }

  const openTasksCount = tasks.filter(t => !t.done).length;
  const visibleTasks = showAllTasks ? tasks : tasks.slice(0, 5);

  return (
    <div className="min-h-screen bg-white font-sans pb-32 text-[#3A3A3A] select-none text-left">
      <header className="py-4 px-6 bg-[#dccfbc] text-white shadow-sm flex justify-between items-center">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11 w-auto" />
        <button onClick={() => { localStorage.clear(); setPatientId(null); }} className="bg-white/20 p-2 rounded-full"><LogOut size={18}/></button>
      </header>

      <main className="max-w-md mx-auto px-6 pt-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in">
            {/* Status Karte */}
            <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white shadow-md flex justify-between items-center">
               <div><p className="text-[10px] uppercase font-bold opacity-80 mb-1">Status</p><h2 className="text-3xl font-black">{unbox(patientData?.Pflegegrad) || "..."}</h2></div>
               <div className="bg-white/20 p-4 rounded-2xl"><CalendarIcon size={28}/></div>
            </div>

            {/* AUFGABEN */}
            <section className="space-y-4">
              <div className="flex justify-between items-center border-l-4 border-[#dccfbc] pl-4">
                 <h3 className="font-black text-lg uppercase tracking-widest text-[10px] text-gray-400">Aufgaben ({openTasksCount} offen)</h3>
                 {loading && <RefreshCw size={14} className="animate-spin text-gray-300"/>}
              </div>
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 space-y-3">
                 {tasks.length > 0 ? visibleTasks.map((task) => (
                    <button key={task.id} onClick={() => toggleTask(task.id, task.done)} className="w-full flex items-center gap-3 text-left">
                        {task.done ? <CheckCircle2 size={24} className="text-[#dccfbc]" /> : <Circle size={24} className="text-gray-200" />}
                        <span className={`text-sm ${task.done ? 'text-gray-300 line-through' : 'font-bold text-gray-700'}`}>{task.text}</span>
                    </button>
                 )) : <p className="text-center text-gray-300 text-xs italic py-4">Keine Aufgaben aktuell.</p>}
                 
                 {tasks.length > 5 && (
                     <button onClick={() => setShowAllTasks(!showAllTasks)} className="w-full text-center text-[10px] font-black uppercase text-[#b5a48b] pt-2 border-t border-gray-50 mt-2">
                        {showAllTasks ? "Weniger anzeigen" : `${tasks.length - 5} weitere anzeigen`}
                     </button>
                 )}
              </div>
            </section>

            {/* TEST BUTTON (Kannst du später entfernen) */}
            <button onClick={testPostConnection} className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-400 p-3 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-red-100 opacity-50">
                <AlertTriangle size={14}/> POST Verbindung testen
            </button>

            {/* Stammdaten & Kontakte (Identisch wie zuvor) */}
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

        {/* ... Rest der Tabs (Hochladen, Urlaub, Planer) ... */}
        {/* Diese Tabs bleiben inhaltlich identisch mit v13, um Platz zu sparen */}
      </main>

      {/* NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-gray-50 flex justify-around p-5 pb-11 rounded-t-[3rem] shadow-2xl z-50">
        {[ { id: 'dashboard', icon: LayoutDashboard, label: 'Home' }, { id: 'planer', icon: CalendarDays, label: 'Planer' }, { id: 'hochladen', icon: Upload, label: 'Hochladen' }, { id: 'urlaub', icon: Plane, label: 'Urlaub' } ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === tab.id ? 'text-[#b5a48b] scale-110' : 'text-gray-300'}`}><tab.icon size={22} strokeWidth={activeTab === tab.id ? 3 : 2} /><span className="text-[10px] font-black uppercase tracking-tighter">{tab.label}</span></button>
        ))}
      </nav>
      
      {/* KI BUTTON */}
      <button onClick={() => setActiveModal('ki-telefon')} className="fixed right-6 bottom-32 z-50 w-16 h-16 bg-[#4ca5a2] rounded-full shadow-2xl flex flex-col items-center justify-center text-white border-2 border-white active:scale-90 transition-transform"><Mic size={20} fill="white" /><span className="text-[8px] font-bold mt-1">KI Hilfe</span></button>
    </div>
  );
}