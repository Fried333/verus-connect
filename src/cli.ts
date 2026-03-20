/**
 * verus-connect standalone server.
 *
 * Usage:
 *   verus-connect start                    # loads .env from cwd
 *   verus-connect start --port 8100        # override port
 *   verus-connect start --env /path/.env   # custom .env file
 *
 * Environment variables (set in .env or shell):
 *   SIGNING_IADDRESS   — Your app's VerusID i-address (required)
 *   PRIVATE_KEY        — WIF private key for that identity (required)
 *   CALLBACK_URL       — Public URL to /verusidlogin endpoint (required)
 *   PORT               — Server port (default: 8100)
 *   HOST               — Bind address (default: 127.0.0.1)
 *   CHAIN              — Chain name (default: VRSC)
 *   API_URL            — Verus RPC endpoint (default: https://api.verus.services)
 *   CHAIN_IADDRESS     — Chain i-address (default: VRSC mainnet)
 *   CORS_ORIGINS       — Comma-separated allowed origins (default: *)
 */

import path from 'path';
import { verusAuth } from './middleware';

// ── Parse CLI args ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function printUsage(): void {
  console.log(`
verus-connect — VerusID login server

Usage:
  verus-connect start [options]

Options:
  --port <number>     Override PORT (default: 8100)
  --host <address>    Override HOST (default: 127.0.0.1)
  --env <path>        Path to .env file (default: ./.env)
  --cors <origins>    Comma-separated CORS origins (default: *)

Environment variables (.env):
  SIGNING_IADDRESS    Your app's VerusID i-address (required)
  PRIVATE_KEY         WIF private key (required)
  CALLBACK_URL        Public callback URL (required)
  PORT                Server port (default: 8100)
  HOST                Bind address (default: 127.0.0.1)
  CHAIN               Chain name (default: VRSC)
  API_URL             Verus RPC endpoint
  CHAIN_IADDRESS      Chain i-address
  CORS_ORIGINS        Comma-separated allowed origins

Example:
  # Create .env with your credentials, then:
  verus-connect start

  # Or inline:
  SIGNING_IADDRESS=iYour... PRIVATE_KEY=UxYour... CALLBACK_URL=https://mysite.com/verusidlogin verus-connect start
`);
}

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

if (command !== 'start') {
  console.error(`Unknown command: ${command}\n`);
  printUsage();
  process.exit(1);
}

// ── Load .env ───────────────────────────────────────────────────────

const envPath = getFlag('env') || path.join(process.cwd(), '.env');
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: envPath });
} catch {
  // dotenv not available — rely on shell environment
}

// ── Read config ─────────────────────────────────────────────────────

const portRaw = getFlag('port') || process.env.PORT || '8100';
const PORT = parseInt(portRaw, 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`\nInvalid port: ${portRaw} (must be 1-65535)\n`);
  process.exit(1);
}
const HOST = getFlag('host') || process.env.HOST || '127.0.0.1';
const SIGNING_IADDRESS = process.env.SIGNING_IADDRESS || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
// Support both CALLBACK_URL and SERVER_URL (legacy sidecar format)
const CALLBACK_URL = process.env.CALLBACK_URL
  || (process.env.SERVER_URL ? `${process.env.SERVER_URL}/verusidlogin` : '');
const CHAIN = process.env.CHAIN || 'VRSC';
// Support both API_URL and API (legacy)
const API_URL = process.env.API_URL || process.env.API || 'https://api.verus.services';
const CHAIN_IADDRESS = process.env.CHAIN_IADDRESS || 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV';
const CORS_ORIGINS = getFlag('cors') || process.env.CORS_ORIGINS || '*';

// Validate required config
const missing: string[] = [];
if (!SIGNING_IADDRESS) missing.push('SIGNING_IADDRESS');
if (!PRIVATE_KEY) missing.push('PRIVATE_KEY');
if (!CALLBACK_URL) missing.push('CALLBACK_URL');

if (missing.length > 0) {
  console.error(`\nMissing required config: ${missing.join(', ')}`);
  console.error(`Set them in ${envPath} or as environment variables.\n`);
  console.error('Example .env:');
  console.error('  SIGNING_IADDRESS=iYourVerusID...');
  console.error('  PRIVATE_KEY=UxYourWIFKey...');
  console.error('  CALLBACK_URL=https://yoursite.com/verusidlogin\n');
  process.exit(1);
}

if (CALLBACK_URL && !CALLBACK_URL.startsWith('https://')) {
  console.warn(`\n  ⚠  CALLBACK_URL is not HTTPS: ${CALLBACK_URL}`);
  console.warn('  Verus Mobile will reject non-HTTPS callback URLs.\n');
}

// ── Create server ───────────────────────────────────────────────────

const express = require('express');
const cors = require('cors');

const app = express();

// CORS
if (CORS_ORIGINS === '*') {
  app.use(cors());
} else {
  app.use(cors({ origin: CORS_ORIGINS.split(',').map((s: string) => s.trim()) }));
}

app.use(express.json({ limit: '1mb' }));

// Mount verusAuth middleware at root
app.use('/', verusAuth({
  iAddress: SIGNING_IADDRESS,
  privateKey: PRIVATE_KEY,
  callbackUrl: CALLBACK_URL,
  chain: CHAIN,
  apiUrl: API_URL,
  chainIAddress: CHAIN_IADDRESS,
}));

// ── Start ───────────────────────────────────────────────────────────

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  verus-connect server running on http://${HOST}:${PORT}\n`);
  console.log(`  Chain:     ${CHAIN} (${CHAIN_IADDRESS})`);
  console.log(`  API:       ${API_URL}`);
  console.log(`  Signing:   ${SIGNING_IADDRESS}`);
  console.log(`  Callback:  ${CALLBACK_URL}`);
  console.log(`  CORS:      ${CORS_ORIGINS}`);
  console.log();
  console.log('  Endpoints:');
  console.log('    POST /login              Create login challenge');
  console.log('    POST /verusidlogin       Wallet callback (auto)');
  console.log('    GET  /result/:id         Poll challenge status');
  console.log('    POST /pay-deeplink       Generate payment deep link');
  console.log('    GET  /health             Health check');
  console.log();
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
