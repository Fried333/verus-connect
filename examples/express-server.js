/**
 * Minimal Express server with VerusID login.
 *
 * Setup:
 *   npm install express verus-connect
 *   npm install git+https://github.com/VerusCoin/verusid-ts-client.git
 *
 * Environment variables:
 *   VERUS_ID       — Your app's VerusID i-address
 *   VERUS_WIF      — WIF private key for that identity
 *   CALLBACK_URL   — Public URL to this server's /verusidlogin endpoint (e.g. https://mysite.com/auth/verus/verusidlogin)
 *   PORT           — Server port (default: 3000)
 *
 * Run:
 *   VERUS_ID=iYour... VERUS_WIF=UxYour... CALLBACK_URL=https://mysite.com/auth/verus/verusidlogin node express-server.js
 */

import express from 'express';
import { verusAuth } from 'verus-connect/server';

const app = express();
const PORT = process.env.PORT || 3000;

// ── VerusID Login — 5 lines ───────────────────────────────────────────

app.use('/auth/verus', verusAuth({
  iAddress: process.env.VERUS_ID,
  privateKey: process.env.VERUS_WIF,
  callbackUrl: process.env.CALLBACK_URL, // e.g. https://mysite.com/auth/verus/verusidlogin

  // Optional: called when a user successfully logs in
  // Return data here and it will be passed to the frontend via the status endpoint
  async onLogin({ iAddress, friendlyName, challengeId }) {
    console.log(`User logged in: ${friendlyName} (${iAddress})`);

    // Example: create a session token and return it
    // const token = jwt.sign({ iAddress }, SECRET, { expiresIn: '4h' });
    // return { token };

    return { message: 'Welcome!' };
  },
}));

// ── Serve the frontend example ────────────────────────────────────────

app.use(express.static('.'));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`VerusID login at /auth/verus/login`);
  console.log(`Webhook at /auth/verus/verusidlogin`);
  console.log(`Health check at /auth/verus/health`);
});
