# verus-connect-v2

Drop-in VerusID login for any website. One package — standalone server, Express middleware, and frontend SDK.

## What This Is

VerusID is a self-sovereign identity system on the Verus blockchain. Users own their identity — no passwords, no email, no third-party accounts. They prove who they are by signing a cryptographic challenge with their VerusID.

**verus-connect** packages the entire login flow into a simple integration:

- **Standalone server** — zero-code sidecar, just configure and run
- **Express middleware** — embed into your existing app
- **Frontend SDK** — auto-detects the user's wallet, shows QR codes or triggers the extension, and polls for the result

You get VerusID login working in zero lines of code (standalone) or ~10 lines (middleware).

## How It Works

```
Your Website                    Your Server (middleware)           User's Wallet
     |                                |                               |
     |  1. User clicks "Login"        |                               |
     |  -------- POST /login -------> |                               |
     |  <------ { uri, challengeId }  |                               |
     |                                |                               |
     |  2. SDK auto-detects:          |                               |
     |     - Extension? Send uri      |                               |
     |     - Mobile? Show deep link   |                               |
     |     - Desktop? Show QR code    |                               |
     |                                |                               |
     |                                |  3. Wallet receives challenge  |
     |                                |  <-- POST /verusidlogin -------|
     |                                |  Verify signature              |
     |                                |  Store result                  |
     |                                |                               |
     |  4. SDK polls every 3s         |                               |
     |  ------- GET /result/:id ----> |                               |
     |  <------ { verified, iAddress} |                               |
     |                                |                               |
     |  5. Done! User is logged in    |                               |
```

## Prerequisites

You need a **VerusID** for your app. This is the identity that signs login challenges — it proves to users that the login request is legit (anti-phishing).

