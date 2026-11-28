import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const scannerBuild = mode === 'scanner';
  return {
    plugins: [react()],
    ...(scannerBuild ? {
      publicDir: false,
      build: { rollupOptions: { input: resolve(__dirname, 'scanner.html') } }
    } : {}),
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://127.0.0.1:4000'
      }
    }
  };
});
