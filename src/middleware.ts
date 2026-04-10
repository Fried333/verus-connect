/**
 * Express middleware for VerusID authentication, payments, and identity requests.
 * Auto-detects daemon vs lite mode from config.
 * V4 with v3 route compatibility: login, pay-deeplink, generic-request, identity-update-request.
 */

import { Router, json as jsonParser } from 'express';
import crypto from 'crypto';
import { createRequire } from 'module';
import path from 'path';
import { DaemonSigner } from './signer-daemon.js';
import { LiteSigner } from './signer-lite.js';
import { createChallenge, verifyResponse } from './auth.js';
import type { VerusConnectConfig, Signer, VerifiedLogin } from './types.js';

// Smart module resolution for peer dependencies (verusid-ts-client)
function createSmartRequire() {
  const strategies: ReturnType<typeof createRequire>[] = [];
  try {
    strategies.push(createRequire(path.join(process.cwd(), 'noop.js')));
  } catch { /* ignore */ }
  const entryScript = require.main?.filename ?? process.argv[1];
  if (entryScript) {
    try {
      const baseDir = path.dirname(entryScript);
      if (baseDir !== process.cwd()) {
        strategies.push(createRequire(path.join(baseDir, 'noop.js')));
      }
    } catch { /* ignore */ }
  }
  return (id: string) => {
    let lastErr: Error | undefined;
    for (const req of strategies) {
      try { return req(id); } catch (err: any) { lastErr = err; }
    }
    throw lastErr ?? new Error(`Cannot find module '${id}'`);
  };
}

const smartRequire = createSmartRequire();

// Lazy-loaded Verus libraries (for pay-deeplink, generic-request, etc.)
let primitives: any = null;
let bs58check: any = null;
let BN: any = null;
let primitivesLoaded = false;

