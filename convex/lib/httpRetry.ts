/**
 * Shared backoff for raw `fetch` calls to OpenRouter (TTS and STT). The AI
 * SDK paths retry on their own; these two hand-rolled clients used to carry
 * identical copies of this logic.
 */

export const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30_000;

/**
 * 4xx won't get better on retry, except 429; 5xx / upstream flakes and rate
 * limits deserve a backoff instead of hammering upstream.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Backoff before re-POSTing: honor Retry-After when present, else 1s/2s. */
export function retryDelayMs(response: Response, attempt: number): number {
  const retryAfterSeconds = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, RETRY_MAX_DELAY_MS);
  }
  return RETRY_BASE_DELAY_MS * 2 ** attempt;
}
