/**
 * Core types for verus-connect v4.
 */

export interface VerusConnectConfig {
  /** Mode: 'daemon' uses local RPC, 'lite' uses WIF key + public node */
  mode?: 'daemon' | 'lite';

  /** The VerusID i-address or friendly name used to sign challenges */
  iAddress: string;

  /** Callback URL where the wallet POSTs the signed response */
  callbackUrl: string;

  /** Chain i-address (default: VRSC) */
  chainIAddress?: string;

  /** Chain name (default: VRSC) */
  chain?: string;

  /** Public API URL for RPC calls (default: https://api.verus.services) */
  apiUrl?: string;

  // --- Daemon mode ---
  /** RPC URL for local daemon (e.g. http://user:pass@127.0.0.1:27486) */
  rpcUrl?: string;

  // --- Lite mode ---
  /** WIF private key for signing (lite mode only) */
  privateKey?: string;

  /** Public Verus node URL for verification (lite mode, required) */
  verifyNodeUrl?: string;

  /** Enable debug logging and response saving to /tmp */
  debug?: boolean;

  /** Hook called after successful login */
  onLogin?: (login: VerifiedLogin) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
}

export interface VerifiedLogin {
  iAddress: string;
  friendlyName: string;
  challengeId: string;
}

export interface Signer {
  /** Sign a data hash and return the signature */
  sign(address: string, dataHash: string): Promise<string>;

  /** Sign a full LoginConsentRequest (lite mode handles internally) */
  signRequest?(address: string, request: any, challenge: any, chainIAddress: string): Promise<any>;

  /** Verify a signature against a data hash (hex) */
  verify(address: string, signature: string, dataHash: string): Promise<boolean>;

  /** Verify a signature against raw message data (hex) */
  verifyMessage?(address: string, signature: string, messageHex: string): Promise<boolean>;

  /** Get current block height */
  getBlockHeight(): Promise<number>;

  /** Get identity info */
  getIdentity(nameOrId: string): Promise<any>;

  /** Check if daemon is synced to chain tip */
  checkSynced?(): Promise<{ synced: boolean; blocks: number; longestchain: number }>;
}

export interface Challenge {
  id: string;
  deepLink: string;
  createdAt: number;
}
