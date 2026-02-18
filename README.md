# verus-connect

Drop-in VerusID login for any website. One package, both server and client.

## What This Is

VerusID is a self-sovereign identity system on the Verus blockchain. Users own their identity — no passwords, no email, no third-party accounts. They prove who they are by signing a cryptographic challenge with their VerusID.

**verus-connect** packages the entire login flow into a simple integration:

- **Server middleware** — creates signed challenges and verifies wallet responses
- **Frontend SDK** — auto-detects the user's wallet, shows QR codes or triggers the extension, and polls for the result

You get VerusID login working in ~10 lines of code.

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

### Install

```bash
npm install verus-connect express
npm install git+https://github.com/VerusCoin/verusid-ts-client.git
```

- `verus-connect` — this package (server middleware + frontend SDK)
- `verusid-ts-client` — Verus crypto library (creates & verifies challenges). Not on npm — installed from GitHub.
- `express` — web server (or use your own — the middleware is just a router)

### Server Setup (5 lines)

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

This creates four routes:

| Route | Method | Purpose |
|-------|--------|---------|
| `/auth/verus/login` | POST | Create a new login challenge |
| `/auth/verus/verusidlogin` | POST | Receives signed response from wallet |
| `/auth/verus/result/:id` | GET | Frontend polls this for the result |
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

## Sending Transactions

Sending VRSC requires the Verus Web Wallet browser extension:

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

## Deployment Notes

### Webhook URL Must Be Public

The wallet (Verus Mobile) needs to POST the signed response to your server. This means your `/verusidlogin` endpoint must be reachable from the internet over HTTPS.

For local development, use a tunnel like [ngrok](https://ngrok.com/) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/):

```bash
ngrok http 3000
# Then use the ngrok URL as your callbackUrl:
# callbackUrl: 'https://abc123.ngrok.io/auth/verus/verusidlogin'
```

### CORS

If your frontend is on a different origin than your API, make sure CORS is configured:

```javascript
const cors = require('cors');
app.use(cors({ origin: 'https://mysite.com' }));
```

### Environment Variables

Never hardcode your WIF private key. Use environment variables:

```bash
VERUS_ID=iYourVerusIDAddress
VERUS_WIF=UxYourWIFPrivateKey
CALLBACK_URL=https://mysite.com/auth/verus/verusidlogin
```

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
| `/health` | GET | Health check |

## License

MIT
