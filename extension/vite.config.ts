import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
    // Vite >=6.0.9 only sends CORS headers to localhost origins; the CRXJS dev service worker and
    // content-script loaders import from this server as chrome-extension://<id>, so allow that origin.
    cors: { origin: [/^chrome-extension:\/\//] },
  },
})
