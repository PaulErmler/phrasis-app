import { SchedulableFunctionReference } from 'convex/server';
import { MutationCtx } from '../_generated/server';

// How long past a pump's expected run time (`pumpScheduledFor`) callers keep
// trusting a set flag. Beyond this the scheduled pump is assumed dead (a
// deploy removed the invocation, or the pump threw — the rollback restores
// the flag but the scheduled run is consumed) and callers schedule anyway.
// This restores the pre-flag guarantee that the next enqueue/finalize always
// revives the queue; without it a wedged flag would stall the queue forever.
const PUMP_WEDGE_MS = 30_000;

/**
 * Schedule a queue pump unless one is already pending for `key`.
 *
 * Every enqueue and finalize used to schedule its own pump; the concurrent
 * pumps' overlapping slot-table scans OCC-retried against each other by the
 * hundreds. This dedup collapses that to at most one scheduled pump per key:
 * callers that see a live flag are pure reads of one small doc.
 *
 * Runs inside the caller's transaction. The pump itself must call
 * `clearPumpScheduled` as its first statement — clear-at-start means any
 * enqueue serialized before the clear is visible to the pump's dequeue, and
 * any enqueue serialized after sees the flag down and schedules a fresh pump,
 * so no wakeup is ever lost.
 */
export async function schedulePumpIfNeeded(
  ctx: MutationCtx,
  key: string,
  fn: SchedulableFunctionReference,
  fnArgs: Record<string, unknown>,
  delayMs = 0,
): Promise<void> {
  const state = await ctx.db
    .query('queuePumpStates')
    .withIndex('by_key', (q) => q.eq('key', key))
    .first();
  const now = Date.now();
  const runsAt = now + delayMs;
  if (!state) {
    // Two first-use racers both inserting is safe: their index-range reads
    // overlap, so OCC serializes them and the loser retries into the patch
    // branch — same check-and-insert pattern as the claims tables.
    await ctx.db.insert('queuePumpStates', {
      key,
      pumpScheduled: true,
      pumpScheduledFor: runsAt,
    });
    await ctx.scheduler.runAfter(delayMs, fn, fnArgs);
    return;
  }
  if (state.pumpScheduled && now <= state.pumpScheduledFor + PUMP_WEDGE_MS) {
    return;
  }
  await ctx.db.patch(state._id, {
    pumpScheduled: true,
    pumpScheduledFor: runsAt,
  });
  await ctx.scheduler.runAfter(delayMs, fn, fnArgs);
}

/**
 * Mark `key`'s pending pump as started. Must be the FIRST statement of every
 * pump handler (see `schedulePumpIfNeeded` for why clear-at-start is what
 * makes the dedup lossless). No-op when the state doc doesn't exist yet
 * (pumps scheduled before the flag was introduced).
 */
export async function clearPumpScheduled(
  ctx: MutationCtx,
  key: string,
): Promise<void> {
  const state = await ctx.db
    .query('queuePumpStates')
    .withIndex('by_key', (q) => q.eq('key', key))
    .first();
  if (state?.pumpScheduled) {
    await ctx.db.patch(state._id, { pumpScheduled: false });
  }
}
