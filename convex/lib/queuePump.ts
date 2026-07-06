import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

/**
 * LEGACY (phase-2 removal): the pre-workpool queues relayed pump requests
 * through this mutation on every enqueue/finalize. The workpools own their
 * scheduling now, so it is a no-op — kept only so 0ms relays scheduled just
 * before the migration deploy still resolve instead of erroring. Delete
 * (together with the `queuePumpStates` table) in the cleanup deploy.
 */
export const requestPump = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async () => null,
});
