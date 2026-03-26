/**
 * Express middleware for VerusID authentication.
 * Auto-detects daemon vs lite mode from config.
 * Matches verus-connect v3 endpoint format exactly.
 */

import { Router, json as jsonParser } from 'express';
import { DaemonSigner } from './signer-daemon.js';
import { LiteSigner } from './signer-lite.js';
import { createChallenge, verifyResponse } from './auth.js';
import type { VerusConnectConfig, Signer } from './types.js';

export function verusAuth(config: VerusConnectConfig): Router {
  if (!config.callbackUrl) throw new Error('verus-connect: callbackUrl is required');
  if (!config.iAddress) throw new Error('verus-connect: iAddress is required');

  // Auto-detect mode
  let signer: Signer;
  const mode = config.mode || (config.rpcUrl ? 'daemon' : 'lite');

  if (mode === 'daemon') {
    if (!config.rpcUrl) throw new Error('verus-connect: rpcUrl is required for daemon mode');
    signer = new DaemonSigner(config.rpcUrl);
    console.log('[verus-connect] Mode: daemon');
  } else {
    if (!config.privateKey) throw new Error('verus-connect: privateKey is required for lite mode');
    if (!config.verifyNodeUrl) throw new Error('verus-connect: verifyNodeUrl is required for lite mode');
    signer = new LiteSigner(config.privateKey, config.verifyNodeUrl);
    console.log('[verus-connect] Mode: lite');
  }

  const chainIAddress = config.chainIAddress || 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV';

  // Challenge + result storage (in-memory, auto-expire after 5 min)
  const challenges = new Map<string, { created: number; deepLink: string }>();
  const results = new Map<string, { iAddress: string; friendlyName: string }>();

  // Cleanup expired challenges and results every 60s
  setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, data] of challenges) {
      if (data.created < cutoff) {
        challenges.delete(id);
        results.delete(id);
      }
    }
  }, 60_000);

  // Rate limiting: max 10 challenges per IP per minute
  const rateLimits = new Map<string, { count: number; reset: number }>();

  const router = Router();

  // ── POST /login — create a new login challenge ──
  // Response: { challengeId, uri, deepLink }

  router.post('/login', async (_req: any, res) => {
    // Rate limit
    const ip = _req.ip || _req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const limit = rateLimits.get(ip);
    if (limit && limit.reset > now && limit.count >= 10) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    if (!limit || limit.reset <= now) {
      rateLimits.set(ip, { count: 1, reset: now + 60_000 });
    } else {
      limit.count++;
    }

    try {
      const challenge = await createChallenge(signer, config.iAddress, config.callbackUrl, chainIAddress);
      challenges.set(challenge.id, { created: Date.now(), deepLink: challenge.deepLink });

      res.json({ challengeId: challenge.id, uri: challenge.deepLink, deepLink: challenge.deepLink });
    } catch (err: any) {
      console.error('[verus-connect] Challenge creation failed:', err.message);
      res.status(500).json({ error: 'Failed to create login challenge' });
    }
  });

  // ── POST /verusidlogin — receive signed response from wallet ──
  // Response: { status: 'ok' }

  router.post('/verusidlogin', jsonParser({ limit: '1mb' }), async (req, res) => {
    try {
      const body = req.body;
      const challengeId = body?.decision?.request?.challenge?.challenge_id
        || body?.decision?.decision_id;

      if (!challengeId || !challenges.has(challengeId)) {
        return res.status(404).json({ error: 'Challenge not found or expired' });
      }

      const { identityAddress, friendlyName } = await verifyResponse(signer, body, challengeId);

      results.set(challengeId, { iAddress: identityAddress, friendlyName });

      res.json({ status: 'ok' });
    } catch (err: any) {
      console.error('[verus-connect] Webhook error:', err.message);
      res.status(500).json({ error: 'Verification error' });
    }
  });

  // ── GET /result/:challengeId — poll for login result ──
  // Response: { status: 'pending' } | { status: 'verified', iAddress, friendlyName }

  router.get('/result/:challengeId', (req, res) => {
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
    });
  });

  // ── GET /health — health check ──

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode,
      activeChallenges: challenges.size,
    });
  });

  return router;
}
