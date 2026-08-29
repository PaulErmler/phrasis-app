import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { assertTestHooksEnabled, requireUserIdByEmail } from '../lib/testHooks';
import { featureStateValidator } from '../types';

/**
 * E2E test hooks for quota-exhaustion states (e2e/quota-exhaustion.spec.ts).
 * Every function throws unless the deployment has `E2E_TEST_HOOKS=1` set.
 *
 * `zeroFeatureBalances` patches the LOCAL `usageQuotas.features` mirror
 * only — Autumn is never touched, so there is nothing to undo remotely and
 * no risk of mutating hosted billing state. Both the reactive UI
 * (useFeatureQuota) and server-side `consumeQuota` read this mirror, so a
 * zeroed balance genuinely blocks the gated flows. The patch survives until
 * the next Autumn sync (app reload / BillingGate remount) overwrites it
 * with the real balance — specs must run their assertions without a reload
 * in between, and restore via `restoreFeatureBalances` when done.
 *
 * Missing entries are seeded as spent-not-absent ({balance: 0, included:
 * 1, used: 1}): the ai_feedback self-heal treats a MISSING entry as an
 * unprovisioned legacy account and would create a real Autumn grant — a
 * present-but-spent entry routes to the paywall instead.
 */

const previousStateValidator = v.record(
  v.string(),
  v.union(featureStateValidator, v.null()),
);

export const zeroFeatureBalances = internalMutation({
  args: { email: v.string(), featureIds: v.array(v.string()) },
  /** Previous entries keyed by feature id (null = entry did not exist). */
  returns: previousStateValidator,
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);
    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (!doc) throw new Error(`No usageQuotas doc for "${args.email}"`);

    const previous: Record<
      string,
      { balance: number; included: number; used: number } | null
    > = {};
    const features = { ...doc.features };
    for (const featureId of args.featureIds) {
      previous[featureId] = features[featureId] ?? null;
      const existing = features[featureId];
      features[featureId] = existing
        ? { ...existing, balance: 0, unlimited: false }
        : { balance: 0, included: 1, used: 1 };
    }
    await ctx.db.patch(doc._id, { features });
    return previous;
  },
});

/** Put back what `zeroFeatureBalances` returned (null deletes the entry). */
export const restoreFeatureBalances = internalMutation({
  args: { email: v.string(), previous: previousStateValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);
    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (!doc) throw new Error(`No usageQuotas doc for "${args.email}"`);
    const features = { ...doc.features };
    for (const [featureId, state] of Object.entries(args.previous)) {
      if (state === null) delete features[featureId];
      else features[featureId] = state;
    }
    await ctx.db.patch(doc._id, { features });
    return null;
  },
});

export const readFeatureBalance = internalQuery({
  args: { email: v.string(), featureId: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);
    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    return doc?.features[args.featureId]?.balance ?? null;
  },
});
