import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CalendarDays, Phone, User, RefreshCw, FileText, 
  X, Upload, Mic, LogOut, Calendar as CalendarIcon, 
  ChevronRight, Send, Euro, FileCheck, PlayCircle, Plane, Play, FolderOpen, Plus,
  CheckCircle2, Circle, ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react';

// WICHTIG: Schalte deinen n8n Workflow auf "Active", damit diese URL geht!
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
      
      const jsonP = await resP.json(); 
      const jsonC = await resC.json();
      const jsonB = await resB.json(); 
      const jsonT = await resT.json();

      if (jsonP.status === "success") setPatientData(jsonP.patienten_daten);
      
      const extract = (json: any) => {
        if (!json) return [];
        if (json.data && Array.isArray(json.data)) {
           // Fall: n8n Aggregate Node output
           if (json.data[0]?.data && Array.isArray(json.data[0].data)) return json.data[0].data;
           return json.data;
        }
        if (Array.isArray(json)) return json;
        return [];
      };

      setContactData(extract(jsonC));
      setBesuche(extract(jsonB));
      
      // AUFGABEN MAPPING
      const rawTasks = extract(jsonT);
      const mappedTasks = rawTasks.map((t: any) => {
        // Daten liegen manchmal direkt im Objekt oder unter 'fields'
        const data = t.fields || t; 
        return {
          id: t.id, // WICHTIG: Das ist die Record-ID (rec...)
          text: unbox(data.Aufgabentext),
          done: unbox(data.Status) === "Erledigt"
        };
      });
      setTasks(mappedTasks);

    } catch (e) { console.error("Fehler beim Laden:", e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { if (patientId) fetchData(); }, [patientId]);

  // --- UPDATE TASK ---
  const toggleTask = async (id: string, currentStatus: boolean) => {
    // 1. Sofort anzeigen
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !currentStatus } : t));

    try {
      // 2. An n8n senden
      await fetch(`${N8N_BASE_URL}/update_task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: id, done: !currentStatus })
      });
      // 3. Kurz warten und neu laden zur Bestätigung
      setTimeout(fetchData, 1000);
    } catch (e) { console.error("Update Fehler:", e); }
  };

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
      <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6">
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
              <h3 className="font-black text-lg border-l-4 border-[#dccfbc] pl-4 uppercase tracking-widest text-[10px] text-gray-400">Aufgaben ({openTasksCount} offen)</h3>
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 space-y-3">
                 {tasks.length > 0 ? visibleTasks.map((t) => (
                    <button key={t.id} onClick={() => toggleTask(t.id, t.done)} className="w-full flex items-center gap-3 text-left active:opacity-70 transition-opacity">
                        {t.done ? <CheckCircle2 size={24} className="text-[#dccfbc]" /> : <Circle size={24} className="text-gray-200" />}
                        <span className={`text-sm ${t.done ? 'text-gray-300 line-through' : 'font-bold text-gray-700'}`}>{t.text}</span>
                    </button>
                 )) : <p className="text-center text-gray-300 py-4 italic text-xs">Keine Aufgaben gefunden.</p>}
                 
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
        
        {/* Hier folgen die anderen Tabs (Planer, Hochladen, Urlaub) - der Übersicht halber gekürzt, aber im vorherigen Code enthalten */}
        {/* Füge hier den Rest aus v16 ein oder nutze v16 mit der Änderung am Anfang (URL) */}
      </main>
      
      {/* ... Navigation & KI Button ... */}
    </div>
  );
}