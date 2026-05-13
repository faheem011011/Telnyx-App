import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: true,  // Allow connections from external devices
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      // For local Telnyx webhook testing via a tunnel, set VITE_DEV_HOST to
      // your tunnel hostname (e.g. 'your-subdomain.ngrok-free.app') so it
      // doesn't have to be committed.
      ...(process.env.VITE_DEV_HOST ? [process.env.VITE_DEV_HOST] : []),
    ],
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});

