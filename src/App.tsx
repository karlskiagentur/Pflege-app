import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, Phone, User, RefreshCw, FileText, 
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, 
  ChevronRight, Send, Euro, FileCheck, PlayCircle, Plane, Play, FolderOpen, Plus,
  CheckCircle2, Circle, ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react';

// STELLE SICHER, DASS DIESE URL KORREKT IST
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
  
  const [patientData, setPatientData] = useState<any>(null);
  const [contactData, setContactData] = useState<any[]>([]);
  const [besuche, setBesuche] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [activeModal, setActiveModal] = useState<'folder' | 'upload' | 'video' | 'ki-telefon' | null>(null);

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
      
      const extract = (json: any) => {
        if (!json) return [];
        // Falls n8n die Daten in ein 'data' Array verpackt
        if (json.data && Array.isArray(json.data)) return json.data;
        if (Array.isArray(json)) return json;
        return [];
      };

      setContactData(extract(jsonC));
      setBesuche(extract(jsonB));
      
      const rawTasks = extract(jsonT);
      const mappedTasks = rawTasks.map((t: any) => {
        // Airtable liefert Daten oft in einem 'fields' Objekt
        const data = t.fields || t; 
        return {
          id: t.id, // Die echte Record-ID für das Update
          text: unbox(data.Aufgabentext),
          done: unbox(data.Status) === "Erledigt"
        };
      });
      setTasks(mappedTasks);

    } catch (e) { console.error("Ladefehler:", e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

  // --- 2. AUFGABE AKTUALISIEREN (POST) ---
  const toggleTask = async (id: string, currentStatus: boolean) => {
    // UI sofort aktualisieren (optimistisch)
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !currentStatus } : t));

    try {
      await fetch(`${N8N_BASE_URL}/update_task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: id, done: !currentStatus })
      });
      // Optional: Nach kurzem Delay neu laden, um Sync zu bestätigen
      setTimeout(fetchData, 1500);
    } catch (e) { console.error("Update-Fehler:", e); }
  };

  // --- 3. TEST-FUNKTION ---
  const testPostConnection = async () => {
      try {
          const res = await fetch(`${N8N_BASE_URL}/update_task`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: "recYndvuONaVZT6Fo", done: true }) // Test mit echter Denis-ID
          });
          if (res.ok) alert("Erfolg! n8n hat geantwortet.");
      } catch (e) { alert("Verbindung fehlgeschlagen!"); }
  };

  if (!patientId) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6">
        <form onSubmit={(e) => { e.preventDefault(); /* Login Logik hier */ }} className="bg-white p-8 rounded-[3rem] shadow-xl w-full max-w-sm">
          <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4" placeholder="Name" />
          <input type="password" value={loginCode} onChange={(e)=>setLoginCode(e.target.value)} className="w-full bg-[#F9F7F4] p-5 rounded-2xl mb-4" placeholder="Code" />
          <button type="submit" className="w-full bg-[#b5a48b] text-white py-5 rounded-2xl font-bold">Anmelden</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-32 text-left">
      <header className="py-4 px-6 bg-[#dccfbc] text-white flex justify-between items-center">
        <img src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" alt="Logo" className="h-11" />
        <button onClick={() => { localStorage.clear(); setPatientId(null); }}><LogOut size={18}/></button>
      </header>

      <main className="max-w-md mx-auto px-6 pt-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-[#d2c2ad] rounded-[2rem] p-7 text-white flex justify-between items-center">
               <div><p className="text-[10px] uppercase font-bold opacity-80 mb-1">Status</p><h2 className="text-3xl font-black">{unbox(patientData?.Pflegegrad)}</h2></div>
               <CalendarIcon size={28}/>
            </div>

            <section className="space-y-4">
              <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Aufgaben ({tasks.filter(t=>!t.done).length} offen)</h3>
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 space-y-3">
                 {tasks.length > 0 ? tasks.slice(0, showAllTasks ? 99 : 5).map((task) => (
                    <button key={task.id} onClick={() => toggleTask(task.id, task.done)} className="w-full flex items-center gap-3 text-left">
                        {task.done ? <CheckCircle2 size={24} className="text-[#dccfbc]" /> : <Circle size={24} className="text-gray-200" />}
                        <span className={`text-sm ${task.done ? 'text-gray-300 line-through' : 'font-bold text-gray-700'}`}>{task.text}</span>
                    </button>
                 )) : <p className="text-center text-gray-300 py-4 italic text-xs">Keine Aufgaben geladen.</p>}
              </div>
            </section>

            <button onClick={testPostConnection} className="w-full bg-red-50 text-red-400 p-3 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-red-100 opacity-50 flex items-center justify-center gap-2">
                <AlertTriangle size={14}/> Verbindung testen
            </button>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 border-t flex justify-around p-5 pb-11 z-50">
        <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center gap-1 ${activeTab === 'dashboard' ? 'text-[#b5a48b]' : 'text-gray-300'}`}><LayoutDashboard size={22} /><span className="text-[10px] font-black uppercase">Home</span></button>
        <button onClick={() => setActiveTab('planer')} className="flex flex-col items-center gap-1 text-gray-300"><CalendarDays size={22} /><span className="text-[10px] font-black uppercase">Planer</span></button>
        <button onClick={() => setActiveTab('hochladen')} className="flex flex-col items-center gap-1 text-gray-300"><Upload size={22} /><span className="text-[10px] font-black uppercase">Upload</span></button>
        <button onClick={() => setActiveTab('urlaub')} className="flex flex-col items-center gap-1 text-gray-300"><Plane size={22} /><span className="text-[10px] font-black uppercase">Urlaub</span></button>
      </nav>
    </div>
  );
}