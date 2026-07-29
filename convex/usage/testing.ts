import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { normalizePlans } from '../../lib/autumn/customer-shape';
import { AUTUMN_API } from './autumnClient';

/**
 * E2E test hooks for the payment-overdue (dunning) flow. Every function
 * here throws unless the deployment has `E2E_TEST_HOOKS=1` set — enable it
 * ONLY on dev/test deployments (`npx convex env set E2E_TEST_HOOKS 1`),
 * never in production.
 *
 * Invoked from Playwright specs via
 * `npx convex run usage/testing:<fn> '<json>'` (see e2e/payment-overdue.spec.ts).
 *
 * Why an override instead of a real failed payment: a genuine `past_due`
 * only arises from a failed RENEWAL invoice, and Stripe test clocks can't
 * be attached to Autumn-created customers. The obvious shortcut — attach
 * with `free_trial: false` while test card 4000-0000-0000-0341 (attaches
 * fine, charges fail) is on file — was tried and does NOT work (verified
 * July 2026): the failed charge leaves an `open` (then voided) invoice and
 * an EMPTY products list, never `past_due`. So the e2e forces the synced
 * planStatus via `billingTestOverrides`, which syncAllFeatures re-applies
 * on every sync while E2E_TEST_HOOKS=1; everything downstream (quota doc,
 * reactive query, dialog, billing-portal call) is real.
 */

function assertTestHooksEnabled(): void {
  if (process.env.E2E_TEST_HOOKS !== '1') {
    throw new Error(
      'E2E test hooks are disabled (set E2E_TEST_HOOKS=1 on a dev deployment)',
    );
  }
}

async function requireUserIdByEmail(
  ctx: { db: QueryCtx['db'] },
  rawEmail: string,
): Promise<string> {
  const email = rawEmail.trim().toLowerCase();
  const profile = await ctx.db
    .query('userProfiles')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first();
  if (!profile) throw new Error(`No userProfiles row for "${email}"`);
  return profile.userId;
}

/** Resolve a user's id from their email via the userProfiles mirror. */
export const resolveUserId = internalQuery({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    return requireUserIdByEmail(ctx, args.email);
  },
});

/**
 * Force the synced plan status for a user (e.g. 'past_due'). Writes the
 * override row (so every later sync re-applies it) AND patches the quota
 * doc immediately (so the reactive query flips without waiting for one).
 *
 * Refuses to force `past_due` on a customer without a paid plan: the free
 * plan is auto-attached and has no payment that can fail, so that state
 * cannot occur in production and any test built on it would be asserting
 * against fiction. Use the Stripe test-clock provisioning flow for a
 * genuine past_due (real failed renewal + real open invoice).
 */
export const setBillingOverride = internalMutation({
  args: { email: v.string(), planStatus: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);

    if (args.planStatus === 'past_due') {
      const quota = await ctx.db
        .query('usageQuotas')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .first();
      if (!quota?.planId || quota.planId === 'free') {
        throw new Error(
          `Cannot force past_due for "${args.email}": the customer has no paid ` +
            `plan (planId=${quota?.planId ?? 'none'}). Free plans have no ` +
            `payment to fail. Subscribe first, or use the test-clock flow.`,
        );
      }
    }

    const existing = await ctx.db
      .query('billingTestOverrides')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { planStatus: args.planStatus });
    } else {
      await ctx.db.insert('billingTestOverrides', {
        userId,
        planStatus: args.planStatus,
      });
    }

    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (!doc) throw new Error(`No usageQuotas doc for "${args.email}"`);
    await ctx.db.patch(doc._id, {
      planStatus: args.planStatus,
      pastDueSince:
        args.planStatus === 'past_due'
          ? (doc.pastDueSince ?? Date.now())
          : undefined,
    });
    return null;
  },
});

/**
 * Remove the override and restore a healthy local state; the next real
 * sync re-derives the truth from Autumn.
 */
export const clearBillingOverride = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);

    const existing = await ctx.db
      .query('billingTestOverrides')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (existing) await ctx.db.delete(existing._id);

    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (doc) {
      await ctx.db.patch(doc._id, {
        planStatus: 'active',
        pastDueSince: undefined,
      });
    }
    return null;
  },
});

/**
 * Snapshot of the customer's Autumn products (status + past_due) —
 * debugging aid for billing specs.
 */
export const getBillingDebugState = internalAction({
  args: { email: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      status: v.string(),
      pastDue: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const key = process.env.AUTUMN_SECRET_KEY;
    if (!key) throw new Error('AUTUMN_SECRET_KEY is not set');
    const userId: string = await ctx.runQuery(
      internal.usage.testing.resolveUserId,
      { email: args.email },
    );
    const res = await fetch(
      `${AUTUMN_API}/customers/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'x-api-version': '1.2',
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Autumn customer fetch failed (${res.status})`);
    }
    // Normalized rather than read raw: this endpoint is pinned to 1.2, which
    // reports delinquency as `status: 'past_due'` and ships no `past_due`
    // field at all — so reading the boolean directly (as this did) reported
    // `pastDue: false` for genuinely past-due customers.
    const customer = (await res.json()) as { products?: unknown };
    return normalizePlans(customer).map((p) => ({
      id: p.planId,
      status: p.rawStatus,
      pastDue: p.isPastDue,
    }));
  },
});