function loadPrimitives(): boolean {
  if (primitivesLoaded) return !!primitives;
  try {
    // Try loading directly from verus-typescript-primitives (preferred, no heavy client dependency)
    primitives = smartRequire('verus-typescript-primitives');
    primitivesLoaded = true;

    // bs58check and BN — try to find them in available packages
    try { bs58check = smartRequire('bs58check'); } catch {
      try { bs58check = smartRequire('verus-typescript-primitives/node_modules/bs58check'); } catch {
        try { bs58check = smartRequire('verusid-ts-client/node_modules/bs58check'); } catch {
          console.warn('[verus-connect] bs58check not found — pay-deeplink address resolution limited');
        }
      }
    }
    try { BN = smartRequire('bn.js'); } catch {
      try { BN = smartRequire('verus-typescript-primitives/node_modules/bn.js'); } catch {
        try { BN = smartRequire('verusid-ts-client/node_modules/bn.js'); } catch {
          console.warn('[verus-connect] bn.js not found — pay-deeplink may not work');
        }
      }
    }

    return true;
  } catch {
    // Fallback: try loading through verusid-ts-client
    try {
      const client = smartRequire('verusid-ts-client');
      primitives = client.primitives;
      bs58check = smartRequire('verusid-ts-client/node_modules/bs58check');
      BN = smartRequire('verusid-ts-client/node_modules/bn.js');
      primitivesLoaded = true;
      return true;
    } catch (err: any) {
      console.warn('[verus-connect] Neither verus-typescript-primitives nor verusid-ts-client found');
      console.warn('[verus-connect] pay-deeplink, generic-request, identity-update-request will be unavailable');
      primitivesLoaded = true;
      return false;
    }
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
  const apiUrl = config.apiUrl || config.rpcUrl || 'https://api.verus.services';

  // Try to load primitives (non-fatal if missing — auth still works)
  const hasPrimitives = loadPrimitives();
  if (hasPrimitives) {
    console.log('[verus-connect] Primitives loaded — all routes available');
  }

  // Challenge + result storage (in-memory, auto-expire after 5 min)
  const challenges = new Map<string, { created: number; deepLink: string }>();
  const results = new Map<string, { iAddress: string; friendlyName: string; extra?: Record<string, unknown> }>();

  // Cleanup expired challenges and results every 60s
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, data] of challenges) {
      if (data.created < cutoff) {
        challenges.delete(id);
        results.delete(id);
      }
    }
  }, 60_000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  // Rate limiting: max 10 challenges per IP per minute
  const rateLimits = new Map<string, { count: number; reset: number }>();

  const router = Router();

  // ── POST /login — create a new login challenge ──

  router.post('/login', async (_req: any, res) => {
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

  router.post('/verusidlogin', jsonParser({ limit: '1mb' }), async (req, res) => {
    try {
      const body = req.body;
      const challengeId = body?.decision?.request?.challenge?.challenge_id
        || body?.decision?.decision_id;

      if (!challengeId || !challenges.has(challengeId)) {
        return res.status(404).json({ error: 'Challenge not found or expired' });
      }

      const { identityAddress, friendlyName } = await verifyResponse(signer, body, challengeId);

      const loginResult: VerifiedLogin = {
        iAddress: identityAddress,
        friendlyName,
        challengeId,
      };

      let extra: Record<string, unknown> | undefined;
      if (config.onLogin) {
        try {
          const hookResult = await config.onLogin(loginResult);
          if (hookResult && typeof hookResult === 'object') extra = hookResult;
        } catch (hookErr: any) {
          console.error('[verus-connect] onLogin hook error:', hookErr.message);
        }
      }

      results.set(challengeId, { iAddress: identityAddress, friendlyName, extra });
      res.json({ status: 'ok' });
    } catch (err: any) {
      console.error('[verus-connect] Webhook error:', err.message);
      res.status(500).json({ error: 'Verification error' });
    }
  });

  // ── GET /result/:challengeId — poll for login result ──

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
      data: result.extra,
    });
  });

  // ── POST /pay-deeplink — generate VerusPay invoice deep link ──
  // Body: { address: string, amount: number, currency_id?: string }

  router.post('/pay-deeplink', jsonParser({ limit: '100kb' }), async (req: any, res) => {
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
    if (typeof address !== 'string' || address.length < 1 || address.length > 100) {
      return res.status(400).json({ error: 'invalid address format' });
    }
    if (!primitives || !bs58check) {
      return res.status(503).json({ error: 'Verus libraries not loaded. Install verusid-ts-client.' });
    }

    try {
      if (!BN) return res.status(503).json({ error: 'BN library not loaded' });
      const chainId = currency_id || chainIAddress;
      const VERSION_3 = new BN(3);

      let destType: any;
      let destBytes: Buffer;
      let resolvedAddress = address;

      if (address.includes('@')) {
        // Resolve VerusID name to i-address
        try {
          let rpcTarget = apiUrl;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          try {
            const parsed = new URL(rpcTarget);
            if (parsed.username) {
              headers['Authorization'] = 'Basic ' + Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64');
              rpcTarget = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
            }
          } catch {}

          const rpcRes = await fetch(rpcTarget, {
            method: 'POST',
            headers,
            body: JSON.stringify({ jsonrpc: '1.0', id: 'pay', method: 'getidentity', params: [address] }),
          });
          const rpcData = await rpcRes.json() as any;
          const iAddress = rpcData?.result?.identity?.identityaddress;
          if (!iAddress) throw new Error('Identity not found');
          resolvedAddress = iAddress;
        } catch (e: any) {
          return res.status(404).json({ error: `Could not resolve identity: ${e.message}` });
        }
        const decoded = bs58check.decode(resolvedAddress);
        destType = primitives.DEST_ID;
        destBytes = decoded.slice(1);
      } else if (address.startsWith('i')) {
        const decoded = bs58check.decode(address);
        destType = primitives.DEST_ID;
        destBytes = decoded.slice(1);
      } else {
        const decoded = bs58check.decode(address);
        destType = primitives.DEST_PKH;
        destBytes = decoded.slice(1);
      }

      const details = new primitives.VerusPayInvoiceDetails({
        amount: new BN(Math.round(amount * 1e8)),
        destination: new primitives.TransferDestination({
          type: destType,
          destinationBytes: destBytes,
        }),
        requestedcurrencyid: chainId,
      }, VERSION_3);

      const invoice = new primitives.VerusPayInvoice({ details, version: VERSION_3 });
      const deepLink = invoice.toWalletDeeplinkUri();

      return res.json({
        deep_link: deepLink,
        destination_type: destType.eq(primitives.DEST_ID) ? 'identity' : 'address',
        resolved_address: resolvedAddress,
      });
    } catch (err: any) {
      console.error('[verus-connect] pay-deeplink error:', err.message);
      return res.status(500).json({ error: 'Failed to generate payment deep link' });
    }
  });

  // ── POST /generic-request — create a GenericRequest deep link ──
  // Body: { details: Array<{vdxfkey, data}> }

  router.post('/generic-request', jsonParser({ limit: '1mb' }), async (req: any, res) => {
    const { details } = req.body;
    if (!details || !Array.isArray(details) || details.length === 0) {
      return res.status(400).json({ error: 'details array is required' });
    }
    if (!primitives) {
      return res.status(503).json({ error: 'Verus libraries not loaded. Install verusid-ts-client.' });
    }

    try {
      const responseURIs: any[] = [];
      if (config.callbackUrl) {
        const ResponseURI = primitives.ResponseURI;
        const genericCallbackUrl = config.callbackUrl.replace(/\/verusidlogin$/, '/generic-response');
        responseURIs.push(ResponseURI.fromUriString(genericCallbackUrl, ResponseURI.TYPE_POST));
      }

      const requestConfig: any = {
        details: details.map((d: any) => d),
        flags: primitives.GenericRequest.BASE_FLAGS,
      };

      if (responseURIs.length > 0) {
        requestConfig.responseURIs = responseURIs;
      }

      const request = new primitives.GenericRequest(requestConfig);
      const deepLink = request.toWalletDeeplinkUri();
      const qrString = request.toQrString();

      return res.json({
        deep_link: deepLink,
        qr_string: qrString,
        has_callback: !!config.callbackUrl,
      });
    } catch (err: any) {
      console.error('[verus-connect] generic-request error:', err.message);
      return res.status(500).json({ error: 'Failed to create generic request' });
    }
  });

  // ── POST /identity-update-request — create an identity update deep link ──
  // Body: { identity: string, updates: { contentmultimap?, primaryaddresses?, flags?, minimumsignatures? } }

  router.post('/identity-update-request', jsonParser({ limit: '1mb' }), async (req: any, res) => {
    const { identity, updates } = req.body;
    if (!identity || !updates) {
      return res.status(400).json({ error: 'identity and updates are required' });
    }
    if (!primitives) {
      return res.status(503).json({ error: 'Verus libraries not loaded. Install verusid-ts-client.' });
    }

    try {
      const responseURIs: any[] = [];
      if (config.callbackUrl) {
        const ResponseURI = primitives.ResponseURI;
        const idUpdateCallbackUrl = config.callbackUrl.replace(/\/verusidlogin$/, '/identity-update-response');
        responseURIs.push(ResponseURI.fromUriString(idUpdateCallbackUrl, ResponseURI.TYPE_POST));
      }

      const identityJson: any = {};
      if (typeof identity === 'string') {
        if (identity.includes('@')) {
          identityJson.name = identity.replace(/@$/, '').split('.')[0];
        } else {
          identityJson.name = identity;
        }
      }

      // Process contentmultimap — convert strings to hex
      if (updates.contentMultiMap || updates.contentmultimap) {
        const rawMap = updates.contentMultiMap || updates.contentmultimap;
        const processedMap: any = {};
        for (const key in rawMap) {
          const val = rawMap[key];
          if (typeof val === 'string' && /^[0-9a-fA-F]+$/.test(val)) {
            processedMap[key] = val;
          } else if (typeof val === 'string') {
            processedMap[key] = Buffer.from(val, 'utf-8').toString('hex');
          } else if (Array.isArray(val)) {
            processedMap[key] = val.map((item: any) => {
              if (typeof item === 'string' && /^[0-9a-fA-F]+$/.test(item)) return item;
              if (typeof item === 'string') return Buffer.from(item, 'utf-8').toString('hex');
              return Buffer.from(JSON.stringify(item), 'utf-8').toString('hex');
            });
          } else if (typeof val === 'object') {
            processedMap[key] = Buffer.from(JSON.stringify(val), 'utf-8').toString('hex');
          } else {
            processedMap[key] = String(val);
          }
        }
        identityJson.contentmultimap = processedMap;
      }

      if (updates.primaryaddresses || updates.primaryAddresses) {
        identityJson.primaryaddresses = updates.primaryaddresses || updates.primaryAddresses;
      }
      if (updates.flags !== undefined) {
        identityJson.flags = updates.flags;
      }
      if (updates.minimumsignatures !== undefined) {
        identityJson.minimumsignatures = updates.minimumsignatures;
      }

      const updateDetails = primitives.IdentityUpdateRequestDetails.fromCLIJson(identityJson);
      const updateDetail = new primitives.IdentityUpdateRequestOrdinalVDXFObject({
        data: updateDetails,
      });

      const requestConfig: any = {
        details: [updateDetail],
        flags: primitives.GenericRequest.BASE_FLAGS,
      };

      if (responseURIs.length > 0) {
        requestConfig.responseURIs = responseURIs;
      }

      const request = new primitives.GenericRequest(requestConfig);
      const deepLink = request.toWalletDeeplinkUri();

      return res.json({
        deep_link: deepLink,
        qr_string: request.toQrString(),
        identity,
        has_callback: !!config.callbackUrl,
      });
    } catch (err: any) {
      console.error('[verus-connect] identity-update-request error:', err.message, err.stack);
      return res.status(500).json({ error: 'Failed to create identity update request' });
    }
  });

  // ── GET /health — health check ──

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode,
      activeChallenges: challenges.size,
      primitivesLoaded: !!primitives,
      routes: {
        login: true,
        payDeeplink: !!primitives,
        genericRequest: !!primitives,
        identityUpdateRequest: !!primitives,
      },
    });
  });

  return router;
}
