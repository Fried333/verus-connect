import type { ModalHandle, ModalOptions, ThemeConfig } from './types';
import { MODAL_CSS } from './ui.css';

let styleInjected = false;

function injectStyles(): void {
  if (styleInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = MODAL_CSS;
  style.setAttribute('data-verus-connect', '');
  document.head.appendChild(style);
  styleInjected = true;
}

function applyTheme(el: HTMLElement, theme: ThemeConfig): void {
  el.style.setProperty('--vc-primary', theme.primaryColor);
  el.style.setProperty('--vc-bg', theme.backgroundColor);
  el.style.setProperty('--vc-text', theme.textColor);
  el.style.setProperty('--vc-overlay', theme.overlayColor);
  el.style.setProperty('--vc-radius', theme.borderRadius);
  el.style.setProperty('--vc-font', theme.fontFamily);
}

/**
 * Show the Verus Connect modal.
 * Returns a handle for updating status, QR data, and destroying the modal.
 * Pure DOM — no framework dependency.
 */
export function showModal(options: ModalOptions): ModalHandle {
  injectStyles();

  const { appName, environment, theme, qrData, deepLink, statusText } = options;

  let resolveClose: () => void;
  const onClose = new Promise<void>((r) => { resolveClose = r; });

  // -- Build DOM --
  const overlay = document.createElement('div');
  overlay.className = 'vc-overlay';
  applyTheme(overlay, theme);

  const card = document.createElement('div');
  card.className = 'vc-card';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'vc-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.setAttribute('aria-label', 'Close');
  card.appendChild(closeBtn);

  // Title
  const title = document.createElement('h2');
  title.className = 'vc-title';
  title.textContent = appName || 'Verus Login';
  card.appendChild(title);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.className = 'vc-subtitle';
  if (environment === 'mobile') {
    subtitle.textContent = 'Tap below to open Verus Mobile';
  } else if (environment === 'extension') {
    subtitle.textContent = 'Approve in Verus Web Wallet';
  } else {
    subtitle.textContent = 'Scan with Verus Mobile to continue';
  }
  card.appendChild(subtitle);

  // Extension waiting screen
  let extIcon: HTMLDivElement | null = null;
  let extMsg: HTMLParagraphElement | null = null;
  if (environment === 'extension') {
    extIcon = document.createElement('div');
    extIcon.className = 'vc-ext-icon';
    extIcon.textContent = '\uD83D\uDD12'; // lock emoji
    card.appendChild(extIcon);

    extMsg = document.createElement('p');
    extMsg.className = 'vc-ext-msg';
    extMsg.textContent = 'Check the extension popup to sign the request with your VerusID';
    card.appendChild(extMsg);
  }

  // QR container (desktop / mobile fallback)
  const qrContainer = document.createElement('div');
  qrContainer.className = 'vc-qr-container';
  if (environment !== 'extension') {
    if (qrData) {
      const qrWrap = document.createElement('div');
      qrWrap.innerHTML = qrData;
      qrContainer.appendChild(qrWrap);
    }
    card.appendChild(qrContainer);
  }

  // Deep link button (mobile)
  let deepLinkBtn: HTMLAnchorElement | null = null;
  if (environment === 'mobile') {
    deepLinkBtn = document.createElement('a');
    deepLinkBtn.className = 'vc-deeplink-btn';
    deepLinkBtn.textContent = 'Open in Verus Mobile';
    if (deepLink) deepLinkBtn.href = deepLink;
    card.appendChild(deepLinkBtn);
  }

  // Status line
  const statusEl = document.createElement('div');
  statusEl.className = 'vc-status';
  const spinner = document.createElement('span');
  spinner.className = 'vc-spinner';
  const statusLabel = document.createElement('span');
  statusLabel.textContent = statusText ?? 'Waiting for approval\u2026';
  statusEl.appendChild(spinner);
  statusEl.appendChild(statusLabel);
  card.appendChild(statusEl);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // -- Close handlers --
  const destroy = () => {
    overlay.remove();
    resolveClose();
  };

  closeBtn.addEventListener('click', destroy);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) destroy();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      destroy();
    }
  };
  document.addEventListener('keydown', onKey);

  // -- Return handle --
  return {
    setStatus(text: string) {
      statusLabel.textContent = text;
    },
    setQrData(svgHtml: string) {
      qrContainer.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.innerHTML = svgHtml;
      qrContainer.appendChild(wrap);
    },
    setDeepLink(uri: string) {
      if (deepLinkBtn) deepLinkBtn.href = uri;
    },
    destroy,
    onClose,
  };
}
