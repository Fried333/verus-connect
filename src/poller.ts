import type { PollResponse } from './types';

export interface PollOptions {
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
export function poll(options: PollOptions): Promise<PollResponse> {
  const {
    getResult,
    challengeId,
    interval = 3000,
    timeout = 300_000,
    signal,
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }

    const deadline = Date.now() + timeout;
    let timer: ReturnType<typeof setTimeout>;
    let consecutiveErrors = 0;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort);

    const schedule = () => {
      // Back off on consecutive network errors: interval, 2x, 4x, capped at 30s
      const backoff = consecutiveErrors > 0
        ? Math.min(interval * Math.pow(2, consecutiveErrors), 30_000)
        : interval;
      timer = setTimeout(tick, backoff);
    };

    const tick = async () => {
      if (Date.now() > deadline) {
        cleanup();
        return reject(new Error('Polling timed out'));
      }

      try {
        const result = await getResult(challengeId);
        consecutiveErrors = 0; // reset on success

        if (result.status === 'verified') {
          cleanup();
          return resolve(result);
        }

        if (result.status === 'error') {
          cleanup();
          return reject(new Error(result.error ?? 'Challenge failed'));
        }

        // status === 'pending' — keep polling
      } catch {
        consecutiveErrors++;
        // Network error — keep polling with backoff
      }

      schedule();
    };

    // First tick immediately
    tick();
  });
}
