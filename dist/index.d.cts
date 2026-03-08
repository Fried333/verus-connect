interface VerusConnectConfig {
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
interface ChallengeResponse {
    /** The verus:// deep link URI (server-signed) */
    uri: string;
    /** Unique challenge ID for polling */
    challengeId: string;
}
interface PollResponse {
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
interface LoginOptions {
    /**
     * Pre-built challenge. If provided, skips calling getChallenge().
     * Useful when you already fetched the challenge before calling login().
     */
    challenge?: ChallengeResponse;
}
interface LoginResult {
    /** How the login was completed */
    method: 'extension' | 'qr' | 'deeplink';
    /** The signer's i-address */
    iAddress: string;
    /** VerusID friendly name (e.g. "player3@") */
    friendlyName?: string;
    /** Passthrough data from your backend's poll response */
    data?: Record<string, unknown>;
}
interface SendOptions {
    /** Receiving address (R-address or i-address) */
    to: string;
    /** Amount in coins (not satoshis) */
    amount: number;
    /** Currency name (default: "VRSC") */
    currency?: string;
}
interface SendResult {
    /** Transaction ID */
    txid: string;
    /** How the send was completed */
    method: 'extension';
}
type WalletEnvironment = 'extension' | 'mobile' | 'desktop';
interface VerusProvider {
    isVerusWallet: true;
    version: string;
    requestLogin(uri: string): Promise<unknown>;
    sendDeeplink(uri: string): Promise<unknown>;
    sendTransaction(params: {
        to: string;
        amount: number;
        currency?: string;
    }): Promise<{
        txid: string;
    }>;
}
type VerusConnectEvent = 'login:start' | 'login:success' | 'login:error' | 'login:cancel' | 'send:start' | 'send:success' | 'send:error' | 'send:cancel' | 'modal:open' | 'modal:close' | 'provider:detected';
type EventListener = (data?: unknown) => void;
interface ThemeConfig {
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
interface ModalHandle {
    setStatus(text: string): void;
    setQrData(data: string): void;
    setDeepLink(uri: string): void;
    destroy(): void;
    onClose: Promise<void>;
}
interface ModalOptions {
    appName: string;
    environment: WalletEnvironment;
    theme: ThemeConfig;
    qrData?: string;
    deepLink?: string;
    statusText?: string;
}

declare class VerusConnect {
    private config;
    private theme;
    private _getChallenge;
    private _getResult;
    private listeners;
    private activeAbort;
    private activeModal;
    constructor(config: VerusConnectConfig);
    on(event: VerusConnectEvent, listener: EventListener): void;
    off(event: VerusConnectEvent, listener: EventListener): void;
    private emit;
    login(options?: LoginOptions): Promise<LoginResult>;
    private loginViaExtension;
    private loginViaModal;
    send(params: SendOptions): Promise<SendResult>;
    /** Cancel any active login/send session */
    cancel(): void;
    /** Clean up all resources */
    destroy(): void;
    /** Get the detected environment */
    getEnvironment(): WalletEnvironment;
    /** Check if the extension is available */
    isExtensionAvailable(): boolean;
    private cancelActive;
}

declare global {
    interface Window {
        verus?: VerusProvider;
    }
}
/** Check if the Verus Web Wallet extension is available right now */
declare function isExtensionAvailable(): boolean;
/**
 * Wait for the extension provider to be injected.
 * Content scripts inject `window.verus` and dispatch `verus#initialized`.
 * Returns the provider or null if timeout expires.
 */
declare function waitForProvider(timeoutMs?: number): Promise<VerusProvider | null>;
/** Simple mobile browser detection via user agent */
declare function isMobileBrowser(): boolean;
/** Detect the current wallet environment */
declare function detectEnvironment(): WalletEnvironment;

/**
 * Request login via the browser extension.
 * The extension opens its approval popup; the promise resolves when the user
 * approves (or rejects) in the popup. However, the actual result still comes
 * back via the server webhook + polling, so this is fire-and-forget.
 */
declare function extensionLogin(uri: string): Promise<void>;
/**
 * Request a send transaction via the browser extension.
 * Returns the txid on success.
 */
declare function extensionSend(params: SendOptions): Promise<SendResult>;

/**
 * Validate that a URI uses a safe Verus deep link scheme.
 * Blocks javascript:, data:, http:, https:, and any other non-Verus scheme.
 * Returns true if the URI is safe to use in QR codes and deep links.
 */
declare function isValidDeepLink(uri: string): boolean;
/**
 * Open a verus:// deep link, triggering the OS app handler (Verus Mobile).
 * On mobile browsers this launches the app directly.
 * Only allows verus/vrsc schemes — rejects javascript:, data:, etc.
 */
declare function openDeepLink(uri: string): void;
/**
 * Build an Android intent:// fallback URL.
 * Used when the standard deep link doesn't trigger the app on Android.
 */
declare function buildAndroidIntentUrl(uri: string): string;

/**
 * Generate a QR code as an SVG string.
 * Uses qrcode-generator which is tiny (~12KB) with zero deps.
 */
declare function generateQrSvg(data: string, size?: number): string;
/**
 * Generate a QR code as a data URL (SVG-based, no canvas needed).
 */
declare function generateQrDataUrl(data: string, size?: number): string;

interface PollOptions {
    /** Function to call on each tick — must return the poll result */
    getResult: (challengeId: string) => Promise<PollResponse>;
    /** The challenge ID to poll for */
    challengeId: string;
    /** Interval between polls in ms (default: 3000) */
    interval?: number;
    /** Give up after this many ms (default: 300000 = 5 min) */
    timeout?: number;
    /** AbortSignal for external cancellation (e.g. modal close) */
    signal?: AbortSignal;
}
/**
 * Poll the developer's backend for a challenge result.
 * Resolves when status becomes 'verified'. Rejects on error, timeout, or abort.
 */
declare function poll(options: PollOptions): Promise<PollResponse>;

/**
 * Show the Verus Connect modal.
 * Returns a handle for updating status, QR data, and destroying the modal.
 * Pure DOM — no framework dependency.
 */
declare function showModal(options: ModalOptions): ModalHandle;

export { type ChallengeResponse, type EventListener, type LoginOptions, type LoginResult, type PollResponse, type SendOptions, type SendResult, type ThemeConfig, VerusConnect, type VerusConnectConfig, type VerusConnectEvent, type VerusProvider, type WalletEnvironment, buildAndroidIntentUrl, detectEnvironment, extensionLogin, extensionSend, generateQrDataUrl, generateQrSvg, isExtensionAvailable, isMobileBrowser, isValidDeepLink, openDeepLink, poll, showModal, waitForProvider };
