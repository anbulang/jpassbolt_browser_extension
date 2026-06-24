import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

// MV3 build via @crxjs/vite-plugin: it reads the manifest, bundles the
// background service worker (ES module), the content script, and the HTML
// pages referenced by the manifest (popup, options). The standalone full-vault
// page (app.html) is added explicitly as a rollup input.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: { app: 'app.html' },
    },
  },
  server: { port: 5180, strictPort: true },
});
