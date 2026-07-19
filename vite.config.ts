import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

const backendUrl =
  process.env.PAD_BACKEND_URL ?? 'http://127.0.0.1:4174';
const frontendPort = Number(process.env.PAD_FRONTEND_PORT || 5173);

if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65_535) {
  throw new Error(
    `PAD_FRONTEND_PORT không hợp lệ: ${process.env.PAD_FRONTEND_PORT}`,
  );
}

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist/frontend',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: frontendPort,
    strictPort: true,
    watch: {
      ignored: ['**/tmp/**'],
    },
    proxy: {
      '/api': backendUrl,
    },
  },
});
