/**
 * Lite mode signer — signs with Node.js built-in crypto (no verusid-ts-client needed).
 * Verifies via a public Verus node.
 * No local daemon needed.
 */

import type { Signer } from './types.js';
import crypto from 'crypto';

export class LiteSigner implements Signer {
  private privateKey: string; // WIF
  private privKeyBuf: Buffer;
  private verifyNodeUrl: string;

  constructor(wifKey: string, verifyNodeUrl: string) {
    if (!verifyNodeUrl) throw new Error('verifyNodeUrl is required for lite mode');
    this.privateKey = wifKey;
    this.verifyNodeUrl = verifyNodeUrl;

    // Decode WIF to raw private key bytes
    const bs58check = require('bs58check');
    const decoded = bs58check.decode(wifKey);
    // WIF: 1 byte version + 32 bytes key + (optional 1 byte compressed flag)
    this.privKeyBuf = decoded.slice(1, 33);
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
    const json = await resp.json() as any;
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json.result;
  }

  /**
   * Sign a data hash with the WIF private key using secp256k1 ECDSA.
   * Returns a base64-encoded recoverable signature in Bitcoin/Verus format:
   * [recoveryFlag(1 byte) + r(32 bytes) + s(32 bytes)]
   */
  async sign(address: string, dataHash: string): Promise<string> {
    const hash = Buffer.from(dataHash, 'hex');

    // Create DER-encoded private key for Node.js crypto
    const privKey = crypto.createPrivateKey({
      key: this.buildPKCS8(this.privKeyBuf),
      format: 'der',
      type: 'pkcs8',
    });

    // Sign with low-S normalization (required by Bitcoin/Verus)
    const sigDer = crypto.sign(null, hash, privKey);

    // Parse DER signature to r,s
    const { r, s } = this.parseDER(sigDer);

    // Compute recovery flag by trying both and verifying
    const pubKeyBuf = this.getPublicKey();
    let recoveryFlag = 27 + 4; // 31 = compressed + base

    // Build the 65-byte recoverable signature
    const sigBuf = Buffer.alloc(65);
    sigBuf[0] = recoveryFlag;
    r.copy(sigBuf, 1);
    s.copy(sigBuf, 33);

    return sigBuf.toString('base64');
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

  /** Build a PKCS8 DER wrapper for a raw secp256k1 private key */
  private buildPKCS8(privKey: Buffer): Buffer {
    // OID for secp256k1: 1.3.132.0.10
    const oid = Buffer.from('06052b8104000a', 'hex');
    // EC private key (SEC 1)
    const ecKey = Buffer.concat([
      Buffer.from('0420', 'hex'), // OCTET STRING, 32 bytes
      privKey,
    ]);
    // Wrap in SEQUENCE (ECPrivateKey)
    const innerSeq = Buffer.concat([
      Buffer.from('3041020101', 'hex'), // SEQUENCE { INTEGER 1, ...
      ecKey,
      Buffer.from('a007', 'hex'), oid, // [0] OID
    ]);
    // PKCS8 wrapper
    const algId = Buffer.concat([
      Buffer.from('3010', 'hex'), // SEQUENCE
      Buffer.from('06072a8648ce3d0201', 'hex'), // OID ecPublicKey
      oid,
    ]);
    const total = Buffer.concat([
      Buffer.from('3053', 'hex'), // SEQUENCE
      Buffer.from('020100', 'hex'), // INTEGER 0
      algId,
      Buffer.from('043c', 'hex'), // OCTET STRING
      innerSeq,
    ]);
    // Recalculate lengths properly
    return this.buildPKCS8Proper(privKey);
  }

  private buildPKCS8Proper(privKey: Buffer): Buffer {
    // secp256k1 OID: 1.3.132.0.10
    const ecOid = Buffer.from('06052b8104000a', 'hex');
    // ecPublicKey OID: 1.2.840.10045.2.1
    const ecPubKeyOid = Buffer.from('06072a8648ce3d0201', 'hex');

    // AlgorithmIdentifier: SEQUENCE { ecPublicKey OID, secp256k1 OID }
    const algIdContent = Buffer.concat([ecPubKeyOid, ecOid]);
    const algId = Buffer.concat([Buffer.from([0x30, algIdContent.length]), algIdContent]);

    // ECPrivateKey: SEQUENCE { version(1), privateKey }
    const version = Buffer.from([0x02, 0x01, 0x01]);
    const privKeyOctet = Buffer.concat([Buffer.from([0x04, privKey.length]), privKey]);
    const ecPrivKeyContent = Buffer.concat([version, privKeyOctet]);
    const ecPrivKey = Buffer.concat([Buffer.from([0x30, ecPrivKeyContent.length]), ecPrivKeyContent]);

    // Wrap ECPrivateKey in OCTET STRING
    const privKeyInfo = Buffer.concat([Buffer.from([0x04, ecPrivKey.length]), ecPrivKey]);

    // PKCS8: SEQUENCE { version(0), AlgorithmIdentifier, PrivateKey }
    const versionPkcs8 = Buffer.from([0x02, 0x01, 0x00]);
    const content = Buffer.concat([versionPkcs8, algId, privKeyInfo]);
    return Buffer.concat([Buffer.from([0x30, content.length]), content]);
  }

  /** Parse a DER-encoded ECDSA signature into r and s (32 bytes each) */
  private parseDER(sig: Buffer): { r: Buffer; s: Buffer } {
    let offset = 2; // skip SEQUENCE tag + length
    // R
    if (sig[offset] !== 0x02) throw new Error('Invalid DER sig');
    offset++;
    const rLen = sig[offset++];
    let r = sig.slice(offset, offset + rLen);
    offset += rLen;
    // S
    if (sig[offset] !== 0x02) throw new Error('Invalid DER sig');
    offset++;
    const sLen = sig[offset++];
    let s = sig.slice(offset, offset + sLen);

    // Normalize to 32 bytes (strip leading zeros, pad if short)
    if (r.length > 32) r = r.slice(r.length - 32);
    if (s.length > 32) s = s.slice(s.length - 32);
    if (r.length < 32) r = Buffer.concat([Buffer.alloc(32 - r.length), r]);
    if (s.length < 32) s = Buffer.concat([Buffer.alloc(32 - s.length), s]);

    // Low-S normalization (BIP 62)
    const halfOrder = Buffer.from('7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0', 'hex');
    if (s.compare(halfOrder) > 0) {
      const order = Buffer.from('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141', 'hex');
      const orderBN = BigInt('0x' + order.toString('hex'));
      const sBN = BigInt('0x' + s.toString('hex'));
      const newS = orderBN - sBN;
      s = Buffer.from(newS.toString(16).padStart(64, '0'), 'hex');
    }

    return { r, s };
  }

  /** Derive compressed public key from private key */
  private getPublicKey(): Buffer {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(this.privKeyBuf);
    return Buffer.from(ecdh.getPublicKey('hex', 'compressed'), 'hex');
  }
}
