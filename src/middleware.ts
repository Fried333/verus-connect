import type { VerusAuthConfig, VerifiedLogin } from './types';
import crypto from 'crypto';
import { createRequire } from 'module';
import path from 'path';

// Resolve modules from the entry script's directory (not this bundle's location).
// require.main.filename is the app's index.js; process.argv[1] is a fallback.
// This ensures peer deps (express, verusid-ts-client) are found in the app's node_modules.
const entryScript = require.main?.filename ?? process.argv[1];
const baseDir = entryScript ? path.dirname(entryScript) : process.cwd();
const callerRequire = createRequire(path.join(baseDir, 'noop.js'));

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
    const client = callerRequire('verusid-ts-client');
    primitives = client.primitives;
    bs58check = callerRequire('verusid-ts-client/node_modules/bs58check');

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
    Router = callerRequire('express').Router;
  } catch {
    throw new Error('verus-connect: express is required for server middleware');
  }

  const router = Router();

  // Ensure JSON body parsing on these routes
  const jsonParser = callerRequire('express').json({ limit: '1mb' });

  // ── POST /login ─────────────────────────────────────────────────

  router.post('/login', async (_req: any, res: any) => {
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

      // Verify signature
      let verified = false;
      try {
        verified = await verusId.verifyLoginConsentResponse(response);
      } catch (verifyErr: any) {
        console.error('[verus-connect] Verification RPC unavailable:', verifyErr.message);
        return res.status(503).json({ error: 'Verification service unavailable — try again later' });
      }

      if (!verified) {
        return res.status(401).json({ error: 'Signature verification failed' });
      }

      // Extract challenge ID
      const cId = response.decision?.request?.challenge?.challenge_id;
      if (!cId || !challenges.has(cId)) {
        return res.status(404).json({ error: 'Challenge not found or expired' });
      }

      // Get friendly name
      let friendlyName = response.signing_id;
      try {
        const idResult = await verusId.interface.getIdentity(response.signing_id);
        if (idResult?.result?.identity?.name) {
          friendlyName = idResult.result.identity.name + '@';
        }
      } catch {
        // Use signing_id as fallback
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
