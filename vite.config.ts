import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  base: './',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: true,
  },
});
