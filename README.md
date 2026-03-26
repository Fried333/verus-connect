# verus-connect v4

Drop-in VerusID authentication for any website. Two modes, minimal dependencies.

## Modes

### Daemon Mode
Connects to a local Verus daemon for signing and verification. Zero crypto dependencies — the daemon handles everything.

```
Your Server ←→ verus-connect ←→ verusd (local)
```

### Standalone Mode
Signs with a WIF private key using Node.js built-in crypto. Verifies signatures via a public Verus node. No local daemon required.

```
Your Server ←→ verus-connect ←→ Public Verus Node (verification only)
```

## Dependencies

```
verus-connect v4.0.0
├── express 4.22.1              (HTTP server)
│   ├── body-parser
│   ├── cookie
│   ├── qs
│   └── ... (express internals)
└── verus-typescript-primitives (VDXF protocol objects)
    ├── base64url 3.0.1
    ├── blake2b (VerusCoin fork)
    ├── bn.js 5.2.3
    ├── bs58check 2.0.0
    ├── create-hash 1.2.0
    └── bech32 2.0.0
```

**2 direct dependencies. 0 vulnerabilities.**

### What changed from v3

| | v3 | v4 |
|---|---|---|
| **Dependencies** | express, cors, dotenv, verusid-ts-client (optional peer) | express, verus-typescript-primitives |
| **Crypto** | Delegated to verusid-ts-client + @bitgo/utxo-lib | Daemon RPC or Node.js built-in crypto |
| **Install** | Broken — verusid-ts-client has dead upstream dep | Works — all deps install cleanly |
| **Modes** | Single (needed verusid-ts-client) | Daemon mode + Standalone mode |
| **cors** | External dependency | Inline handler (removed dep) |
| **dotenv** | External dependency | Inline .env parser (removed dep) |

## Quick Start

### As a standalone server

```bash
# Clone and install
git clone https://github.com/Fried333/verus-connect.git
cd verus-connect
npm install

# Configure
cp .env.example .env
# Edit .env with your settings

# Build and run
npm run build
npm start
```

### As Express middleware

```js
import { verusAuth } from 'verus-connect/server';

// Daemon mode — signs via local verusd
app.use('/auth/verus', verusAuth({
  iAddress: 'youridentity@',
  callbackUrl: 'https://yoursite.com/auth/verus/verusidlogin',
  rpcUrl: 'http://rpcuser:rpcpass@127.0.0.1:27486',
}));

// Standalone mode — signs with WIF key, verifies via public node
app.use('/auth/verus', verusAuth({
  iAddress: 'youridentity@',
  callbackUrl: 'https://yoursite.com/auth/verus/verusidlogin',
  privateKey: '<WIF private key>',
  verifyNodeUrl: 'https://api.verus.io',
}));
```

Mode is auto-detected: if `rpcUrl` is provided → daemon mode. If `privateKey` is provided → standalone mode.

## API Endpoints

The middleware mounts these routes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/verusidlogin` | Creates a new login challenge, returns `{ deepLink, challengeId }` |
| POST | `/verusidlogin` | Receives the signed response from the wallet |
| GET | `/result/:id` | Poll for login result — returns `{ success, identityAddress, friendlyName }` |

## Login Flow

```
1. Website                          GET /verusidlogin
   ← { deepLink: "verus:///1/...", challengeId: "abc" }

2. Website redirects user to deepLink
   → Verus wallet intercepts the verus:// URI

3. Wallet shows approval popup
   → User picks identity, clicks Approve
   → Wallet signs challenge with daemon/key
   → Wallet POSTs signed response to callbackUrl

4. verus-connect                    POST /verusidlogin
   → Verifies signature (via daemon or public node)
   → Stores result

5. Website                          GET /result/abc
   ← { success: true, identityAddress: "i...", friendlyName: "user.bitcoins@" }
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SIGNING_IADDRESS` | Yes | VerusID to sign challenges with |
| `CALLBACK_URL` | Yes | Where wallets POST signed responses |
| `MODE` | No | `daemon` or `standalone` (auto-detected) |
| `RPC_URL` | Daemon mode | Local daemon RPC URL (e.g. `http://user:pass@127.0.0.1:27486`) |
| `PRIVATE_KEY` | Standalone mode | WIF private key for signing |
| `VERIFY_NODE_URL` | Standalone mode | Public Verus node URL for verification |
| `PORT` | No | Server port (default: 8100) |
| `HOST` | No | Server host (default: 127.0.0.1) |
| `CORS_ORIGINS` | No | Comma-separated allowed origins (default: *) |
| `CHAIN_IADDRESS` | No | Chain i-address (default: VRSC) |

### Daemon Mode Config (.env)

```env
SIGNING_IADDRESS=youridentity@
CALLBACK_URL=https://yoursite.com/auth/verus/verusidlogin
RPC_URL=http://rpcuser:rpcpassword@127.0.0.1:27486
```

### Standalone Mode Config (.env)

```env
SIGNING_IADDRESS=youridentity@
CALLBACK_URL=https://yoursite.com/auth/verus/verusidlogin
PRIVATE_KEY=<WIF private key>
VERIFY_NODE_URL=https://api.verus.io
```

## Security

- **Daemon mode**: Private keys never leave the daemon. verus-connect only makes RPC calls.
- **Standalone mode**: WIF key is held in memory. Use `chmod 600 .env` and don't commit it.
- **Verification**: Always done via a Verus node (local or remote) to check on-chain identity state.
- **Challenge expiry**: Challenges expire after 5 minutes.
- **No external code**: Everything bundled at build time. No CDN, no remote imports.
- **0 known vulnerabilities** as of v4.0.0.

## License

MIT
