import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('publisher-worker/qa'),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@/contexts/LanguageContext',
        replacement: resolve('publisher-worker/qa/mocks.tsx'),
      },
      {
        find: '@/contexts/AuthContext',
        replacement: resolve('publisher-worker/qa/mocks.tsx'),
      },
      {
        find: '@/services/propertyManagement',
        replacement: resolve('publisher-worker/qa/mocks.tsx'),
      },
      {
        find: '@/db/supabase',
        replacement: resolve('publisher-worker/qa/mocks.tsx'),
      },
      { find: '@', replacement: resolve('src') },
    ],
  },
  build: {
    outDir: resolve('publisher-worker/artifacts/ui'),
    emptyOutDir: true,
  },
});
