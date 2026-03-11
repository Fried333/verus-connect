import type { VerusAuthConfig, VerifiedLogin } from './types';
import crypto from 'crypto';
import { createRequire } from 'module';
import path from 'path';

// Smart module resolution: try multiple strategies to find peer deps.
// 1. Direct require (works when deps are bundled or in same node_modules)
// 2. cwd-based require (works with PM2, systemd, etc.)
// 3. Entry script-based require (original strategy)
function createSmartRequire() {
  const strategies: ReturnType<typeof createRequire>[] = [];

  // Strategy 1: cwd-based (most reliable with PM2/process managers)
  try {
    strategies.push(createRequire(path.join(process.cwd(), 'noop.js')));
  } catch { /* ignore */ }

  // Strategy 2: entry script-based (original approach)
  const entryScript = require.main?.filename ?? process.argv[1];
  if (entryScript) {
    try {
      const baseDir = path.dirname(entryScript);
      // Only add if different from cwd
      if (baseDir !== process.cwd()) {
        strategies.push(createRequire(path.join(baseDir, 'noop.js')));
      }
    } catch { /* ignore */ }
  }

  return (id: string) => {
    let lastErr: Error | undefined;
    for (const req of strategies) {
      try {
        return req(id);
      } catch (err: any) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error(`Cannot find module '${id}'`);
  };
}

const smartRequire = createSmartRequire();

// In-memory stores
const challenges = new Map<string, { created: number; deepLink: string }>();
const results = new Map<string, { iAddress: string; friendlyName: string; extra?: Record<string, unknown> }>();

// Lazy-loaded Verus libraries
let verusId: any = null;
let primitives: any = null;
let bs58check: any = null;
let initialized = false;

function initVerus(config: VerusAuthConfig): boolean {
  if (initialized) return !!verusId;

  try {
    const client = smartRequire('verusid-ts-client');
    primitives = client.primitives;
    bs58check = smartRequire('verusid-ts-client/node_modules/bs58check');

    const chain = config.chain ?? 'VRSC';
    const api = config.apiUrl ?? 'https://api.verus.services';
    const chainIAddress = config.chainIAddress ?? 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV';

    verusId = new client.VerusIdInterface(chain, api, chainIAddress);
    initialized = true;
    return true;
  } catch (err: any) {
    console.error('[verus-connect] Failed to load verusid-ts-client:', err.message);
    console.error('[verus-connect] Install it: npm install verusid-ts-client');
    initialized = true;
    return false;
  }
}

/** Generate a random i-address (hash160 with version byte 102) */
function randomIAddress(): string {
  if (!bs58check) return crypto.randomBytes(16).toString('hex');
  const buf = Buffer.alloc(21);
  buf[0] = 102; // 'i' prefix
  crypto.randomBytes(20).copy(buf, 1);
  return bs58check.encode(buf);
}

/** Clean up expired challenges */
function cleanup(ttl: number): void {
  const cutoff = Date.now() - ttl;
  for (const [id, data] of challenges) {
    if (data.created < cutoff) {
      challenges.delete(id);
      results.delete(id);
    }
  }
}

/**
 * Express middleware that adds VerusID login routes.
 *
 * Mounts four routes relative to where you attach it:
 *   POST /login              — create a new login challenge
 *   POST /verusidlogin       — receives the signed response from the wallet
 *   GET  /result/:id         — poll for the challenge result
 *   GET  /health             — health check
 *
 * Usage:
 *   app.use('/auth/verus', verusAuth({ iAddress, privateKey, callbackUrl }))
 */
export function verusAuth(config: VerusAuthConfig) {
  // Validate required config
  if (!config.iAddress) throw new Error('verus-connect: iAddress is required');
  if (!config.privateKey) throw new Error('verus-connect: privateKey is required');
  if (!config.callbackUrl) throw new Error('verus-connect: callbackUrl is required');

  const ttl = config.challengeTtl ?? 5 * 60 * 1000;

  // Initialize Verus libraries
  const verusReady = initVerus(config);

  // TTL cleanup every 60s
  const cleanupTimer = setInterval(() => cleanup(ttl), 60_000);
  // Don't prevent process exit
  if (cleanupTimer.unref) cleanupTimer.unref();

  // Use express.Router from the caller's node_modules
  let Router: any;
  try {
    Router = smartRequire('express').Router;
  } catch {
    throw new Error('verus-connect: express is required for server middleware');
  }

  const router = Router();

  // Ensure JSON body parsing on these routes
  const jsonParser = smartRequire('express').json({ limit: '1mb' });

  // ── Rate limiting (simple in-memory, per-IP) ─────────────────────
  const loginAttempts = new Map<string, number[]>();
  const MAX_CHALLENGES_PER_MIN = 10;

  function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || [];
    // Keep only attempts from the last 60 seconds
    const recent = attempts.filter(t => now - t < 60_000);
    loginAttempts.set(ip, recent);
    return recent.length >= MAX_CHALLENGES_PER_MIN;
  }

  function recordAttempt(ip: string): void {
    const attempts = loginAttempts.get(ip) || [];
    attempts.push(Date.now());
    loginAttempts.set(ip, attempts);
  }

  // Clean up rate limit entries every 5 minutes
  const rateLimitCleanup = setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [ip, attempts] of loginAttempts) {
      const recent = attempts.filter(t => t > cutoff);
      if (recent.length === 0) loginAttempts.delete(ip);
      else loginAttempts.set(ip, recent);
    }
  }, 300_000);
  if (rateLimitCleanup.unref) rateLimitCleanup.unref();

  // ── POST /login ─────────────────────────────────────────────────

  router.post('/login', async (_req: any, res: any) => {
    const clientIp = _req.ip || _req.connection?.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in a minute.' });
    }
    recordAttempt(clientIp);
    if (!verusId || !primitives) {
      return res.status(500).json({ error: 'Verus libraries not loaded. Install verusid-ts-client.' });
    }

    try {
      const challengeId = randomIAddress();
      const webhookKey = primitives.LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid;

      const challenge = new primitives.LoginConsentChallenge({
        challenge_id: challengeId,
        requested_access: [
          new primitives.RequestedPermission(primitives.IDENTITY_VIEW.vdxfid),
        ],
        redirect_uris: [
          new primitives.RedirectUri(config.callbackUrl, webhookKey),
        ],
        subject: [],
        provisioning_info: [],
        created_at: Number((Date.now() / 1000).toFixed(0)),
        salt: randomIAddress(),
      });

      const chainIAddress = config.chainIAddress ?? 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV';

      const request = await verusId.createLoginConsentRequest(
        config.iAddress,
        challenge,
        config.privateKey,
        null,
        null,
        chainIAddress,
      );

      const deepLink = request.toWalletDeeplinkUri();

      // Validate the generated deep link uses a safe Verus scheme.
      // This should always pass since we generated it, but protects against
      // bugs in verusid-ts-client that could produce unexpected URIs.
      const scheme = (deepLink || '').split('//')[0].toLowerCase();
      const safeSchemes = ['verus:', 'vrsc:', 'i5jtwbp6zymeay9llnraglgjqgdrffsau4:'];
      if (!safeSchemes.some(s => scheme === s)) {
        console.error(`[verus-connect] Generated unsafe deep link scheme: ${scheme}`);
        return res.status(500).json({ error: 'Generated deep link failed safety check' });
      }

      challenges.set(challengeId, { created: Date.now(), deepLink });

      return res.json({ challengeId, uri: deepLink, deepLink });
    } catch (err: any) {
      console.error('[verus-connect] Challenge creation failed:', err.message);
      return res.status(500).json({ error: 'Failed to create login challenge' });
    }
  });

  // ── POST /verusidlogin ──────────────────────────────────────────

  router.post('/verusidlogin', jsonParser, async (req: any, res: any) => {
    try {
      if (!verusId || !primitives) {
        return res.status(500).json({ error: 'Verus libraries not loaded' });
      }

      const response = new primitives.LoginConsentResponse(req.body);

      // Verify the cryptographic signature on the login consent response.
      // This proves the user actually controls the VerusID they claim to be.
      // If verification fails for ANY reason, we reject. No bypass.
      let verified = false;
      try {
        verified = await verusId.verifyLoginConsentResponse(response);
      } catch (verifyErr: any) {
        console.error('[verus-connect] Verification error:', verifyErr.message);
        return res.status(503).json({ error: 'Signature verification unavailable. The Verus RPC may be down.' });
      }

      if (!verified) {
        return res.status(401).json({ error: 'Signature verification failed' });
      }

      // Extract challenge ID
      const cId = response.decision?.request?.challenge?.challenge_id;
      if (!cId || !challenges.has(cId)) {
        return res.status(404).json({ error: 'Challenge not found or expired' });
      }

      // Get friendly name — prefer friendlyname (e.g. "player3.bitcoins@")
      // over fullyqualifiedname (e.g. "player3.bitcoins.VRSC@") since the
      // root chain (VRSC) is implied and shouldn't be shown to users.
      let friendlyName = response.signing_id;
      try {
        const idResult = await verusId.interface.getIdentity(response.signing_id);
        const idRes = idResult?.result;
        if (idRes?.friendlyname) {
          friendlyName = idRes.friendlyname;
        } else if (idRes?.fullyqualifiedname) {
          friendlyName = idRes.fullyqualifiedname;
        } else if (idRes?.identity?.name) {
          friendlyName = idRes.identity.name + '@';
        }
      } catch {
        // signing_id not resolvable — use as-is
      }

      // Store result
      const loginResult: VerifiedLogin = {
        iAddress: response.signing_id,
        friendlyName,
        challengeId: cId,
      };

      // Call onLogin hook if provided — lets the developer create sessions, JWTs, etc.
      let extra: Record<string, unknown> | undefined;
      if (config.onLogin) {
        try {
          const hookResult = await config.onLogin(loginResult);
          if (hookResult) extra = hookResult;
        } catch (hookErr: any) {
          console.error('[verus-connect] onLogin hook error:', hookErr.message);
        }
      }

      results.set(cId, { iAddress: response.signing_id, friendlyName, extra });

      return res.json({ status: 'ok' });
    } catch (err: any) {
      console.error('[verus-connect] Webhook error:', err.message);
      return res.status(500).json({ error: 'Verification error' });
    }
  });

  // ── GET /result/:challengeId ─────────────────────────────────────

  router.get('/result/:challengeId', (req: any, res: any) => {
    const { challengeId } = req.params;

    if (!challenges.has(challengeId)) {
      return res.status(404).json({ status: 'error', error: 'Challenge not found or expired' });
    }

    const result = results.get(challengeId);
    if (!result) {
      return res.json({ status: 'pending' });
    }

    return res.json({
      status: 'verified',
      iAddress: result.iAddress,
      friendlyName: result.friendlyName,
      data: result.extra,
    });
  });

  // ── POST /pay-deeplink ──────────────────────────────────────────
  // Generate a VerusPay invoice deep link for Verus Mobile payments.
  // Body: { address: string, amount: number, currency_id?: string }

  router.post('/pay-deeplink', jsonParser, (req: any, res: any) => {
    const { address, amount, currency_id } = req.body;
    if (!address || amount === undefined || amount === null) {
      return res.status(400).json({ error: 'address and amount are required' });
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (amount > 1e12) {
      return res.status(400).json({ error: 'amount exceeds maximum' });
    }
    if (typeof address !== 'string' || address.length < 20 || address.length > 100) {
      return res.status(400).json({ error: 'invalid address format' });
    }
    if (!primitives || !bs58check) {
      return res.status(503).json({ error: 'Verus libraries not loaded' });
    }
    try {
      const decoded = bs58check.decode(address);
      const pubKeyHash = decoded.slice(1); // skip version byte
      const sats = Math.round(amount * 1e8);
      const BN = smartRequire('verusid-ts-client/node_modules/bn.js');
      const chainId = currency_id || config.chainIAddress || 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV';

      // Use version 3 for broad Verus Mobile compatibility
      const VERSION_3 = new BN(3);

      const details = new primitives.VerusPayInvoiceDetails({
        amount: new BN(sats),
        destination: new primitives.TransferDestination({
          type: primitives.DEST_PKH,
          destination_bytes: pubKeyHash,
        }),
        requestedcurrencyid: chainId,
      }, VERSION_3);

      const invoice = new primitives.VerusPayInvoice({ details, version: VERSION_3 });
      const deepLink = invoice.toWalletDeeplinkUri();
      return res.json({ deep_link: deepLink });
    } catch (err: any) {
      console.error('[verus-connect] pay-deeplink error:', err.message);
      return res.status(500).json({ error: 'Failed to generate payment deep link' });
    }
  });

  // ── GET /health ──────────────────────────────────────────────────

  router.get('/health', (_req: any, res: any) => {
    res.json({
      status: 'ok',
      verusLoaded: !!verusId,
      activeChallenges: challenges.size,
    });
  });

  return router;
}
