import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,  // Allow connections from external devices
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      // Add your ngrok URL here when using Twilio webhooks locally, e.g.:
      // 'your-subdomain.ngrok-free.app',
    ],
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});

