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
  // Server middleware bundle (Node.js)
  {
    entry: { server: 'src/server.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'node18',
    platform: 'node',
    external: ['express', 'verusid-ts-client', 'verusid-ts-client/node_modules/bs58check', 'verusid-ts-client/node_modules/bn.js'],
  },
  // CLI standalone server (Node.js)
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    sourcemap: true,
    target: 'node18',
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
    external: ['express', 'cors', 'dotenv', 'verusid-ts-client', 'verusid-ts-client/node_modules/bs58check', 'verusid-ts-client/node_modules/bn.js'],
  },
]);
