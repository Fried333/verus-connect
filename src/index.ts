// ── Main class ───────────────────────────────────────────────────────
export { VerusConnect } from './connect';

// ── Types ────────────────────────────────────────────────────────────
export type {
  VerusConnectConfig,
  ChallengeResponse,
  PollResponse,
  LoginOptions,
  LoginResult,
  SendOptions,
  SendResult,
  WalletEnvironment,
  VerusProvider,
  VerusConnectEvent,
  EventListener,
  ThemeConfig,
} from './types';

// ── Utilities (for advanced use) ─────────────────────────────────────
export {
  isExtensionAvailable,
  waitForProvider,
  isMobileBrowser,
  detectEnvironment,
} from './detect';

export {
  extensionLogin,
  extensionSend,
} from './extension';

export {
  openDeepLink,
  buildAndroidIntentUrl,
} from './deeplink';

export {
  generateQrSvg,
  generateQrDataUrl,
} from './qr';

export { poll } from './poller';
export { showModal } from './ui';
