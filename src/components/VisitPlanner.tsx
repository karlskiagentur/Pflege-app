
import React from 'react';
import { Appointment } from '../types';

const mockAppointments: Appointment[] = [
  {
    id: '1',
    time: '08:30',
    date: 'Heute',
    task: 'Morgenpflege & Medikamente',
    caregiver: { name: 'Lena Sommer', photo: 'https://picsum.photos/seed/lena/100/100' }
  },
  {
    id: '2',
    time: '12:00',
    date: 'Heute',
    task: 'Mittagessen & Mobilisation',
    caregiver: { name: 'Markus Weber', photo: 'https://picsum.photos/seed/markus/100/100' }
  },
  {
    id: '3',
    time: '18:30',
    date: 'Heute',
    task: 'Abendpflege',
    caregiver: { name: 'Lena Sommer', photo: 'https://picsum.photos/seed/lena/100/100' }
  },
  {
    id: '4',
    time: '08:30',
    date: 'Morgen',
    task: 'Ganzkörperwaschung',
    caregiver: { name: 'Sarah Braun', photo: 'https://picsum.photos/seed/sarah/100/100' }
  }
];

const VisitPlanner: React.FC = () => {
  return (
    <div className="space-y-6">
      <header className="mb-4">
        <h2 className="text-2xl font-bold">Besuchs-Planer</h2>
        <p className="text-gray-500">Ihre geplanten Einsätze für diese Woche</p>
      </header>

      <div className="space-y-8">
        {['Heute', 'Morgen'].map(day => (
          <section key={day}>
            <h3 className="text-lg font-bold mb-4 sticky top-24 bg-white/80 backdrop-blur-sm py-2 z-10">{day}</h3>
            <div className="space-y-4">
              {mockAppointments.filter(app => app.date === day).map(app => (
                <div key={app.id} className="bg-white border-l-4 border-sand rounded-2xl p-5 shadow-sm flex items-center gap-5">
                  <div className="text-center min-w-[70px]">
                    <span className="block text-2xl font-bold text-sand">{app.time}</span>
                    <span className="text-xs font-semibold text-gray-400 uppercase">Uhr</span>
                  </div>
                  
                  <div className="flex-1">
                    <h4 className="font-bold text-lg leading-tight">{app.task}</h4>
                    <div className="flex items-center gap-2 mt-2">
                      <img src={app.caregiver.photo} alt={app.caregiver.name} className="w-8 h-8 rounded-full border-2 border-sand-light" />
                      <span className="text-gray-600 text-sm font-medium">{app.caregiver.name}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default VisitPlanner;
