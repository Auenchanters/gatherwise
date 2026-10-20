/** Build the static React client, and proxy `/api` to the local API server in development. */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep the browser's Host so the API's same-origin check sees the page's own origin.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } } },
});
