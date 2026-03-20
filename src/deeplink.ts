/** Allowed deep link URI schemes. */
const ALLOWED_SCHEMES = ['verus:', 'vrsc:', 'i5jtwbp6zymeay9llnraglgjqgdrffsau4:'];

/**
 * Validate that a URI uses a safe Verus deep link scheme.
 * Blocks javascript:, data:, http:, https:, and any other non-Verus scheme.
 * Returns true if the URI is safe to use in QR codes and deep links.
 */
export function isValidDeepLink(uri: string): boolean {
  if (!uri || typeof uri !== 'string') return false;
  const scheme = uri.split('//')[0].toLowerCase();
  return ALLOWED_SCHEMES.some(s => scheme === s);
}

/**
 * Open a verus:// deep link, triggering the OS app handler (Verus Mobile).
 * On mobile browsers this launches the app directly.
 * Only allows verus/vrsc schemes — rejects javascript:, data:, etc.
 */
export function openDeepLink(uri: string): void {
  if (!isValidDeepLink(uri)) {
    const scheme = uri?.split('//')[0] ?? 'unknown';
    throw new Error(`verus-connect: blocked unsafe URI scheme "${scheme}"`);
  }
  window.location.href = uri;
}

/**
 * Build an Android intent:// fallback URL.
 * Used when the standard deep link doesn't trigger the app on Android.
 */
export function buildAndroidIntentUrl(uri: string): string {
  // Strip the scheme to get the path
  const path = uri.replace(/^[a-zA-Z0-9]+:\/\//, '');
  const scheme = uri.split('://')[0];
  return `intent://${path}#Intent;scheme=${scheme};end`;
}
