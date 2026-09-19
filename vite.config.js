import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The preview host is proxied, so accept any origin and bind wide.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    fs: { strict: false }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
