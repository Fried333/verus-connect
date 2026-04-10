# verus-connect v4

VerusID authentication, payments, and identity requests for any website. Two modes:

- **Daemon mode** — connects to a local Verus daemon. Full node required (~16GB RAM).
- **Lite mode** — signs offline with a WIF key, verifies via a public node. No daemon needed.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- Git

### Daemon Mode

Requires [verusd](https://verus.io/wallet) running locally.

```bash
git clone https://github.com/Fried333/verus-connect.git
cd verus-connect
npm install
npm run build
cp .env.example .env
```

Edit `.env`:
```env
SIGNING_IADDRESS=youridentity@
CALLBACK_URL=https://yoursite.com/verus/verusidlogin
RPC_URL=http://rpcuser:rpcpassword@127.0.0.1:27486
PORT=8100
```

Find your RPC credentials in `~/.komodo/VRSC/VRSC.conf`:
```bash
cat ~/.komodo/VRSC/VRSC.conf | grep -E "rpcuser|rpcpassword"
```

Start:
```bash
npm start
```

### Lite Mode

No daemon needed. Requires a WIF private key and a public Verus node for verification.

```bash
git clone https://github.com/Fried333/verus-connect.git
cd verus-connect
npm install
npm run build
cp .env.example .env
```

Edit `.env`:
```env
SIGNING_IADDRESS=youridentity@
CALLBACK_URL=https://yoursite.com/verus/verusidlogin
PRIVATE_KEY=<your WIF private key>
VERIFY_NODE_URL=https://api.verus.services
PORT=8100
```

To get your WIF private key:
```bash
verus dumpprivkey "youridentity@"
```

> **Security:** Keep your `.env` file private. Run `chmod 600 .env`.

Start:
```bash
npm start
```

## As Express Middleware

Embed verus-connect in your own Express app:

```js
import { verusAuth } from 'verus-connect/server';
import express from 'express';

const app = express();

// Daemon mode
app.use('/verus', verusAuth({
  iAddress: 'youridentity@',
  callbackUrl: 'https://yoursite.com/verus/verusidlogin',
  rpcUrl: 'http://rpcuser:rpcpass@127.0.0.1:27486',
}));

// OR Lite mode
app.use('/verus', verusAuth({
  iAddress: 'youridentity@',
  callbackUrl: 'https://yoursite.com/verus/verusidlogin',
  privateKey: '<WIF key>',
  verifyNodeUrl: 'https://api.verus.services',
}));

app.listen(8100);
```

Mode is auto-detected: `rpcUrl` → daemon, `privateKey` → lite.

## API Endpoints

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/login` | Create a login challenge → `{ challengeId, deepLink }` |
| `POST` | `/verusidlogin` | Receive signed response from wallet → `{ status: "ok" }` |
| `GET` | `/result/:challengeId` | Poll for result → `{ status: "pending" }` or `{ status: "verified", iAddress, friendlyName }` |

### Payments & Requests

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/pay-deeplink` | Generate a VerusPay invoice deep link → `{ deep_link, resolved_address }` |
| `POST` | `/generic-request` | Create a GenericRequest deep link → `{ deep_link, qr_string }` |
| `POST` | `/identity-update-request` | Create an identity update request → `{ deep_link, qr_string }` |

### System

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check → `{ status: "ok", mode, primitivesLoaded }` |

## Login Flow

```
1. Your app        POST /login
                   ← { challengeId, deepLink }

2. Show QR code    User scans deepLink with Verus Mobile or Web Wallet

3. Wallet signs    User approves → wallet POSTs to callbackUrl
                   POST /verusidlogin → { status: "ok" }

4. Your app polls  GET /result/:challengeId
                   ← { status: "verified", iAddress: "i...", friendlyName: "user@" }

5. Done            Create session / JWT with the verified identity
```

## Payment Flow

```
1. Your app        POST /pay-deeplink
                   { address: "alice@", amount: 1.5 }
                   ← { deep_link: "vrsc://...", resolved_address: "i..." }

2. Show QR code    Encode deep_link as QR code

3. User scans      Verus Mobile shows payment confirmation

4. User pays       Transaction broadcast on-chain
```

## Identity Update Flow

```
1. Your app        POST /identity-update-request
                   { identity: "alice@", updates: { contentmultimap: { ... } } }
                   ← { deep_link: "vrsc://...", qr_string: "..." }

2. Show QR code    User scans, wallet shows proposed changes

3. User approves   Wallet signs and broadcasts updateidentity transaction
```

## Configuration

| Variable | Required | Mode | Description |
|----------|----------|------|-------------|
| `SIGNING_IADDRESS` | Yes | Both | VerusID to sign challenges with |
| `CALLBACK_URL` | Yes | Both | URL where wallets POST signed responses |
| `RPC_URL` | Yes | Daemon | Local daemon RPC (e.g. `http://user:pass@127.0.0.1:27486`) |
| `PRIVATE_KEY` | Yes | Lite | WIF private key for offline signing |
| `VERIFY_NODE_URL` | Yes | Lite | Public node URL for verification |
| `API_URL` | No | Both | Public API for identity resolution (default: `https://api.verus.services`) |
| `PORT` | No | Both | Server port (default: 8100) |
| `HOST` | No | Both | Server host (default: 127.0.0.1) |
| `CORS_ORIGINS` | No | Both | Allowed origins, comma-separated (default: * — restrict in production) |
| `CHAIN_IADDRESS` | No | Both | Chain i-address (default: VRSC mainchain) |

## Dependencies

```
verus-connect v4
├── express                         HTTP server
└── verus-typescript-primitives     Payload serialisation (invoices, requests, deep links)
    ├── bs58check                   Address encoding
    ├── bn.js                       Big number arithmetic
    ├── base64url                   Deep link encoding
    ├── create-hash                 Hashing
    └── blake2b                     Hashing
```

**2 production dependencies. 0 vulnerabilities. No verusid-ts-client.**

Primitives dependency pinned to a specific commit hash for supply chain safety.

## Security

- **Daemon mode**: Private keys never leave the daemon. Only RPC calls.
- **Lite mode**: WIF key held in memory only. Never logged, never returned in any response. Protect your `.env`.
- **Rate limiting**: 30 requests/minute per IP on all POST routes. Rate limit state auto-cleaned every 2 minutes.
- **Input validation**: All user inputs validated — addresses (alphanumeric only), amounts (positive, max 1 trillion), flags (0-15), minimumsignatures (1-13), VDXF keys (i-address format).
- **Error sanitisation**: Internal error details never reflected to clients.
- **Challenge expiry**: 5 minutes. Auto-cleaned every 60 seconds.
- **Body size limits**: 10KB (pay-deeplink), 100KB (generic-request, identity-update), 1MB (wallet callback).
- **CORS**: Configurable. Default `*` — set `CORS_ORIGINS` to your domain in production.
- **No remote code**: Everything bundled at build time. Dependency pinned to specific commit.

## Deploying with systemd

```ini
[Unit]
Description=Verus Connect
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/verus-connect
Environment=SIGNING_IADDRESS=youridentity@
Environment=CALLBACK_URL=https://yoursite.com/verus/verusidlogin
Environment=RPC_URL=http://user:pass@127.0.0.1:27486
Environment=PORT=8100
Environment=CORS_ORIGINS=https://yoursite.com
ExecStart=/usr/bin/node dist/cli.cjs start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## License

MIT
