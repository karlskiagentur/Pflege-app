
import React, { useState } from 'react';
import { VitalSign, CareReport } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
// Add missing import for Icons
import { Icons } from '../constants';

const mockVitals: VitalSign[] = [
  { date: 'Mo', bloodPressure: '120/80', pulse: 72, bloodSugar: 105 },
  { date: 'Di', bloodPressure: '125/82', pulse: 75, bloodSugar: 110 },
  { date: 'Mi', bloodPressure: '118/78', pulse: 70, bloodSugar: 102 },
  { date: 'Do', bloodPressure: '122/81', pulse: 78, bloodSugar: 108 },
  { date: 'Fr', bloodPressure: '128/85', pulse: 82, bloodSugar: 115 },
];

const mockReports: CareReport[] = [
  { id: '1', date: 'Vor 2 Stunden', author: 'Lena Sommer', content: 'Frau Schmidt war heute sehr munter. Die Mobilisation im Garten verlief erfolgreich. Schmerzmedikation wie verordnet eingenommen.' },
  { id: '2', date: 'Gestern, 19:15', author: 'Markus Weber', content: 'Abendpflege durchgeführt. Hautzustand am Rücken unauffällig. Reichlich Flüssigkeit angeboten und getrunken.' },
];

const CareDiary: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'vitals' | 'reports'>('vitals');

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold">Pflegetagebuch</h2>
        <div className="flex p-1 bg-gray-100 rounded-2xl mt-4">
          <button 
            onClick={() => setActiveTab('vitals')}
            className={`flex-1 py-3 text-lg font-bold rounded-xl transition-all ${activeTab === 'vitals' ? 'bg-white shadow-sm text-sand' : 'text-gray-500'}`}
          >
            Vitalwerte
          </button>
          <button 
            onClick={() => setActiveTab('reports')}
            className={`flex-1 py-3 text-lg font-bold rounded-xl transition-all ${activeTab === 'reports' ? 'bg-white shadow-sm text-sand' : 'text-gray-500'}`}
          >
            Berichte
          </button>
        </div>
      </header>

      {activeTab === 'vitals' ? (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm">
            <h3 className="font-bold text-lg mb-4">Pulsverlauf (Letzte 5 Tage)</h3>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mockVitals}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} domain={['dataMin - 5', 'dataMax + 5']} />
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Line type="monotone" dataKey="pulse" stroke="#bdaa8a" strokeWidth={3} dot={{ fill: '#bdaa8a', r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-bold text-lg">Letzte Messwerte</h3>
            {mockVitals.reverse().map((vital, i) => (
              <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex justify-between items-center">
                <span className="font-bold text-gray-400">{vital.date}</span>
                <div className="flex gap-6">
                  <div className="text-center">
                    <span className="block text-xs text-gray-400 font-bold uppercase">RR</span>
                    <span className="font-bold text-sand">{vital.bloodPressure}</span>
                  </div>
                  <div className="text-center">
                    <span className="block text-xs text-gray-400 font-bold uppercase">Puls</span>
                    <span className="font-bold text-sand">{vital.pulse}</span>
                  </div>
                  <div className="text-center">
                    <span className="block text-xs text-gray-400 font-bold uppercase">BZ</span>
                    <span className="font-bold text-sand">{vital.bloodSugar}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {mockReports.map(report => (
            <div key={report.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-bold text-lg">{report.author}</h4>
                  <p className="text-sm text-gray-400 font-medium">{report.date}</p>
                </div>
                <div className="w-8 h-8 bg-sand-light rounded-full flex items-center justify-center text-sand">
                  <Icons.Diary />
                </div>
              </div>
              <p className="text-gray-700 leading-relaxed text-lg">
                {report.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CareDiary;
