# verus-connect v4

VerusID authentication for any website. Two modes:

- **Daemon mode** — connects to a local Verus daemon. Full node required (~16GB RAM).
- **Lite mode** — signs offline with a WIF key, verifies via a public node. No daemon needed.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- Git

### Daemon Mode

Requires [verusd](https://verus.io/wallet) running locally.

```bash
# Clone
git clone https://github.com/Fried333/verus-connect.git
cd verus-connect

# Install
npm install

# Build
npm run build

# Configure
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
# Clone
git clone https://github.com/Fried333/verus-connect.git
cd verus-connect

# Install base dependencies
npm install

# Install lite mode dependency (verusid-ts-client for offline signing)
npm run install:lite

# Build
npm run build

# Configure
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

Instead of running standalone, you can embed verus-connect in your own Express app:

```js
import { verusAuth } from 'verus-connect/server';
import express from 'express';

const app = express();

// Daemon mode
app.use('/auth/verus', verusAuth({
  iAddress: 'youridentity@',
  callbackUrl: 'https://yoursite.com/auth/verus/verusidlogin',
  rpcUrl: 'http://rpcuser:rpcpass@127.0.0.1:27486',
}));

// OR Lite mode
app.use('/auth/verus', verusAuth({
  iAddress: 'youridentity@',
  callbackUrl: 'https://yoursite.com/auth/verus/verusidlogin',
  privateKey: '<WIF key>',
  verifyNodeUrl: 'https://api.verus.services',
}));

app.listen(8100);
```

Mode is auto-detected: `rpcUrl` → daemon, `privateKey` → lite.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/login` | Create a login challenge → `{ challengeId, uri, deepLink }` |
| `POST` | `/verusidlogin` | Receive signed response from wallet → `{ status: "ok" }` |
| `GET` | `/result/:challengeId` | Poll for result → `{ status: "pending" }` or `{ status: "verified", iAddress, friendlyName }` |
| `GET` | `/health` | Health check → `{ status: "ok", mode, activeChallenges }` |

## Login Flow

```
1. Your app        POST /login
                   ← { challengeId, uri, deepLink }

2. Show QR code    User scans deepLink with Verus Mobile
                   OR browser extension intercepts it

3. Wallet signs    User approves → wallet POSTs to callbackUrl
                   POST /verusidlogin → { status: "ok" }

4. Your app polls  GET /result/:challengeId
                   ← { status: "verified", iAddress: "i...", friendlyName: "user@" }

5. Done            Create session / JWT with the verified identity
```

## Configuration

| Variable | Required | Mode | Description |
|----------|----------|------|-------------|
| `SIGNING_IADDRESS` | Yes | Both | VerusID to sign challenges with |
| `CALLBACK_URL` | Yes | Both | URL where wallets POST signed responses |
| `RPC_URL` | Yes | Daemon | Local daemon RPC (e.g. `http://user:pass@127.0.0.1:27486`) |
| `PRIVATE_KEY` | Yes | Lite | WIF private key for offline signing |
| `VERIFY_NODE_URL` | Yes | Lite | Public node URL for verification |
| `PORT` | No | Both | Server port (default: 8100) |
| `HOST` | No | Both | Server host (default: 127.0.0.1) |
| `CORS_ORIGINS` | No | Both | Allowed origins, comma-separated (default: *) |
| `CHAIN_IADDRESS` | No | Both | Chain i-address (default: VRSC mainchain) |

## Dependencies

```
verus-connect v4.0.0
├── express 4.22.1                  HTTP server
└── verus-typescript-primitives     VDXF protocol (login challenges, signatures)
    ├── base64url
    ├── blake2b
    ├── bn.js
    ├── bs58check
    ├── create-hash
    └── bech32

Lite mode additionally requires:
└── verusid-ts-client               Offline signing (npm run install:lite)
```

**2 production dependencies. 0 vulnerabilities.**

## Differences from v3

| | v3 | v4 |
|---|---|---|
| Dependencies | express, cors, dotenv + verusid-ts-client (broken install) | express + verus-typescript-primitives |
| Modes | Single (needed verusid-ts-client always) | Daemon (no extra deps) + Lite (optional dep) |
| Signing | Always offline via @bitgo/utxo-lib | Daemon: RPC signdata. Lite: verusid-ts-client |
| cors/dotenv | External packages | Built-in (removed deps) |
| Install | Broken (dead upstream dependency in @bitgo/utxo-lib) | Works cleanly |

## Security

- **Daemon mode**: Private keys never leave the daemon. Only RPC calls.
- **Lite mode**: WIF key held in memory. Protect your `.env`.
- **Verification**: Always via a Verus node (local or remote) to check on-chain identity state.
- **Rate limiting**: 10 challenges/minute per IP.
- **Challenge expiry**: 5 minutes.
- **No remote code**: Everything bundled at build time.

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
ExecStart=/usr/bin/node dist/cli.cjs start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## License

MIT
