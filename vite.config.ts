import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

const backendUrl =
  process.env.PAD_BACKEND_URL ?? 'http://127.0.0.1:4174';

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist/frontend',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': backendUrl,
    },
  },
});
