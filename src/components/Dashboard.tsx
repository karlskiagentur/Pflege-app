
import React from 'react';
import { PatientData } from '../types';
import { Icons } from '../constants';

const mockPatient: PatientData = {
  name: "Maria Schmidt",
  birthDate: "12.04.1942",
  careLevel: 3,
  address: "Musterstraße 45, 12345 Musterstadt",
  insurance: "AOK Plus",
  contacts: [
    { name: "Sabine Müller", role: "Pflegedienstleitung", phone: "0172 1234567" },
    { name: "Dr. med. Hans Weber", role: "Hausarzt", phone: "0341 987654" }
  ]
};

const Dashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Pflegegrad Card */}
      <div className="bg-sand rounded-3xl p-6 text-white flex items-center justify-between shadow-lg">
        <div>
          <p className="text-sand-light text-sm uppercase tracking-wider font-semibold">Aktueller Status</p>
          <h2 className="text-3xl font-bold mt-1">Pflegegrad {mockPatient.careLevel}</h2>
        </div>
        <div className="bg-white/20 p-4 rounded-2xl backdrop-blur-sm">
           <Icons.Planner />
        </div>
      </div>

      {/* Personal Info */}
      <section>
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <span className="w-2 h-8 bg-sand rounded-full inline-block"></span>
          Stammdaten
        </h3>
        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex justify-between border-b border-gray-50 pb-3">
            <span className="text-gray-500 text-lg">Geburtsdatum</span>
            <span className="font-semibold text-lg">{mockPatient.birthDate}</span>
          </div>
          <div className="flex justify-between border-b border-gray-50 pb-3">
            <span className="text-gray-500 text-lg">Versicherung</span>
            <span className="font-semibold text-lg">{mockPatient.insurance}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-gray-500 text-lg">Anschrift</span>
            <span className="font-semibold text-lg">{mockPatient.address}</span>
          </div>
        </div>
      </section>

      {/* Contacts */}
      <section>
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <span className="w-2 h-8 bg-sand rounded-full inline-block"></span>
          Wichtige Kontakte
        </h3>
        <div className="space-y-3">
          {mockPatient.contacts.map((contact, idx) => (
            <div key={idx} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-sand-light rounded-full flex items-center justify-center text-sand">
                  <span className="font-bold">{contact.name.charAt(0)}</span>
                </div>
                <div>
                  <h4 className="font-bold text-lg">{contact.name}</h4>
                  <p className="text-gray-500">{contact.role}</p>
                </div>
              </div>
              <a href={`tel:${contact.phone}`} className="w-12 h-12 bg-sand text-white rounded-full flex items-center justify-center hover:bg-sand-dark transition-colors">
                <Icons.Phone />
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
