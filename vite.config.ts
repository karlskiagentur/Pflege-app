import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    // PDF.js (Vorschau der Lohnabrechnung) ist ein eigener, erst bei Bedarf geladener Teil von
    // gut 500 kB - kein Grund für eine Warnung beim Bauen.
    chunkSizeWarningLimit: 600
  }
})
