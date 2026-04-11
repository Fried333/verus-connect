/**
 * Lite mode signer — signs with verusid-ts-client (offline).
 * Verifies via a public Verus node.
 * No local daemon needed.
 *
 * TODO: Replace verusid-ts-client with direct @noble/secp256k1 signing.
 */

import type { Signer } from './types.js';

export class LiteSigner implements Signer {
  private privateKey: string; // WIF
  private verifyNodeUrl: string;
  private verusId: any;

  constructor(wifKey: string, verifyNodeUrl: string) {
    if (!verifyNodeUrl) throw new Error('verifyNodeUrl is required for lite mode');
    this.privateKey = wifKey;
    this.verifyNodeUrl = verifyNodeUrl;

    // Load verusid-ts-client if available
    try {
      const { VerusIdInterface } = require('verusid-ts-client');
      this.verusId = new VerusIdInterface('VRSC', verifyNodeUrl);
    } catch {
      throw new Error('Lite mode requires verusid-ts-client. Install it: npm install verusid-ts-client');
    }
  }

  private async nodeRpc(method: string, params: any[] = []): Promise<any> {
    const body = JSON.stringify({ jsonrpc: '1.0', id: Date.now(), method, params });
    const url = new URL(this.verifyNodeUrl);
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
    if (url.username) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${url.username}:${url.password}`).toString('base64');
      url.username = '';
      url.password = '';
    }
    const resp = await fetch(url.toString(), { method: 'POST', headers, body });
    const json = await resp.json();
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json.result;
  }

  async sign(address: string, dataHash: string): Promise<string> {
    const height = await this.getBlockHeight();
    const hash = Buffer.from(dataHash, 'hex');
    return this.verusId.signHash(address, hash, this.privateKey, null, height);
  }

  async signRequest(address: string, request: any, challenge: any, chainIAddress: string): Promise<any> {
    // Let verusid-ts-client handle the full challenge creation + signing
    return this.verusId.createLoginConsentRequest(
      address,
      challenge,
      this.privateKey,
      null,
      null,
      chainIAddress,
    );
  }

  async verify(address: string, signature: string, dataHash: string): Promise<boolean> {
    try {
      const result = await this.nodeRpc('verifysignature', [{ address, signature, datahash: dataHash }]);
      return result?.signaturestatus === 'verified';
    } catch {
      return false;
    }
  }

  async verifyMessage?(address: string, signature: string, messageHex: string): Promise<boolean> {
    try {
      const result = await this.nodeRpc('verifysignature', [{ address, signature, messagehex: messageHex }]);
      return result?.signaturestatus === 'verified';
    } catch {
      return false;
    }
  }

  async getBlockHeight(): Promise<number> {
    return this.nodeRpc('getblockcount');
  }

  async getIdentity(nameOrId: string): Promise<any> {
    return this.nodeRpc('getidentity', [nameOrId]);
  }
}
