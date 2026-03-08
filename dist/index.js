// src/detect.ts
function isExtensionAvailable() {
  return !!(typeof window !== "undefined" && window.verus?.isVerusWallet);
}
function waitForProvider(timeoutMs = 2e3) {
  if (isExtensionAvailable()) {
    return Promise.resolve(window.verus);
  }
  return new Promise((resolve) => {
    const handler = () => {
      clearTimeout(timer);
      window.removeEventListener("verus#initialized", handler);
      resolve(window.verus ?? null);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("verus#initialized", handler);
      resolve(null);
    }, timeoutMs);
    window.addEventListener("verus#initialized", handler);
  });
}
function isMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini|IEMobile/i.test(
    navigator.userAgent
  );
}
function detectEnvironment() {
  if (isExtensionAvailable()) return "extension";
  if (isMobileBrowser()) return "mobile";
  return "desktop";
}

// src/extension.ts
function getProvider() {
  if (!window.verus?.isVerusWallet) {
    throw new Error("Verus Web Wallet extension not available");
  }
  return window.verus;
}
async function extensionLogin(uri) {
  const provider = getProvider();
  try {
    await provider.requestLogin(uri);
  } catch {
  }
}
async function extensionSend(params) {
  const provider = getProvider();
  const result = await provider.sendTransaction({
    to: params.to,
    amount: params.amount,
    currency: params.currency ?? "VRSC"
  });
  return {
    txid: result.txid,
    method: "extension"
  };
}

// src/deeplink.ts
var ALLOWED_SCHEMES = ["verus:", "vrsc:", "i5jtwbp6zymeay9llnraglgjqgdrffsau4:"];
function isValidDeepLink(uri) {
  if (!uri || typeof uri !== "string") return false;
  const scheme = uri.split("//")[0].toLowerCase();
  return ALLOWED_SCHEMES.some((s) => scheme === s);
}
function openDeepLink(uri) {
  if (!isValidDeepLink(uri)) {
    const scheme = uri?.split("//")[0] ?? "unknown";
    throw new Error(`verus-connect: blocked unsafe URI scheme "${scheme}"`);
  }
  window.location.href = uri;
}
function buildAndroidIntentUrl(uri) {
  const path = uri.replace(/^[a-zA-Z0-9]+:\/\//, "");
  const scheme = uri.split("://")[0];
  return `intent://${path}#Intent;scheme=${scheme};end`;
}

// src/qr.ts
import qrcode from "qrcode-generator";
function generateQrSvg(data, size = 256) {
  const qr = qrcode(0, "M");
  qr.addData(data);
  qr.make();
  const moduleCount = qr.getModuleCount();
  const cellSize = size / moduleCount;
  const margin = 0;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
  svg += `<rect width="${size}" height="${size}" fill="#ffffff"/>`;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        const x = col * cellSize + margin;
        const y = row * cellSize + margin;
        svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#000000"/>`;
      }
    }
  }
  svg += "</svg>";
  return svg;
}
function generateQrDataUrl(data, size = 256) {
  const svg = generateQrSvg(data, size);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// src/poller.ts
function poll(options) {
  const {
    getResult,
    challengeId,
    interval = 3e3,
    timeout = 3e5,
    signal
  } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }
    const deadline = Date.now() + timeout;
    let timer;
    const cleanup = () => {
      clearInterval(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);
    const tick = async () => {
      if (Date.now() > deadline) {
        cleanup();
        return reject(new Error("Polling timed out"));
      }
      try {
        const result = await getResult(challengeId);
        if (result.status === "verified") {
          cleanup();
          return resolve(result);
        }
        if (result.status === "error") {
          cleanup();
          return reject(new Error(result.error ?? "Challenge failed"));
        }
      } catch {
      }
    };
    tick();
    timer = setInterval(tick, interval);
  });
}

