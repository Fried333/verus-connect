import type { VerusProvider, WalletEnvironment } from './types';

declare global {
  interface Window {
    verus?: VerusProvider;
  }
}

/** Check if the Verus Web Wallet extension is available right now */
export function isExtensionAvailable(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    window.verus?.isVerusWallet
  );
}

/**
 * Wait for the extension provider to be injected.
 * Content scripts inject `window.verus` and dispatch `verus#initialized`.
 * Returns the provider or null if timeout expires.
 */
export function waitForProvider(timeoutMs = 2000): Promise<VerusProvider | null> {
  if (isExtensionAvailable()) {
    return Promise.resolve(window.verus!);
  }

  return new Promise((resolve) => {
    const handler = () => {
      clearTimeout(timer);
      window.removeEventListener('verus#initialized', handler);
      resolve(window.verus ?? null);
    };

    const timer = setTimeout(() => {
      window.removeEventListener('verus#initialized', handler);
      resolve(null);
    }, timeoutMs);

    window.addEventListener('verus#initialized', handler);
  });
}

/** Simple mobile browser detection via user agent */
export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini|IEMobile/i.test(
    navigator.userAgent,
  );
}

/** Detect the current wallet environment */
export function detectEnvironment(): WalletEnvironment {
  if (isExtensionAvailable()) return 'extension';
  if (isMobileBrowser()) return 'mobile';
  return 'desktop';
}
