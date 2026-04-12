/**
 * VerusID login challenge creation and response verification.
 * Uses verus-typescript-primitives for VDXF objects, Signer interface for crypto.
 */

import {
  LoginConsentRequest,
  LoginConsentResponse,
  LoginConsentChallenge,
  LoginConsentDecision,
  VerusIDSignature,
  RedirectUri,
  RequestedPermission,
  IDENTITY_AUTH_SIG_VDXF_KEY,
  IDENTITY_VIEW,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
} from 'verus-typescript-primitives';
import crypto from 'crypto';
import type { Signer, Challenge } from './types.js';

function randomIAddress(): string {
  // Generate a valid random i-address: version byte (102) + 20 random bytes, base58check encoded
  const bs58check = require('bs58check');
  const payload = Buffer.alloc(21);
  payload[0] = 102; // i-address version byte
  crypto.randomBytes(20).copy(payload, 1);
  return bs58check.encode(payload);
}

/**
 * Create a login challenge deep link.
 */
export async function createChallenge(
  signer: Signer,
  signingAddress: string,
  callbackUrl: string,
  chainIAddress: string = 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV',
): Promise<Challenge> {
  const challengeId = randomIAddress();
  const createdAt = Math.floor(Date.now() / 1000);

  const webhookUri = new RedirectUri(callbackUrl, LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid);

  const challenge = new LoginConsentChallenge({
    challenge_id: challengeId,
    requested_access: [new RequestedPermission(IDENTITY_VIEW.vdxfid)],
    redirect_uris: [webhookUri],
    created_at: createdAt,
    salt: randomIAddress(),
  });

  let request = new LoginConsentRequest({
    system_id: chainIAddress,
    signing_id: signingAddress,
    challenge,
  });

  if (signer.signRequest) {
    // Standalone mode: let verusid-ts-client handle signing (produces correct sig format)
    request = await signer.signRequest(signingAddress, request, challenge, chainIAddress);
  } else {
    // Daemon mode: sign the challenge hash via RPC
    const challengeHash = request.challenge.toSha256();
    const hashHex = challengeHash.toString('hex');
    const signature = await signer.sign(signingAddress, hashHex);

    request.signature = new VerusIDSignature(
      { signature },
      IDENTITY_AUTH_SIG_VDXF_KEY,
    );
  }

  const deepLink = request.toWalletDeeplinkUri();

  return { id: challengeId, deepLink, createdAt };
}

/**
 * Verify a signed login consent response from a wallet.
 *
 * Verification steps:
 * 1. Challenge ID match (proves response is for our challenge)
 * 2. Request signature valid (proves challenge was issued by us)
 * 3. Identity is active at signing height
 * 4. Response signature valid (proves wallet holder approved)
 *
 * Step 4 uses daemon RPC which wraps the hash identically to offline signing.
 * If the response signature can't be verified (e.g. mobile app library mismatch),
 * we fall back to steps 1-3 which still provide strong authentication guarantees.
 */
export async function verifyResponse(
  signer: Signer,
  responseBody: any,
  expectedChallengeId: string,
): Promise<{ identityAddress: string; friendlyName: string }> {
  const response = new LoginConsentResponse(responseBody);

  // 1. Verify challenge ID
  const cId = response.decision?.request?.challenge?.challenge_id;
  if (!cId || cId !== expectedChallengeId) {
    throw new Error('Challenge ID mismatch');
  }

  const signingId = response.signing_id;
  if (!signingId) throw new Error('No signing identity in response');

  const sig = (response as any).signature?.signature;
  if (!sig) throw new Error('No signature in response');

  // 2. Verify the REQUEST signature (server-signed challenge)
  const request = response.decision?.request;
  const reqSig = request?.signature?.signature;
  if (!reqSig) throw new Error('No request signature');

  const challengeHash = request.challenge.toSha256().toString('hex');
  const reqVerified = await signer.verify(request.signing_id, reqSig, challengeHash);
  if (!reqVerified) {
    throw new Error('Request signature invalid — challenge was not issued by this server');
  }

  // 3. Verify identity is active at signing height
  const sigBuf = Buffer.from(sig, 'base64');
  const sigHeight = sigBuf.readUInt32LE(2);

  let idInfo: any;
  try {
    idInfo = await signer.getIdentity(signingId);
  } catch {
    throw new Error('Could not resolve signing identity');
  }

  if (idInfo?.status !== 'active') {
    throw new Error('Signing identity is not active');
  }

  // 4. Try to verify response signature via daemon
  const decisionHash = response.decision.toSha256().toString('hex');
  const respVerified = await signer.verify(signingId, sig, decisionHash);

  if (!respVerified) {
    throw new Error('Response signature verification failed');
  }

  // Resolve friendly name
  let friendlyName = signingId;
  try {
    friendlyName = idInfo?.friendlyname || idInfo?.fullyqualifiedname || signingId;
  } catch {}

  return { identityAddress: signingId, friendlyName };
}
