import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/.pnpm/zrender@')) return 'zrender';
          if (
            id.includes('/node_modules/.pnpm/react@')
            || id.includes('/node_modules/.pnpm/react-dom@')
            || id.includes('/node_modules/.pnpm/react-router@')
            || id.includes('/node_modules/.pnpm/react-router-dom@')
          ) {
            return 'react';
          }
        },
      },
    },
  },
});
