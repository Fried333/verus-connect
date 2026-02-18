import type {
  VerusConnectConfig,
  ChallengeResponse,
  PollResponse,
  LoginOptions,
  LoginResult,
  SendOptions,
  SendResult,
  WalletEnvironment,
  ThemeConfig,
  EventListener,
  VerusConnectEvent,
  ModalHandle,
} from './types';
import { detectEnvironment, isExtensionAvailable, waitForProvider } from './detect';
import { extensionLogin, extensionSend } from './extension';
import { generateQrSvg } from './qr';
import { poll } from './poller';
import { showModal } from './ui';

const DEFAULT_THEME: ThemeConfig = {
  primaryColor: '#3165D4',
  backgroundColor: '#1a1a2e',
  textColor: '#e0e0e0',
  overlayColor: 'rgba(0, 0, 0, 0.6)',
  borderRadius: '16px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

export class VerusConnect {
  private config: VerusConnectConfig;
  private theme: ThemeConfig;
  private _getChallenge: () => Promise<ChallengeResponse>;
  private _getResult: (challengeId: string) => Promise<PollResponse>;
  private listeners = new Map<VerusConnectEvent, Set<EventListener>>();
  private activeAbort: AbortController | null = null;
  private activeModal: ModalHandle | null = null;

  constructor(config: VerusConnectConfig) {
    if (!config.serverUrl && !config.getChallenge) {
      throw new Error('verus-connect: provide either serverUrl or getChallenge()');
    }
    if (!config.serverUrl && !config.getResult) {
      throw new Error('verus-connect: provide either serverUrl or getResult()');
    }

    this.config = config;
    this.theme = { ...DEFAULT_THEME, ...config.theme };

    // Wire up getChallenge / getResult — custom functions take priority over serverUrl
    const baseUrl = config.serverUrl?.replace(/\/$/, '');

    this._getChallenge = config.getChallenge ?? (async () => {
      const res = await fetch(`${baseUrl}/login`, { method: 'POST' });
      if (!res.ok) throw new Error(`Challenge request failed: ${res.status}`);
      const data = await res.json();
      return { uri: data.uri ?? data.deepLink, challengeId: data.challengeId };
    });

    this._getResult = config.getResult ?? (async (challengeId: string) => {
      const res = await fetch(`${baseUrl}/result/${challengeId}`);
      if (!res.ok) throw new Error(`Status request failed: ${res.status}`);
      return await res.json() as PollResponse;
    });
  }

  // ── Events ───────────────────────────────────────────────────────────

  on(event: VerusConnectEvent, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: VerusConnectEvent, listener: EventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: VerusConnectEvent, data?: unknown): void {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }

  // ── Login ────────────────────────────────────────────────────────────

  async login(options?: LoginOptions): Promise<LoginResult> {
    this.cancelActive();

    const abort = new AbortController();
    this.activeAbort = abort;

    this.emit('login:start');

    try {
      // 1. Get or use provided challenge
      const challenge = options?.challenge ?? await this._getChallenge();
      const { uri, challengeId } = challenge;

      // 2. Detect environment — give extension a brief window to initialize
      let env: WalletEnvironment = detectEnvironment();
      if (env !== 'extension') {
        const provider = await waitForProvider(500);
        if (provider) env = 'extension';
      }

      this.emit('provider:detected', env);

      // 3. Route based on environment
      if (env === 'extension') {
        return await this.loginViaExtension(uri, challengeId, abort.signal);
      } else {
        return await this.loginViaModal(uri, challengeId, env, abort.signal);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.emit('login:cancel');
        throw err;
      }
      this.emit('login:error', err);
      throw err;
    } finally {
      this.activeAbort = null;
    }
  }

  private async loginViaExtension(
    uri: string,
    challengeId: string,
    signal: AbortSignal,
  ): Promise<LoginResult> {
    // Fire and forget — extension opens popup
    extensionLogin(uri);

    // Show a minimal modal so the user knows we're waiting
    const modal = showModal({
      appName: this.config.appName ?? 'Verus Login',
      environment: 'extension',
      theme: this.theme,
      statusText: 'Waiting for approval\u2026',
    });
    this.activeModal = modal;

    // Close modal on abort
    modal.onClose.then(() => {
      if (!signal.aborted) this.activeAbort?.abort();
    });

    try {
      const result = await poll({
        getResult: this._getResult,
        challengeId,
        interval: this.config.pollInterval ?? 3000,
        timeout: this.config.pollTimeout ?? 300_000,
        signal,
      });

      modal.setStatus('Approved!');
      await delay(400);
      modal.destroy();

      const loginResult: LoginResult = {
        method: 'extension',
        iAddress: result.iAddress!,
        friendlyName: result.friendlyName,
        data: result.data,
      };
      this.emit('login:success', loginResult);
      return loginResult;
    } catch (err) {
      modal.destroy();
      throw err;
    }
  }

  private async loginViaModal(
    uri: string,
    challengeId: string,
    env: WalletEnvironment,
    signal: AbortSignal,
  ): Promise<LoginResult> {
    const qrSvg = generateQrSvg(uri, 200);

    const modal = showModal({
      appName: this.config.appName ?? 'Verus Login',
      environment: env,
      theme: this.theme,
      qrData: qrSvg,
      deepLink: uri,
      statusText: 'Waiting for approval\u2026',
    });
    this.activeModal = modal;
    this.emit('modal:open');

    // If user closes modal, abort polling
    modal.onClose.then(() => {
      this.emit('modal:close');
      if (!signal.aborted) this.activeAbort?.abort();
    });

    try {
      const result = await poll({
        getResult: this._getResult,
        challengeId,
        interval: this.config.pollInterval ?? 3000,
        timeout: this.config.pollTimeout ?? 300_000,
        signal,
      });

      modal.setStatus('Approved!');
      await delay(400);
      modal.destroy();

      const method = env === 'mobile' ? 'deeplink' : 'qr';
      const loginResult: LoginResult = {
        method,
        iAddress: result.iAddress!,
        friendlyName: result.friendlyName,
        data: result.data,
      };
      this.emit('login:success', loginResult);
      return loginResult;
    } catch (err) {
      modal.destroy();
      throw err;
    }
  }

  // ── Send ─────────────────────────────────────────────────────────────

  async send(params: SendOptions): Promise<SendResult> {
    this.cancelActive();
    this.emit('send:start', params);

    try {
      if (!isExtensionAvailable()) {
        throw new Error(
          'verus-connect: send() currently requires the Verus Web Wallet extension. ' +
          'Mobile send via deep link is not yet supported.',
        );
      }

      const result = await extensionSend(params);
      this.emit('send:success', result);
      return result;
    } catch (err) {
      this.emit('send:error', err);
      throw err;
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────

  /** Cancel any active login/send session */
  cancel(): void {
    this.cancelActive();
  }

  /** Clean up all resources */
  destroy(): void {
    this.cancelActive();
    this.listeners.clear();
  }

  /** Get the detected environment */
  getEnvironment(): WalletEnvironment {
    return detectEnvironment();
  }

  /** Check if the extension is available */
  isExtensionAvailable(): boolean {
    return isExtensionAvailable();
  }

  private cancelActive(): void {
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.activeModal?.destroy();
    this.activeModal = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
