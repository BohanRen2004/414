import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Bundles the `room` cloud function into one CommonJS file; wx-server-sdk is installed by WeChat in the cloud. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./minigame/cloudfunctions/room', import.meta.url)),
    emptyOutDir: false,
    target: 'node12',
    sourcemap: false,
    minify: false,
    ssr: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./server/cloud/room-function.ts', import.meta.url)),
      external: ['wx-server-sdk', 'crypto'],
      output: { format: 'cjs', entryFileNames: 'index.js', exports: 'named' },
    },
  },
});
