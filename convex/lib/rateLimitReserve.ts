import type { ActionCtx } from '../_generated/server';
import { rateLimiter } from '../rateLimiter';

/** Names of the token buckets configured on the shared rate limiter. */
export type RateLimitName =
  | 'googleTts'
  | 'geminiTts'
  | 'minimaxTts'
  | 'azureStt';

/**
 * Reserve one token from `name`'s bucket before a provider HTTP call, waiting
 * out short refill delays and fast-failing long ones.
 *
 * - Projected wait ≤ `maxWaitMs` → consume a reservation and sleep it out
 *   (smooth pacing; with pool-bounded concurrency the wait stays small).
 * - Projected wait > `maxWaitMs` → THROW without consuming, so a workpool
 *   worker frees its parallelism slot and the pool's jittered backoff retries
 *   later — a throttled provider must not pin slots other providers could use.
 *
 * Fast-fail uses `check` (non-consuming) before `limit` (consuming) so a
 * rejected call doesn't burn a reservation it walks away from. The small
 * check→limit race can overshoot by one reservation, which is fine.
 */
export async function reserveRateLimitToken(
  ctx: ActionCtx,
  name: RateLimitName,
  opts: { maxWaitMs?: number } = {},
): Promise<void> {
  if (opts.maxWaitMs != null) {
    const peek = await rateLimiter.check(ctx, name, { reserve: true });
    const projectedWait = peek.retryAfter;
    if (!peek.ok || (projectedWait != null && projectedWait > opts.maxWaitMs)) {
      const retryHint =
        projectedWait != null
          ? `try again in ${Math.ceil(projectedWait / 1000)}s`
          : 'try again shortly';
      throw new Error(`Rate limit ${name} busy — ${retryHint}`);
    }
  }

  const result = await rateLimiter.limit(ctx, name, { reserve: true });
  if (!result.ok) {
    // Only reachable if `maxReserved` is ever configured on the bucket.
    throw new Error(`Rate limit ${name} reservation pool full — try again later`);
  }
  const wait = result.retryAfter ?? 0;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
