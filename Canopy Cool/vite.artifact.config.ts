import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One JS bundle (no lazy chunks) so scripts/make-artifact.mjs can inline everything into a single HTML file.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist-artifact', cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } },
});