// src/ui.css.ts
var MODAL_CSS = (
  /* css */
  `
.vc-overlay {
  position: fixed;
  inset: 0;
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vc-overlay, rgba(0, 0, 0, 0.6));
  font-family: var(--vc-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  animation: vc-fade-in 0.15s ease-out;
}

@keyframes vc-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes vc-slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.vc-card {
  position: relative;
  width: 360px;
  max-width: 92vw;
  padding: 28px 24px;
  background: var(--vc-bg, #1a1a2e);
  color: var(--vc-text, #e0e0e0);
  border-radius: var(--vc-radius, 16px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  animation: vc-slide-up 0.2s ease-out;
}

.vc-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--vc-text, #e0e0e0);
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 28px;
  text-align: center;
  transition: background 0.15s;
}

.vc-close:hover {
  background: rgba(255, 255, 255, 0.15);
}

.vc-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
  text-align: center;
}

.vc-subtitle {
  margin: 0 0 20px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
}

.vc-qr-container {
  display: flex;
  justify-content: center;
  margin: 0 0 20px;
}

.vc-qr-container > div {
  background: #ffffff;
  border-radius: 12px;
  padding: 16px;
  line-height: 0;
}

.vc-qr-container svg {
  width: 200px;
  height: 200px;
}

.vc-deeplink-btn {
  display: block;
  width: 100%;
  padding: 12px 16px;
  margin: 0 0 12px;
  border: none;
  border-radius: 10px;
  background: var(--vc-primary, #3165D4);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  transition: opacity 0.15s;
}

.vc-deeplink-btn:hover {
  opacity: 0.85;
}

.vc-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  color: var(--vc-primary, #3165D4);
}

.vc-spinner {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vc-primary, #3165D4);
  animation: vc-pulse 1.2s ease-in-out infinite;
}

@keyframes vc-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50%      { opacity: 1; transform: scale(1); }
}

.vc-ext-icon {
  font-size: 48px;
  text-align: center;
  margin: 0 0 12px;
}

.vc-ext-msg {
  font-size: 14px;
  text-align: center;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 0 20px;
}
`
);

// src/ui.ts
var styleInjected = false;
function injectStyles() {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = MODAL_CSS;
  style.setAttribute("data-verus-connect", "");
  document.head.appendChild(style);
  styleInjected = true;
}
function applyTheme(el, theme) {
  el.style.setProperty("--vc-primary", theme.primaryColor);
  el.style.setProperty("--vc-bg", theme.backgroundColor);
  el.style.setProperty("--vc-text", theme.textColor);
  el.style.setProperty("--vc-overlay", theme.overlayColor);
  el.style.setProperty("--vc-radius", theme.borderRadius);
  el.style.setProperty("--vc-font", theme.fontFamily);
}
function showModal(options) {
  injectStyles();
  const { appName, environment, theme, qrData, deepLink, statusText } = options;
  let resolveClose;
  const onClose = new Promise((r) => {
    resolveClose = r;
  });
  const overlay = document.createElement("div");
  overlay.className = "vc-overlay";
  applyTheme(overlay, theme);
  const card = document.createElement("div");
  card.className = "vc-card";
  const closeBtn = document.createElement("button");
  closeBtn.className = "vc-close";
  closeBtn.textContent = "\xD7";
  closeBtn.setAttribute("aria-label", "Close");
  card.appendChild(closeBtn);
  const title = document.createElement("h2");
  title.className = "vc-title";
  title.textContent = appName || "Verus Login";
  card.appendChild(title);
  const subtitle = document.createElement("p");
  subtitle.className = "vc-subtitle";
  if (environment === "mobile") {
    subtitle.textContent = "Tap below to open Verus Mobile";
  } else if (environment === "extension") {
    subtitle.textContent = "Approve in Verus Web Wallet";
  } else {
    subtitle.textContent = "Scan with Verus Mobile to continue";
  }
  card.appendChild(subtitle);
  let extIcon = null;
  let extMsg = null;
  if (environment === "extension") {
    extIcon = document.createElement("div");
    extIcon.className = "vc-ext-icon";
    extIcon.textContent = "\u{1F512}";
    card.appendChild(extIcon);
    extMsg = document.createElement("p");
    extMsg.className = "vc-ext-msg";
    extMsg.textContent = "Check the extension popup to sign the request with your VerusID";
    card.appendChild(extMsg);
  }
  const qrContainer = document.createElement("div");
  qrContainer.className = "vc-qr-container";
  if (environment !== "extension") {
    if (qrData) {
      const qrWrap = document.createElement("div");
      const cleaned = qrData.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\bon\w+\s*=/gi, "data-removed=");
      qrWrap.innerHTML = cleaned;
      qrContainer.appendChild(qrWrap);
    }
    card.appendChild(qrContainer);
  }
  let deepLinkBtn = null;
  if (environment === "mobile") {
    deepLinkBtn = document.createElement("a");
    deepLinkBtn.className = "vc-deeplink-btn";
    deepLinkBtn.textContent = "Open in Verus Mobile";
    if (deepLink) {
      deepLinkBtn.href = deepLink;
      deepLinkBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.href = deepLink;
      });
    }
    card.appendChild(deepLinkBtn);
  }
  const statusEl = document.createElement("div");
  statusEl.className = "vc-status";
  const spinner = document.createElement("span");
  spinner.className = "vc-spinner";
  const statusLabel = document.createElement("span");
  statusLabel.textContent = statusText ?? "Waiting for approval\u2026";
  statusEl.appendChild(spinner);
  statusEl.appendChild(statusLabel);
  card.appendChild(statusEl);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const destroy = () => {
    overlay.remove();
    resolveClose();
  };
  closeBtn.addEventListener("click", destroy);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) destroy();
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      document.removeEventListener("keydown", onKey);
      destroy();
    }
  };
  document.addEventListener("keydown", onKey);
  return {
    setStatus(text) {
      statusLabel.textContent = text;
    },
    setQrData(svgHtml) {
      qrContainer.innerHTML = "";
      const wrap = document.createElement("div");
      const cleaned = svgHtml.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\bon\w+\s*=/gi, "data-removed=");
      wrap.innerHTML = cleaned;
      qrContainer.appendChild(wrap);
    },
    setDeepLink(uri) {
      if (deepLinkBtn) {
        deepLinkBtn.href = uri;
        const newBtn = deepLinkBtn.cloneNode(true);
        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          window.location.href = uri;
        });
        deepLinkBtn.replaceWith(newBtn);
        deepLinkBtn = newBtn;
      }
    },
    destroy,
    onClose
  };
}

