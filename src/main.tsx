import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import { installGlobalErrorReporting } from './report'

// Unbehandelte Fehler & Promise-Rejections sofort an den Betreiber melden.
installGlobalErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
