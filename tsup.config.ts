import { defineConfig } from 'tsup';

export default defineConfig([
  // Client bundle (browser)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    platform: 'browser',
  },
  // Server bundle (Node.js)
  {
    entry: { server: 'src/server.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'node18',
    platform: 'node',
    external: ['express', 'verusid-ts-client', 'verusid-ts-client/node_modules/bs58check'],
  },
]);
