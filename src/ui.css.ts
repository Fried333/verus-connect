// CSS injected as a string at runtime — no external stylesheet needed
export const MODAL_CSS = /* css */ `
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
`;
