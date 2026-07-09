import React from 'react';
import { reportClientError } from './report';

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

// Fängt Render-Fehler ab, damit die App NIE als weißer Bildschirm endet.
// Zeigt stattdessen eine freundliche Meldung mit Neu-laden-Button und meldet
// den Fehler sofort an den Betreiber.
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: any, info: any) {
    reportClientError('render', error, { componentStack: info && info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: 24,
          background: '#F9F7F4', color: '#4A4A4A', textAlign: 'center', fontFamily: 'sans-serif',
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#b5a48b', marginBottom: 12 }}>
            Es ist ein Fehler aufgetreten
          </h1>
          <p style={{ fontSize: 16, maxWidth: 320, marginBottom: 24 }}>
            Bitte laden Sie die App neu. Wir wurden automatisch informiert und kümmern uns darum.
          </p>
          <button
            onClick={() => { try { location.reload(); } catch (_) {} }}
            style={{
              background: '#b5a48b', color: '#fff', border: 'none', borderRadius: 999,
              padding: '14px 28px', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            }}
          >
            App neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
