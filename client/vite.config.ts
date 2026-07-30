import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

const API_PORT = process.env.API_PORT ?? '4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Mirrors the `@/*` path mapping in tsconfig.json for the bundler.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  base: '/',
  server: {
    // Pinned to IPv4: the default 'localhost' resolves to ::1 only on Windows,
    // which the API's CORS allow-list would then see as a different origin.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Only used when VITE_API_URL is left unset: requests stay same-origin and
    // are proxied to the local API, so no CORS setup is needed for dev.
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
      // Product photos are served by the API, not by Vite.
      '/uploads': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
});
