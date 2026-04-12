#!/usr/bin/env node
/**
 * verus-connect CLI — lite VerusID auth server.
 *
 * Usage:
 *   verus-connect start
 *   verus-connect start --port 8100
 *
 * Config via .env or environment variables:
 *   SIGNING_IADDRESS   - VerusID to sign challenges with
 *   CALLBACK_URL       - Where wallets POST signed responses
 *   MODE               - "daemon" or "lite" (auto-detected if not set)
 *   RPC_URL            - Daemon RPC URL (daemon mode)
 *   PRIVATE_KEY        - WIF private key (lite mode)
 *   VERIFY_NODE_URL    - Public node for verification (lite mode)
 *   PORT               - Server port (default: 8100)
 *   HOST               - Server host (default: 127.0.0.1)
 *   CORS_ORIGINS       - Comma-separated allowed origins (default: *)
 */

import fs from 'fs';
import path from 'path';
import express from 'express';
import { verusAuth } from './middleware.js';

// Load .env
const envPath = path.join(process.cwd(), '.env');
try {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const PORT = parseInt(process.env.PORT || '8100', 10);
const HOST = process.env.HOST || '127.0.0.1';
const SIGNING_IADDRESS = process.env.SIGNING_IADDRESS || '';
const CALLBACK_URL = process.env.CALLBACK_URL || process.env.SERVER_URL || '';
const CORS_ORIGINS = process.env.CORS_ORIGINS || '*';

if (!SIGNING_IADDRESS) {
  console.error('Error: SIGNING_IADDRESS is required');
  process.exit(1);
}
if (!CALLBACK_URL) {
  console.error('Error: CALLBACK_URL is required');
  process.exit(1);
}

const app = express();

// CORS
const allowedOrigins = CORS_ORIGINS === '*' ? null : CORS_ORIGINS.split(',').map(s => s.trim());
app.use((req: any, res: any, next: any) => {
  const origin = req.headers.origin;
  if (!allowedOrigins || (origin && allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Mount auth middleware
app.use('/', verusAuth({
  mode: (process.env.MODE as any) || undefined,
  iAddress: SIGNING_IADDRESS,
  callbackUrl: CALLBACK_URL,
  chainIAddress: process.env.CHAIN_IADDRESS,
  chain: process.env.CHAIN,
  apiUrl: process.env.API_URL || process.env.RPC_URL,
  rpcUrl: process.env.RPC_URL,
  privateKey: process.env.PRIVATE_KEY,
  verifyNodeUrl: process.env.VERIFY_NODE_URL,
  debug: process.env.DEBUG === 'true' || process.env.DEBUG === '1',
}));

app.listen(PORT, HOST, () => {
  const mode = process.env.RPC_URL ? 'daemon' : 'lite';
  console.log(`verus-connect v4 listening on http://${HOST}:${PORT}`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Signing ID: ${SIGNING_IADDRESS}`);
  console.log(`  Callback: ${CALLBACK_URL}`);
  console.log(`  Endpoints:`);
  console.log(`    POST /login              Create login challenge`);
  console.log(`    POST /verusidlogin       Wallet callback (auto)`);
  console.log(`    GET  /result/:id         Poll challenge status`);
  console.log(`    POST /pay-deeplink       Generate payment deep link`);
  console.log(`    POST /generic-request    Create generic request`);
  console.log(`    POST /identity-update-request  Create identity update request`);
  console.log(`    GET  /health             Health check`);
});
