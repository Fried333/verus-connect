// ── Configuration ────────────────────────────────────────────────────

export interface VerusConnectConfig {
  /** Display name shown in modals (e.g. "My App") */
  appName?: string;

  /**
   * Base URL of your verus-connect server middleware.
   * When set, getChallenge and getResult are auto-configured to call:
   *   POST {serverUrl}/login
   *   GET  {serverUrl}/result/{challengeId}
   *
   * This is the simplest setup — just point to your server.
   */
  serverUrl?: string;

  /**
   * Custom function that fetches a login challenge from your backend.
   * Must return { uri, challengeId }.
   * Overrides serverUrl for challenge fetching.
   */
  getChallenge?: () => Promise<ChallengeResponse>;

  /**
   * Custom function that polls your backend for the challenge result.
   * Must return { status: 'pending' } or { status: 'verified', ... }.
   * Overrides serverUrl for result polling.
   */
  getResult?: (challengeId: string) => Promise<PollResponse>;

  /** Polling interval in ms (default: 3000) */
  pollInterval?: number;

  /** Polling timeout in ms — gives up after this (default: 300000 = 5 min) */
  pollTimeout?: number;

  /** Theme overrides */
  theme?: Partial<ThemeConfig>;
}

// ── Challenge / Polling ──────────────────────────────────────────────

export interface ChallengeResponse {
  /** The verus:// deep link URI (server-signed) */
  uri: string;
  /** Unique challenge ID for polling */
  challengeId: string;
}

export interface PollResponse {
  status: 'pending' | 'verified' | 'error';
  /** Present when status === 'verified' — the signer's i-address */
  iAddress?: string;
  /** Present when status === 'verified' — VerusID friendly name */
  friendlyName?: string;
  /** Arbitrary extra data your backend wants to pass through (JWT, account info, etc.) */
  data?: Record<string, unknown>;
  /** Present when status === 'error' */
  error?: string;
}

// ── Login ────────────────────────────────────────────────────────────

export interface LoginOptions {
  /**
   * Pre-built challenge. If provided, skips calling getChallenge().
   * Useful when you already fetched the challenge before calling login().
   */
  challenge?: ChallengeResponse;
}

export interface LoginResult {
  /** How the login was completed */
  method: 'extension' | 'qr' | 'deeplink';
  /** The signer's i-address */
  iAddress: string;
  /** VerusID friendly name (e.g. "player3@") */
  friendlyName?: string;
  /** Passthrough data from your backend's poll response */
  data?: Record<string, unknown>;
}

// ── Send ─────────────────────────────────────────────────────────────

export interface SendOptions {
  /** Receiving address (R-address or i-address) */
  to: string;
  /** Amount in coins (not satoshis) */
  amount: number;
  /** Currency name (default: "VRSC") */
  currency?: string;
}

export interface SendResult {
  /** Transaction ID */
  txid: string;
  /** How the send was completed */
  method: 'extension';
}

// ── Environment ──────────────────────────────────────────────────────

export type WalletEnvironment = 'extension' | 'mobile' | 'desktop';

// ── Provider (matches window.verus shape from webwallet) ─────────────

export interface VerusProvider {
  isVerusWallet: true;
  version: string;
  requestLogin(uri: string): Promise<unknown>;
  sendDeeplink(uri: string): Promise<unknown>;
  sendTransaction(params: {
    to: string;
    amount: number;
    currency?: string;
  }): Promise<{ txid: string }>;
}

// ── Events ───────────────────────────────────────────────────────────

export type VerusConnectEvent =
  | 'login:start'
  | 'login:success'
  | 'login:error'
  | 'login:cancel'
  | 'send:start'
  | 'send:success'
  | 'send:error'
  | 'send:cancel'
  | 'modal:open'
  | 'modal:close'
  | 'provider:detected';

export type EventListener = (data?: unknown) => void;

// ── Theme ────────────────────────────────────────────────────────────

export interface ThemeConfig {
  /** Primary accent color (default: "#3165D4") */
  primaryColor: string;
  /** Background color of the modal card (default: "#1a1a2e") */
  backgroundColor: string;
  /** Text color (default: "#e0e0e0") */
  textColor: string;
  /** Overlay backdrop color (default: "rgba(0,0,0,0.6)") */
  overlayColor: string;
  /** Border radius for the card (default: "16px") */
  borderRadius: string;
  /** Font family (default: system font stack) */
  fontFamily: string;
}

// ── Modal (internal) ─────────────────────────────────────────────────

export interface ModalHandle {
  setStatus(text: string): void;
  setQrData(data: string): void;
  setDeepLink(uri: string): void;
  destroy(): void;
  onClose: Promise<void>;
}

export interface ModalOptions {
  appName: string;
  environment: WalletEnvironment;
  theme: ThemeConfig;
  qrData?: string;
  deepLink?: string;
  statusText?: string;
}

// ── Server Middleware ────────────────────────────────────────────────

export interface VerusAuthConfig {
  /** Your app's VerusID i-address (e.g. "iYour...") */
  iAddress: string;
  /** WIF private key for the VerusID */
  privateKey: string;
  /** Chain name (default: "VRSC") */
  chain?: string;
  /** Verus API endpoint (default: "https://api.verus.services") */
  apiUrl?: string;
  /** Chain i-address (default: VRSC mainnet) */
  chainIAddress?: string;
  /** Public URL where the wallet will POST the response (e.g. "https://yoursite.com/auth/verus/verusidlogin") */
  callbackUrl: string;
  /** URL to redirect mobile users back to after signing (e.g. "https://yoursite.com/login"). When set, Verus Mobile will auto-return to this URL after POSTing the signed response. */
  redirectUrl?: string;
  /** Challenge TTL in ms (default: 300000 = 5 min) */
  challengeTtl?: number;
  /** Called when a login is verified — use this to create sessions, JWTs, etc. */
  onLogin?: (result: VerifiedLogin) => Promise<Record<string, unknown> | void>;
}

export interface VerifiedLogin {
  /** The signer's i-address */
  iAddress: string;
  /** VerusID friendly name (e.g. "player3@") */
  friendlyName: string;
  /** The challenge ID that was verified */
  challengeId: string;
}
