
import React from 'react';
import { View } from '../types';
import { Icons } from '../constants';

interface LayoutProps {
  children: React.ReactNode;
  activeView: View;
  onViewChange: (view: View) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activeView, onViewChange }) => {
  return (
    <div className="min-h-screen flex flex-col max-w-lg mx-auto bg-white shadow-xl relative">
      {/* Header */}
      <header className="bg-sand p-6 text-white sticky top-0 z-50 shadow-md">
        <div className="flex justify-between items-center">
          <div className="flex flex-col gap-2">
            <img 
              src="https://www.wunschlos-pflege.de/wp-content/uploads/2024/02/wunschlos-logo-white-400x96.png" 
              alt="Wunschlos Pflege Logo" 
              className="h-10 object-contain self-start"
            />
            <p className="text-sand-light text-xs opacity-90 font-medium">Gemeinsam für Maria Schmidt</p>
          </div>
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-inner">
             <span className="text-sand-dark font-bold text-xl">MS</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-5 pb-24 overflow-y-auto">
        {children}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-100 px-2 py-3 flex justify-around z-50">
        <button 
          onClick={() => onViewChange(View.DASHBOARD)}
          className={`flex flex-col items-center p-2 rounded-xl transition-colors ${activeView === View.DASHBOARD ? 'text-sand-dark bg-sand-light' : 'text-gray-400'}`}
        >
          <Icons.Dashboard />
          <span className="text-xs mt-1 font-medium">Dashboard</span>
        </button>
        <button 
          onClick={() => onViewChange(View.PLANNER)}
          className={`flex flex-col items-center p-2 rounded-xl transition-colors ${activeView === View.PLANNER ? 'text-sand-dark bg-sand-light' : 'text-gray-400'}`}
        >
          <Icons.Planner />
          <span className="text-xs mt-1 font-medium">Planer</span>
        </button>
        <button 
          onClick={() => onViewChange(View.DIARY)}
          className={`flex flex-col items-center p-2 rounded-xl transition-colors ${activeView === View.DIARY ? 'text-sand-dark bg-sand-light' : 'text-gray-400'}`}
        >
          <Icons.Diary />
          <span className="text-xs mt-1 font-medium">Tagebuch</span>
        </button>
        <button 
          onClick={() => onViewChange(View.SERVICE)}
          className={`flex flex-col items-center p-2 rounded-xl transition-colors ${activeView === View.SERVICE ? 'text-sand-dark bg-sand-light' : 'text-gray-400'}`}
        >
          <Icons.Service />
          <span className="text-xs mt-1 font-medium">Service</span>
        </button>
      </nav>
    </div>
  );
};

export default Layout;
