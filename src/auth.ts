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
 */
export async function verifyResponse(
  signer: Signer,
  responseBody: any,
  expectedChallengeId: string,
): Promise<{ identityAddress: string; friendlyName: string }> {
  const response = new LoginConsentResponse(responseBody);

  // Verify challenge ID
  const cId = response.decision?.request?.challenge?.challenge_id;
  if (!cId || cId !== expectedChallengeId) {
    throw new Error('Challenge ID mismatch');
  }

  const signingId = response.signing_id;
  if (!signingId) throw new Error('No signing identity in response');

  // Verify the response signature
  const sig = (response as any).signature?.signature;
  if (!sig) throw new Error('No signature in response');

  // Use verifysignature with the decision hash (same as Desktop wallet method)
  const decisionHash = response.decision.toSha256().toString('hex');
  const valid = await signer.verify(signingId, sig, decisionHash);
  if (!valid) throw new Error('Signature verification failed');

  // Resolve friendly name
  let friendlyName = signingId;
  try {
    const idInfo = await signer.getIdentity(signingId);
    friendlyName = idInfo?.friendlyname || idInfo?.fullyqualifiedname || signingId;
  } catch {}

  return { identityAddress: signingId, friendlyName };
}
