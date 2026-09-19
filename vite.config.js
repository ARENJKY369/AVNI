import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `allowedHosts` stays open on purpose: the sandbox preview proxies this dev
// server under a generated hostname. Nothing else is loosened — file serving
// stays inside the project allowlist.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}']
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
