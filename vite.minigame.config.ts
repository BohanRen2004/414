import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Bundles the WeChat mini game into one classic script, minigame/game.js, which WeChat loads as the entry. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./minigame', import.meta.url)),
    emptyOutDir: false,
    target: 'es2017',
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./minigame/src/game.ts', import.meta.url)),
      formats: ['iife'],
      name: 'FourAFourGame',
      fileName: () => 'game.js',
    },
  },
});
