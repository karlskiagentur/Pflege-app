import React, { useState, useCallback } from 'react';

const AIAssistant: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const stopAssistant = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
  }, []);

  const startAssistant = async () => {
    try {
      setIsConnecting(true);
      
      // 1. n8n im Hintergrund triggern (optional, um Airtable zu aktualisieren)
      // Wir warten nicht auf die Antwort, damit der Iframe sofort lädt
      fetch('https://karlskiagentur.app.n8n.cloud/webhook/Service_Anfragen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: "start_assistant",
          patient: "Denis Reutter"
        })
      }).catch(err => console.error("n8n Trigger Fehler:", err));

      // 2. Den Iframe-Modus aktivieren
      setIsActive(true);
      setIsConnecting(false);

    } catch (err) {
      console.error("Fehler beim Starten:", err);
      setIsConnecting(false);
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      <button 
        onClick={isActive ? stopAssistant : startAssistant}
        className={`fixed bottom-28 right-6 w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all z-[100] active:scale-90 ${isActive ? 'bg-red-500' : 'bg-teal'} ${!isActive && 'animate-pulse'}`}
      >
        {isConnecting ? (
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-white border-t-transparent"></div>
        ) : isActive ? (
           <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <div className="flex flex-col items-center text-white text-center px-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
            <span className="text-[10px] font-bold uppercase leading-tight">24/7 KI</span>
          </div>
        )}
      </button>

      {/* Assistant Overlay mit Centrals.ai Iframe */}
      {isActive && (
        <div className="fixed inset-0 bg-white z-[90] flex flex-col">
          {/* Header Bar passend zum App-Design */}
          <div className="p-4 bg-teal flex justify-between items-center text-white shadow-md">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-ping"></div>
              <span className="font-bold text-lg">KI Pflegeraum Assistent</span>
            </div>
            <button 
              onClick={stopAssistant}
              className="p-2 hover:bg-white/20 rounded-full transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Der Centrals.ai Iframe Bereich */}
          <div className="flex-1 w-full bg-sand-light relative">
            <iframe 
              src="https://app.centrals.ai/centrals/embed/Pflegedienst" 
              width="100%" 
              height="100%" 
              style={{ border: 'none' }}
              allow="microphone; camera; clipboard-write"
              title="KI Assistent"
            />
          </div>
        </div>
      )}
    </>
  );
};

export default AIAssistant;