**How to get one:**
1. Install [Verus Desktop](https://verus.io/wallet) or [Verus Mobile](https://verus.io/wallet)
2. Create a VerusID (costs a small amount of VRSC)
3. Export the WIF private key for that identity

You'll use the i-address and WIF key in your server config.

## Quick Start

### Option A: Standalone Server (Zero Code)

No Express boilerplate needed. Just install, configure, and run.

```bash
npm install verus-connect
npm install git+https://github.com/VerusCoin/verusid-ts-client.git
```

Create a `.env` file:

```env
SIGNING_IADDRESS=iYourVerusID...
PRIVATE_KEY=UxYourWIFKey...
CALLBACK_URL=https://yoursite.com/verusidlogin
```

Start:

```bash
npx verus-connect start
```

That's it. The server runs on port 8100 with all endpoints ready. Use with PM2 for production:

```bash
pm2 start npx --name verus-sidecar -- verus-connect start
```

CLI options:

```
verus-connect start [options]
  --port <number>     Override PORT (default: 8100)
  --host <address>    Override HOST (default: 127.0.0.1)
  --env <path>        Path to .env file (default: ./.env)
  --cors <origins>    Comma-separated CORS origins (default: *)
```

Put it behind nginx and proxy `/verus/` to `http://127.0.0.1:8100/`. Done.

### Option B: Express Middleware (Embed in Your App)

```bash
npm install verus-connect
npm install git+https://github.com/VerusCoin/verusid-ts-client.git
```

```javascript
const express = require('express');
const { verusAuth } = require('verus-connect/server');

const app = express();

app.use('/auth/verus', verusAuth({
  iAddress: process.env.VERUS_ID,        // Your VerusID i-address
  privateKey: process.env.VERUS_WIF,      // WIF private key
  callbackUrl: 'https://mysite.com/auth/verus/verusidlogin',  // Public webhook URL
}));

app.listen(3000);
```

This creates five routes:

| Route | Method | Purpose |
|-------|--------|---------|
| `/auth/verus/login` | POST | Create a new login challenge |
| `/auth/verus/verusidlogin` | POST | Receives signed response from wallet |
| `/auth/verus/result/:id` | GET | Frontend polls this for the result |
| `/auth/verus/pay-deeplink` | POST | Generate a VerusPay invoice deep link |
| `/auth/verus/health` | GET | Health check |

### Frontend Setup (5 lines)

```html
<script type="module">
  import { VerusConnect } from 'verus-connect';

  const vc = new VerusConnect({
    appName: 'My App',
    serverUrl: '/auth/verus',
  });

  document.getElementById('login-btn').addEventListener('click', async () => {
    const result = await vc.login();
    console.log(result.iAddress);     // "iABC123..."
    console.log(result.friendlyName); // "alice@"
    console.log(result.method);       // "extension", "qr", or "deeplink"
  });
</script>
```

**That's it.** The SDK automatically:
- Detects if the Verus Web Wallet extension is installed → sends the challenge directly
- On mobile → shows an "Open in Verus Mobile" button
- On desktop without extension → shows a QR code to scan with Verus Mobile
- Polls your server for the result
- Returns the user's i-address and friendly name

## What the User Sees

### Desktop with Verus Web Wallet Extension
The extension popup opens asking them to approve the login. The page shows a "Waiting for approval..." message.

### Desktop without Extension (QR Code)
A modal appears with a QR code. The user scans it with Verus Mobile, approves, and the modal closes automatically.

### Mobile Browser
A modal appears with an "Open in Verus Mobile" button. Tapping it launches the Verus Mobile app. After approving, they return to the browser and the login completes.

## Configuration

### Server Options

```javascript
verusAuth({
  // Required
  iAddress: 'iYour...',         // Your app's VerusID i-address
  privateKey: 'UxYour...',      // WIF private key
  callbackUrl: 'https://...',   // Public URL to the /verusidlogin endpoint

  // Optional
  chain: 'VRSC',                              // Chain name (default: 'VRSC')
  apiUrl: 'https://api.verus.services',       // Verus API endpoint
  chainIAddress: 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV', // Chain i-address
  challengeTtl: 300000,                       // Challenge expiry in ms (default: 5 min)

  // Hook: called when a login is verified
  async onLogin({ iAddress, friendlyName, challengeId }) {
    // Create a JWT, save to database, etc.
    const token = jwt.sign({ iAddress }, SECRET);
    return { token }; // Returned data is passed to the frontend via /result
  },
})
```

### Frontend Options

```javascript
new VerusConnect({
  // Simple mode — just point to your server
  serverUrl: '/auth/verus',

  // Or advanced mode — bring your own functions
  getChallenge: async () => {
    const res = await fetch('/my/custom/endpoint', { method: 'POST' });
    const data = await res.json();
    return { uri: data.deepLink, challengeId: data.id };
  },
  getResult: async (challengeId) => {
    const res = await fetch(`/my/custom/result/${challengeId}`);
    return await res.json();
    // Must return { status: 'pending' | 'verified' | 'error', iAddress?, friendlyName?, data? }
  },

  // Display
  appName: 'My App',            // Shown in the modal title

  // Timing
  pollInterval: 3000,           // How often to poll in ms (default: 3000)
  pollTimeout: 300000,          // Give up after ms (default: 5 min)

  // Theme
  theme: {
    primaryColor: '#3165D4',
    backgroundColor: '#1a1a2e',
    textColor: '#e0e0e0',
    overlayColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: '16px',
    fontFamily: 'system-ui, sans-serif',
  },
})
```

## Events

```javascript
const vc = new VerusConnect({ serverUrl: '/auth/verus' });

vc.on('login:start', () => console.log('Login started'));
vc.on('login:success', (result) => console.log('Logged in:', result));
vc.on('login:error', (err) => console.error('Login failed:', err));
vc.on('login:cancel', () => console.log('User cancelled'));
vc.on('provider:detected', (env) => console.log('Environment:', env));
vc.on('modal:open', () => console.log('Modal opened'));
vc.on('modal:close', () => console.log('Modal closed'));
```

## Payments

### VerusPay Invoice Deep Links (Server)

Generate a deep link that opens Verus Mobile with a pre-filled payment request:

```javascript
// POST /auth/verus/pay-deeplink
const res = await fetch('/auth/verus/pay-deeplink', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address: 'RYourReceivingAddress...',  // R-address to receive payment
    amount: 1.5,                          // Amount in VRSC
    currency_id: 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV', // Optional, defaults to VRSC
  }),
});
const { deep_link } = await res.json();
// deep_link: "i5jtwbp6zymeay9llnraglgjqgdrffsau4://x-callback-url/..."
```

Use the deep link in an `<a>` tag or `window.location.href` to open Verus Mobile:

```html
<a href="${deep_link}">Pay with Verus Mobile</a>
```

### Sending via Web Wallet Extension (Frontend)

Sending VRSC via the browser extension:

```javascript
const result = await vc.send({
  to: 'RAddress...',
  amount: 1.5,
  currency: 'VRSC',  // optional, defaults to 'VRSC'
});
console.log(result.txid); // Transaction ID
```

## Using with React

```jsx
import { VerusConnect } from 'verus-connect';
import { useRef, useCallback } from 'react';

function LoginButton() {
  const vcRef = useRef(new VerusConnect({
    appName: 'My React App',
    serverUrl: '/auth/verus',
  }));

  const handleLogin = useCallback(async () => {
    try {
      const result = await vcRef.current.login();
      // Save to state, redirect, etc.
      console.log('Logged in as', result.friendlyName);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
      }
    }
  }, []);

  return <button onClick={handleLogin}>Login with VerusID</button>;
}
```

## Webhook vs Redirect: Which Key to Use

When building a custom VerusID login (without verus-connect), you need to include a `redirect_uri` in your login challenge. The VDXF key you use determines how the wallet sends back the signed response:

| Key | Constant | How it works |
|-----|----------|-------------|
| **Webhook** | `LOGIN_CONSENT_WEBHOOK_VDXF_KEY` | Wallet POSTs the signed response directly to your server (server-to-server) |
| **Redirect** | `LOGIN_CONSENT_REDIRECT_VDXF_KEY` | Wallet redirects the user's browser to your callback URL |

**Use the Webhook key.** It works with both Verus Mobile and the Verus Web Wallet extension. The Redirect key only works with Verus Mobile — the web wallet extension will reject the challenge with "No webhook URI found."

verus-connect uses the Webhook key automatically, so if you're using this library you don't need to worry about it. This only matters if you're constructing login challenges manually:

```javascript
// Correct — works with all wallets
new RedirectUri(callbackUrl, LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid)

// Will NOT work with the web wallet extension
new RedirectUri(callbackUrl, LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid)
```

## Advanced: Custom Backend

If you're not using Express, or want full control over the server logic, skip the middleware and just implement three endpoints that the frontend SDK expects:

**POST /login** — Returns:
```json
{ "uri": "verus://...", "challengeId": "iABC..." }
```

**POST /verusidlogin** — Receives the signed response from the wallet. Verify it and store the result.

**GET /result/:challengeId** — Returns:
```json
{ "status": "pending" }
// or
{ "status": "verified", "iAddress": "iXYZ...", "friendlyName": "alice@", "data": { "token": "jwt..." } }
// or
{ "status": "error", "error": "Challenge expired" }
```

Then point the frontend at your endpoints:

```javascript
const vc = new VerusConnect({ serverUrl: 'https://myapi.com/auth/verus' });
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  verus-connect package                                          │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  CLI Server       │  │  Middleware       │  │  Frontend SDK│  │
│  │  (verus-connect   │  │  (verus-connect/  │  │  (verus-     │  │
│  │   start)          │  │   server)         │  │   connect)   │  │
│  │                   │  │                   │  │              │  │
│  │  Zero-code        │  │  Embed in your    │  │  Browser-side│  │
│  │  standalone       │  │  Express app      │  │  QR + modal  │  │
│  │  sidecar          │  │                   │  │  + polling   │  │
│  └────────┬──────────┘  └────────┬──────────┘  └──────┬───────┘  │
│           │                      │                     │          │
│           └──────────┬───────────┘                     │          │
│                      │                                 │          │
│              verusid-ts-client                         │          │
│              (peer dependency)                         │          │
│              Crypto signing &                          │          │
│              verification                              │          │
└──────────────────────┼─────────────────────────────────┼──────────┘
                       │                                 │
                       ▼                                 ▼
              ┌─────────────────┐               ┌──────────────┐
              │  Verus Network  │               │  User's      │
              │  (RPC API)      │               │  Browser     │
              └─────────────────┘               └──────────────┘
```

**Standalone mode** (`verus-connect start`) runs the middleware inside its own Express server — no code to write. Behind nginx, it becomes a sidecar that any app can talk to.

**Middleware mode** (`verusAuth()`) mounts directly in your Express app — same routes, more control (e.g. `onLogin` hook for JWTs).

**Frontend SDK** (`VerusConnect`) works with either mode. Point `serverUrl` at wherever the middleware is running.

## Deployment

### Standalone Server + nginx (Recommended)

This is the simplest production setup. The verus-connect server runs as a sidecar on `127.0.0.1:8100`, nginx proxies a path to it.

**1. Install on your server:**

```bash
mkdir /var/www/verus-sidecar && cd /var/www/verus-sidecar
npm init -y
npm install verus-connect
npm install git+https://github.com/VerusCoin/verusid-ts-client.git
```

**2. Create `.env`:**

```env
SIGNING_IADDRESS=iYourVerusID...
PRIVATE_KEY=UxYourWIFKey...
CALLBACK_URL=https://yoursite.com/verus/verusidlogin
PORT=8100
HOST=127.0.0.1
```

The `CALLBACK_URL` must be the public URL that Verus Mobile can reach. It must match the nginx path you configure below.

**3. Start with PM2:**

```bash
pm2 start npx --name verus-sidecar -- verus-connect start
pm2 save
```

**4. nginx config:**

```nginx
# Add this inside your server { } block
location /verus/ {
    proxy_pass http://127.0.0.1:8100/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

```bash
nginx -t && systemctl reload nginx
```

**5. Test:**

```bash
curl -X POST https://yoursite.com/verus/login
# Should return { "challengeId": "i...", "uri": "...", "deepLink": "..." }

curl https://yoursite.com/verus/health
# Should return { "status": "ok", "verusLoaded": true, "activeChallenges": 0 }
```

**6. Frontend integration:**

Point your frontend at the nginx path:

```javascript
const vc = new VerusConnect({ serverUrl: '/verus' });
const result = await vc.login();
```

Or if you're not using the SDK, call the endpoints directly from your frontend code.

### Webhook URL Must Be Public

The wallet (Verus Mobile) POSTs the signed response to your `CALLBACK_URL`. This URL must be:
- Reachable from the internet (not localhost)
- HTTPS (Verus Mobile won't POST to plain HTTP)
- The full path including `/verusidlogin` (e.g. `https://yoursite.com/verus/verusidlogin`)

For local development, use a tunnel:

```bash
ngrok http 8100
# Then set CALLBACK_URL=https://abc123.ngrok.io/verusidlogin
```

### CORS

The standalone server handles CORS automatically (`*` by default). Restrict it in `.env`:

```env
CORS_ORIGINS=https://yoursite.com,https://app.yoursite.com
```

For middleware mode, configure CORS in your Express app:

```javascript
const cors = require('cors');
app.use(cors({ origin: 'https://mysite.com' }));
```

### Environment Variables

Never hardcode your WIF private key. Use `.env` or shell environment variables.

**Standalone mode (.env):**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SIGNING_IADDRESS` | Yes | — | Your app's VerusID i-address |
| `PRIVATE_KEY` | Yes | — | WIF private key for signing |
| `CALLBACK_URL` | Yes | — | Public URL to `/verusidlogin` endpoint |
| `PORT` | No | `8100` | Server port |
| `HOST` | No | `127.0.0.1` | Bind address |
| `CHAIN` | No | `VRSC` | Chain name |
| `API_URL` | No | `https://api.verus.services` | Verus RPC endpoint |
| `CHAIN_IADDRESS` | No | VRSC mainnet | Chain i-address |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins |

Legacy env var names (`SERVER_URL`, `API`) are also supported for backwards compatibility.

## Security

### Private Key Protection

Your WIF private key signs login challenges on behalf of your app's VerusID. If compromised, an attacker can impersonate your app and phish users.

- **Never commit your `.env` file** — add it to `.gitignore`
- **Restrict file permissions** — `chmod 600 .env`
- Use environment variables or a secrets manager (AWS Secrets Manager, Vault, etc.) instead of `.env` files in production
- The private key never leaves your server — it is only used server-side to sign challenges

### HTTPS Required

The `CALLBACK_URL` **must** be HTTPS in production. Verus Mobile will not POST signed responses to plain HTTP endpoints. This protects the signed challenge response from interception in transit.

For local development, use a tunnel like ngrok to get an HTTPS URL.

### CORS Configuration

The standalone server defaults to `CORS_ORIGINS=*` (allow all origins). **Restrict this in production** to only your frontend domain(s):

```env
CORS_ORIGINS=https://yoursite.com,https://app.yoursite.com
```

For middleware mode, configure CORS in your Express app before mounting the middleware.

### Challenge Expiry

Login challenges expire after 5 minutes by default (`challengeTtl: 300000`). This limits the window for replay attacks. Challenges are stored in memory and automatically cleaned up on expiry.

- Don't increase the TTL beyond what's necessary
- Each challenge can only be completed once — replaying a signed response for an already-resolved challenge will fail

### Bind to Localhost

The standalone server binds to `127.0.0.1` by default. **Never expose it directly to the internet.** Always put it behind a reverse proxy (nginx, Caddy, etc.) that handles TLS termination.

```env
HOST=127.0.0.1  # default — do not change to 0.0.0.0 in production
```

### Rate Limiting

verus-connect does not include built-in rate limiting. Add rate limiting at the reverse proxy level or in your Express app to prevent abuse:

```nginx
# nginx example
location /verus/ {
    limit_req zone=verus burst=10 nodelay;
    proxy_pass http://127.0.0.1:8100/;
}
```

```javascript
// Express example
const rateLimit = require('express-rate-limit');
app.use('/auth/verus/login', rateLimit({ windowMs: 60000, max: 20 }));
```

### Webhook Validation

The `/verusidlogin` endpoint receives POST requests from wallets. The middleware cryptographically verifies every signed response against the Verus blockchain — forged or tampered responses are rejected. No additional webhook signature validation is needed.

### onLogin Hook

Use the `onLogin` hook to issue your own session tokens (JWTs, cookies, etc.). The hook receives the verified `iAddress` and `friendlyName`. Don't trust the frontend — always verify the session server-side.

```javascript
verusAuth({
  // ...
  async onLogin({ iAddress }) {
    const token = jwt.sign({ iAddress }, SECRET, { expiresIn: '24h' });
    return { token };
  },
});
```

### In-Memory Challenge Store

Challenges are stored in-memory by default. This means:
- Restarting the server invalidates all pending challenges (users just retry)
- No sensitive data is persisted to disk
- In a multi-process setup (PM2 cluster mode), challenges are not shared across workers — use a single process or implement a shared store

## Troubleshooting

### "Cannot find module 'verusid-ts-client'"

This is a peer dependency. Install it alongside verus-connect:

```bash
npm install git+https://github.com/VerusCoin/verusid-ts-client.git
```

If it still fails with PM2, make sure PM2 starts from the correct directory:

```bash
pm2 start npx --name verus-sidecar --cwd /var/www/verus-sidecar -- verus-connect start
```

### Health check shows `verusLoaded: false`

The Verus crypto libraries failed to initialize. Check PM2 logs:

```bash
pm2 logs verus-sidecar --lines 20
```

Common causes:
- `verusid-ts-client` not installed
- Missing native dependencies (node-gyp build failures)

### QR code shows but login never completes

1. Check that `CALLBACK_URL` is reachable from the internet
2. The URL must be HTTPS
3. Test the callback endpoint directly: `curl -X POST https://yoursite.com/verus/verusidlogin`
4. Check nginx is proxying correctly to the sidecar port

### "Challenge not found or expired"

Challenges expire after 5 minutes. If you're getting this on the callback, the user took too long to approve. Increase the TTL:

```javascript
// Middleware mode
verusAuth({ ..., challengeTtl: 600000 }) // 10 minutes
```

### Login works but no friendly name returned

The sidecar calls the Verus RPC to resolve the friendly name. If `API_URL` is unreachable or the identity can't be resolved, the raw i-address is returned instead. This is non-fatal — the login still succeeds.

## API Reference

### `VerusConnect` (Frontend)

| Method | Returns | Description |
|--------|---------|-------------|
| `login(options?)` | `Promise<LoginResult>` | Start the login flow |
| `send(options)` | `Promise<SendResult>` | Send a transaction (extension only) |
| `cancel()` | `void` | Cancel the active login/send |
| `destroy()` | `void` | Clean up all resources |
| `getEnvironment()` | `WalletEnvironment` | Returns `'extension'`, `'mobile'`, or `'desktop'` |
| `isExtensionAvailable()` | `boolean` | Check for Verus Web Wallet |
| `on(event, listener)` | `void` | Subscribe to events |
| `off(event, listener)` | `void` | Unsubscribe from events |

### `verusAuth` (Server)

| Route | Method | Description |
|-------|--------|-------------|
| `/login` | POST | Create a new signed login challenge |
| `/verusidlogin` | POST | Receives signed response from wallet |
| `/result/:id` | GET | Poll for challenge result |
| `/pay-deeplink` | POST | Generate a VerusPay invoice deep link |
| `/health` | GET | Health check |

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

This software deals with cryptographic authentication and blockchain interactions. Users and integrators are solely responsible for:
- Securing their private keys and server infrastructure
- Validating that the software meets their security requirements before deployment
- Complying with applicable laws and regulations in their jurisdiction
- Any financial loss or security incidents resulting from the use of this software

This is open-source software maintained by the community. It has not been formally audited. Use at your own risk.

## License

MIT