// src/connect.ts
var DEFAULT_THEME = {
  primaryColor: "#3165D4",
  backgroundColor: "#1a1a2e",
  textColor: "#e0e0e0",
  overlayColor: "rgba(0, 0, 0, 0.6)",
  borderRadius: "16px",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
};
var VerusConnect = class {
  constructor(config) {
    this.listeners = /* @__PURE__ */ new Map();
    this.activeAbort = null;
    this.activeModal = null;
    if (!config.serverUrl && !config.getChallenge) {
      throw new Error("verus-connect: provide either serverUrl or getChallenge()");
    }
    if (!config.serverUrl && !config.getResult) {
      throw new Error("verus-connect: provide either serverUrl or getResult()");
    }
    this.config = config;
    this.theme = { ...DEFAULT_THEME, ...config.theme };
    const baseUrl = config.serverUrl?.replace(/\/$/, "");
    this._getChallenge = config.getChallenge ?? (async () => {
      const res = await fetch(`${baseUrl}/login`, { method: "POST" });
      if (!res.ok) throw new Error(`Challenge request failed: ${res.status}`);
      const data = await res.json();
      return { uri: data.uri ?? data.deepLink, challengeId: data.challengeId };
    });
    this._getResult = config.getResult ?? (async (challengeId) => {
      const res = await fetch(`${baseUrl}/result/${challengeId}`);
      if (!res.ok) throw new Error(`Status request failed: ${res.status}`);
      return await res.json();
    });
  }
  // ── Events ───────────────────────────────────────────────────────────
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(listener);
  }
  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event, data) {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }
  // ── Login ────────────────────────────────────────────────────────────
  async login(options) {
    this.cancelActive();
    const abort = new AbortController();
    this.activeAbort = abort;
    this.emit("login:start");
    try {
      const challenge = options?.challenge ?? await this._getChallenge();
      const { uri, challengeId } = challenge;
      if (!isValidDeepLink(uri)) {
        throw new Error("verus-connect: server returned an invalid deep link URI. Login blocked for safety.");
      }
      let env = detectEnvironment();
      if (env !== "extension") {
        const provider = await waitForProvider(500);
        if (provider) env = "extension";
      }
      this.emit("provider:detected", env);
      if (env === "extension") {
        return await this.loginViaExtension(uri, challengeId, abort.signal);
      } else {
        return await this.loginViaModal(uri, challengeId, env, abort.signal);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        this.emit("login:cancel");
        throw err;
      }
      this.emit("login:error", err);
      throw err;
    } finally {
      this.activeAbort = null;
    }
  }
  async loginViaExtension(uri, challengeId, signal) {
    extensionLogin(uri);
    const modal = showModal({
      appName: this.config.appName ?? "Verus Login",
      environment: "extension",
      theme: this.theme,
      statusText: "Waiting for approval\u2026"
    });
    this.activeModal = modal;
    modal.onClose.then(() => {
      if (!signal.aborted) this.activeAbort?.abort();
    });
    try {
      const result = await poll({
        getResult: this._getResult,
        challengeId,
        interval: this.config.pollInterval ?? 3e3,
        timeout: this.config.pollTimeout ?? 3e5,
        signal
      });
      modal.setStatus("Approved!");
      await delay(400);
      modal.destroy();
      const loginResult = {
        method: "extension",
        iAddress: result.iAddress,
        friendlyName: result.friendlyName,
        data: result.data
      };
      this.emit("login:success", loginResult);
      return loginResult;
    } catch (err) {
      modal.destroy();
      throw err;
    }
  }
  async loginViaModal(uri, challengeId, env, signal) {
    const qrSvg = generateQrSvg(uri, 200);
    const modal = showModal({
      appName: this.config.appName ?? "Verus Login",
      environment: env,
      theme: this.theme,
      qrData: qrSvg,
      deepLink: uri,
      statusText: "Waiting for approval\u2026"
    });
    this.activeModal = modal;
    this.emit("modal:open");
    if (env === "mobile") {
      try {
        openDeepLink(uri);
      } catch {
      }
    }
    modal.onClose.then(() => {
      this.emit("modal:close");
      if (!signal.aborted) this.activeAbort?.abort();
    });
    try {
      const result = await poll({
        getResult: this._getResult,
        challengeId,
        interval: this.config.pollInterval ?? 3e3,
        timeout: this.config.pollTimeout ?? 3e5,
        signal
      });
      modal.setStatus("Approved!");
      await delay(400);
      modal.destroy();
      const method = env === "mobile" ? "deeplink" : "qr";
      const loginResult = {
        method,
        iAddress: result.iAddress,
        friendlyName: result.friendlyName,
        data: result.data
      };
      this.emit("login:success", loginResult);
      return loginResult;
    } catch (err) {
      modal.destroy();
      throw err;
    }
  }
  // ── Send ─────────────────────────────────────────────────────────────
  async send(params) {
    this.cancelActive();
    this.emit("send:start", params);
    try {
      if (!isExtensionAvailable()) {
        throw new Error(
          "verus-connect: send() currently requires the Verus Web Wallet extension. Mobile send via deep link is not yet supported."
        );
      }
      const result = await extensionSend(params);
      this.emit("send:success", result);
      return result;
    } catch (err) {
      this.emit("send:error", err);
      throw err;
    }
  }
  // ── Utilities ────────────────────────────────────────────────────────
  /** Cancel any active login/send session */
  cancel() {
    this.cancelActive();
  }
  /** Clean up all resources */
  destroy() {
    this.cancelActive();
    this.listeners.clear();
  }
  /** Get the detected environment */
  getEnvironment() {
    return detectEnvironment();
  }
  /** Check if the extension is available */
  isExtensionAvailable() {
    return isExtensionAvailable();
  }
  cancelActive() {
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.activeModal?.destroy();
    this.activeModal = null;
  }
};
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
export {
  VerusConnect,
  buildAndroidIntentUrl,
  detectEnvironment,
  extensionLogin,
  extensionSend,
  generateQrDataUrl,
  generateQrSvg,
  isExtensionAvailable,
  isMobileBrowser,
  isValidDeepLink,
  openDeepLink,
  poll,
  showModal,
  waitForProvider
};
//# sourceMappingURL=index.js.map