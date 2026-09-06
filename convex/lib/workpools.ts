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
 * Each pool is FIFO. Priority is expressed by POOL CHOICE, not tiers within a
 * pool: interactive jobs (a card on the user's screen) go to `ttsPool` /
 * `llmPool`, warm jobs to the low-parallelism `ttsWarmPool` / `llmWarmPool`.
 * A fresh signup enqueues hundreds of warm TTS jobs at once, and in a single
 * FIFO pool those queued ahead of the seeded first-lesson cards' audio; an
 * onboarding translation warmup does the same to `llmPool` at a far larger
 * scale. See `ttsPriorityValidator` / `llmPriorityValidator` (convex/types.ts)
 * for the classification rules. maxParallelism can be tuned at runtime via
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
 * Background LLM translation pool for warm sweeps (llmPriority 'background':
 * today the onboarding translation warmup and the admin chart-language
 * warmup). A single warmup run enqueues every placement sentence plus the
 * first sentences of every level collection times every supported language,
 * thousands of jobs at once. In one FIFO pool those queued ahead of every
 * user-facing translation until they drained.
 *
 * Unlike TTS and STT there is no provider rate limiter behind this
 * (rateLimiter.ts has buckets for the TTS providers and for OpenRouter's
 * transcription endpoint, none for OpenRouter's LLM endpoints), so
 * maxParallelism is the ONLY pacing knob and warm jobs have no token wait cap
 * to throw against. Interactive demand for a translation a warm job is
 * already holding is handled at the claim instead: see
 * `claimLlmTranslationIfAvailable`, which cancels the warm job and re-enqueues
 * on `llmPool`.
 *
 * Patient retry curve for the same reason as `ttsWarmPool`: nobody is waiting,
 * and 8 attempts at 10s·3^n ≈ 3h of jittered backoff rides out an OpenRouter
 * outage instead of dropping the job.
 */
export const llmWarmPool = new Workpool(components.llmWarmPool, {
  maxParallelism: 16,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 8, initialBackoffMs: 10_000, base: 3 },
});

/**
 * TTS synthesis pool, shared by all providers (google / gemini).
 * Throughput is rate-limiter-bound, not parallelism-bound, so a single pool
 * suffices; a throttled provider can't starve the others because workers
 * THROW (freeing the slot) instead of sleeping when the projected token wait
 * is long. Retry budget ≈ 80s (2s·3^n), wide enough to ride out provider
 * 429 bursts, the failure mode that used to permanently drop audio.
 */
export const ttsPool = new Workpool(components.ttsPool, {
  maxParallelism: 24,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2_000, base: 3 },
});

/**
 * Background TTS pool for warm/prefetch synthesis (priority 'background').
 * Low parallelism so warm bursts can't crowd interactive jobs out of the
 * provider rate budgets; warm workers additionally reserve tokens with a
 * near-zero wait cap (`TTS_WARM_TOKEN_MAX_WAIT_MS`), so they only consume
 * capacity interactive jobs aren't using and throw otherwise. That makes
 * throws routine here, hence the patient retry curve: 8 attempts at
 * 10s·3^n ≈ 3h of jittered backoff, wide enough to ride out minutes-long
 * interactive bursts (an onboarding signup) instead of exhausting retries
 * and dropping the job.
 */
export const ttsWarmPool = new Workpool(components.ttsWarmPool, {
  maxParallelism: 6,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 8, initialBackoffMs: 10_000, base: 3 },
});

/**
 * Background data-sweep pool: the separateModeTracking writing-track seed
 * (convex/migrations/seedWritingTrack.ts) and the one-off study-day due-date
 * snap (convex/migrations/snapDueDatesToStudyDay.ts).
 *
 * Deliberately NO retry config: the pool does not retry mutations (Convex
 * already retries them on OCC and transient failures, and they're
 * deterministic so external retries buy nothing). What this pool is here for
 * is the GUARANTEED onComplete callback. It runs in its own transaction, so
 * it still fires when the batch mutation throws. That is what turns a
 * self-scheduling chain, which dies silently the moment one hop fails, into
 * one that is supervised: the handler decides whether to re-enqueue or give up
 * and report.
 *
 * Low parallelism on purpose. Bulk backfill must never queue ahead of the
 * user-facing llmPool/ttsPool work, and the seed is sequential per course
 * anyway (each batch enqueues its own successor).
 */
export const seedPool = new Workpool(components.seedPool, {
  maxParallelism: 4,
});

/**
 * The `result` an onComplete handler receives from any pool. Spelled out
 * here because the pool consumers type their handler params explicitly: a
 * handler that references same-file functions through `internal.…` cannot
 * have its types inferred through the generated `internal` object without a
 * circularity, which collapses every handler in the module to `any`.
 */
export type PoolRunResult =
  | { kind: 'success'; returnValue: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' };
