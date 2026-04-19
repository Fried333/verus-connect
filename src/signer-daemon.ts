/**
 * Daemon mode signer — all crypto delegated to local verusd via RPC.
 */

import type { Signer } from './types.js';

export class DaemonSigner implements Signer {
  public rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  private async rpc(method: string, params: any[] = []): Promise<any> {
    const body = JSON.stringify({ jsonrpc: '1.0', id: Date.now(), method, params });

    // Extract auth from URL if present (http://user:pass@host:port)
    const url = new URL(this.rpcUrl);
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

  async sign(address: string, dataHex: string): Promise<string> {
    const result = await this.rpc('signdata', [{ address, datahash: dataHex }]);
    if (!result?.signature) throw new Error('Daemon signing failed');
    return result.signature;
  }

  async verify(address: string, signature: string, dataHash: string): Promise<boolean> {
    try {
      const result = await this.rpc('verifysignature', [{ address, signature, datahash: dataHash }]);
      return result?.signaturestatus === 'verified';
    } catch {
      return false;
    }
  }

  async verifyMessage(address: string, signature: string, messageHex: string): Promise<boolean> {
    try {
      const result = await this.rpc('verifysignature', [{ address, signature, messagehex: messageHex }]);
      return result?.signaturestatus === 'verified';
    } catch {
      return false;
    }
  }

  async getBlockHeight(): Promise<number> {
    return this.rpc('getblockcount');
  }

  async getIdentity(nameOrId: string): Promise<any> {
    return this.rpc('getidentity', [nameOrId]);
  }

  async checkSynced(): Promise<{ synced: boolean; blocks: number; longestchain: number }> {
    const info = await this.rpc('getinfo');
    const blocks = info.blocks || 0;
    const longestchain = info.longestchain || 0;
    // Allow up to 5 blocks behind — new blocks arrive every ~60s,
    // a small gap is normal and doesn't affect challenge validity
    const MAX_BEHIND = 5;
    return { synced: (longestchain - blocks) <= MAX_BEHIND && longestchain > 0, blocks, longestchain };
  }
}
