import type { LoginResult, SendOptions, SendResult, VerusProvider } from './types';

function getProvider(): VerusProvider {
  if (!window.verus?.isVerusWallet) {
    throw new Error('Verus Web Wallet extension not available');
  }
  return window.verus;
}

/**
 * Request login via the browser extension.
 * The extension opens its approval popup; the promise resolves when the user
 * approves (or rejects) in the popup. However, the actual result still comes
 * back via the server webhook + polling, so this is fire-and-forget.
 */
export async function extensionLogin(uri: string): Promise<void> {
  const provider = getProvider();
  try {
    await provider.requestLogin(uri);
  } catch {
    // Extension handles via popup — ignore rejection here.
    // The actual login result comes from server-side polling.
  }
}

/**
 * Request a send transaction via the browser extension.
 * Returns the txid on success.
 */
export async function extensionSend(params: SendOptions): Promise<SendResult> {
  const provider = getProvider();
  const result = await provider.sendTransaction({
    to: params.to,
    amount: params.amount,
    currency: params.currency ?? 'VRSC',
  });
  return {
    txid: result.txid,
    method: 'extension',
  };
}
