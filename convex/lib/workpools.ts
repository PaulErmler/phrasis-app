import { Workpool } from '@convex-dev/workpool';
import { components } from '../_generated/api';

/**
 * Content-generation work pools. These replace the hand-rolled queue system
 * (queue tables + slot tables + pump mutations + dedup-flag doc): the pool
 * owns queueing, the concurrency cap, retries with jittered exponential
 * backoff, and a GUARANTEED onComplete callback (fires on success, failure,
 * and cancellation). That guarantee is what lets the dedup claims
 * (`ttsGenerationClaims` / `llmTranslationClaims`) live exactly from enqueue
 * to onComplete with no staleness gymnastics in between.
 *
 * Both pools are FIFO — there are no priority tiers (deliberate
 * simplification; admin warmups are manual and rare, so user-facing work
 * doesn't meaningfully queue behind background batches in normal operation).
 * maxParallelism can be tuned at runtime via
 * `components.<pool>.config.update` without a redeploy.
 *
 * Provider request pacing is NOT the pool's job: workers reserve tokens from
 * the shared rate limiter (see `reserveRateLimitToken`) before every
 * provider HTTP call.
 */

/**
 * LLM translation pool. Parallelism matches the old MAX_LLM_CONCURRENCY.
 * Retry budget ≈ 4 minutes of jittered backoff (2s·2^n), replacing the old
 * 20-cycle self-re-enqueue chain: OpenRouter failures surface as throws from
 * the worker and the pool re-runs it; after the last attempt the onComplete
 * handler falls back to Google Translate.
 */
export const llmPool = new Workpool(components.llmPool, {
  maxParallelism: 64,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 8, initialBackoffMs: 2_000, base: 2 },
});

/**
 * TTS synthesis pool, shared by all providers (google / azure / gemini).
 * Throughput is rate-limiter-bound, not parallelism-bound, so a single pool
 * suffices; a throttled provider can't starve the others because workers
 * THROW (freeing the slot) instead of sleeping when the projected token wait
 * is long. Retry budget ≈ 80s (2s·3^n) — wide enough to ride out provider
 * 429 bursts, the failure mode that used to permanently drop audio.
 */
export const ttsPool = new Workpool(components.ttsPool, {
  maxParallelism: 24,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2_000, base: 3 },
});
