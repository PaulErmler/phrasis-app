import { v, ConvexError } from 'convex/values';
import { MutationCtx, QueryCtx, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc } from '../_generated/dataModel';
import { CREDIT_COSTS, FEATURE_IDS, type FeatureId } from '../features/featureIds';
import { getActiveCourses } from '../db/courses';
import { getUserSettings } from '../db/users';
import { featureStateValidator, type FeatureState } from '../types';
import { EVENTS, identifyUser, track } from '../analytics';
import { sendAdminNotificationEmail } from '../lib/adminEmails';
import { FREE_PLAN_ID } from '../../lib/autumn/customer-shape';

/**
 * Thrown by `assertBillingCurrent` while a payment is past due. Same
 * `error.data.code` contract as USAGE_LIMIT / QUOTA_NOT_SYNCED below.
 */
export const PAYMENT_PAST_DUE = 'PAYMENT_PAST_DUE';

// Definitions live in convex/types.ts (so schema.ts can share them without
// importing this module); re-exported here for the existing importers.
export { featureStateValidator, type FeatureState };

async function getQuotaDoc(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<'usageQuotas'> | null> {
  return ctx.db
    .query('usageQuotas')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
}

/**
 * Resolve which local balance a feature consumption applies to.
 *
 * Credit-consuming features (see CREDIT_COSTS) draw from the shared
 * `credits` balance when the user's plan grants one — the amount is
 * converted via the feature's credit cost. Users on legacy (pre-credits)
 * plan versions have per-feature balances instead, so we fall back to the
 * feature's own entry when no `credits` balance exists.
 *
 * Note: Autumn tracking always receives the UNDERLYING feature id — only
 * the local mirror is credit-aware. If a user somehow holds both a direct
 * feature balance and credits, Autumn consumes the direct balance first;
 * the post-track sync re-converges the local cache in that case.
 */
function resolveQuotaTarget(
  doc: Doc<'usageQuotas'>,
  featureId: string,
  amount: number,
): { targetFeatureId: string; targetAmount: number } {
  const creditCost = CREDIT_COSTS[featureId as FeatureId];
  if (creditCost !== undefined && doc.features[FEATURE_IDS.CREDITS]) {
    return {
      targetFeatureId: FEATURE_IDS.CREDITS,
      targetAmount: amount * creditCost,
    };
  }
  return { targetFeatureId: featureId, targetAmount: amount };
}

/** `checkQuota` against an already-loaded doc — no further reads. */
function checkQuotaForDoc(
  doc: Doc<'usageQuotas'> | null,
  featureId: string,
  amount: number,
): { allowed: boolean; balance: number; synced: boolean } {
  if (!doc) {
    return { allowed: false, balance: 0, synced: false };
  }
  const { targetFeatureId, targetAmount } = resolveQuotaTarget(
    doc,
    featureId,
    amount,
  );
  const feature = doc.features[targetFeatureId];
  if (!feature) {
    return { allowed: false, balance: 0, synced: true };
  }
  if (feature.unlimited) {
    return { allowed: true, balance: feature.balance, synced: true };
  }
  return {
    allowed: feature.balance >= targetAmount,
    balance: feature.balance,
    synced: true,
  };
}

/**
 * Check whether the user has enough quota for the given feature.
 * Returns { allowed, balance } without modifying anything.
 * If no quota doc or feature entry exists, returns allowed=false.
 */
export async function checkQuota(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<{ allowed: boolean; balance: number; synced: boolean }> {
  return checkQuotaForDoc(await getQuotaDoc(ctx, userId), featureId, amount);
}

/**
 * Hard gate for anything that spends money. Throws while Autumn reports the
 * user's plan as past due — there is no grace window.
 *
 * Autumn keeps granting entitlements during the (multi-week) Stripe retry
 * period, so the local balances alone would happily let a delinquent user
 * keep generating billable work. Checked BEFORE the balance check in
 * `consumeQuota` so the client gets PAYMENT_PAST_DUE (→ the overdue dialog)
 * rather than a confusing USAGE_LIMIT upgrade paywall if entitlements have
 * also been revoked.
 *
 * Deliberately not applied to `releaseQuota`/`incrementQuota` (they refund
 * the user), to `chargeExtraChatCredits` (the work is already done), or to
 * quota-free actions like card review.
 *
 * Takes the already-loaded doc rather than a ctx: the one caller has it in
 * hand, and a ctx-loading wrapper would silently double the reads.
 */
export function assertBillingCurrent(
  doc: Doc<'usageQuotas'> | null,
  featureId?: string,
): void {
  // `pastDueSince` is the single source of truth: syncAllFeatures sets and
  // clears it from Autumn's `anyPastDue` on every sync, whereas `planStatus`
  // is informational and can go stale when the plan identity is unknown.
  if (doc?.pastDueSince === undefined) return;
  throw new ConvexError({
    code: PAYMENT_PAST_DUE,
    message: 'Access is paused until the outstanding payment is completed.',
    ...(featureId ? { featureId } : {}),
  });
}

/**
 * Check whether a boolean feature is available for the user.
 * Mirrors the frontend `useFeatureQuota.isAvailable` logic.
 * `synced: false` means no quota doc yet — same notion as `checkQuota`.
 */
export async function hasFeatureAccess(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  featureId: string,
): Promise<{ available: boolean; synced: boolean }> {
  const doc = await getQuotaDoc(ctx, userId);
  if (!doc) {
    return { available: false, synced: false };
  }
  const feature = doc.features[featureId];
  if (!feature) {
    return { available: false, synced: true };
  }
  if (feature.unlimited === true) {
    return { available: true, synced: true };
  }
  return { available: feature.balance > 0, synced: true };
}

/**
 * Decrement the local quota for a feature.
 * Does NOT check — caller must check first or use `consumeQuota`.
 */
async function decrementQuota(
  ctx: MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<number> {
  return decrementQuotaForDoc(
    ctx,
    await getQuotaDoc(ctx, userId),
    featureId,
    amount,
  );
}

/** `decrementQuota` against an already-loaded doc — no further reads. */
async function decrementQuotaForDoc(
  ctx: MutationCtx,
  doc: Doc<'usageQuotas'> | null,
  featureId: string,
  amount: number,
): Promise<number> {
  if (!doc) {
    throw new ConvexError(`No quota doc for user. Sync quotas first.`);
  }
  const { targetFeatureId, targetAmount } = resolveQuotaTarget(
    doc,
    featureId,
    amount,
  );
  const feature = doc.features[targetFeatureId];
  if (!feature) {
    throw new ConvexError(`No quota entry for feature "${targetFeatureId}". Sync quotas first.`);
  }
  const newBalance = feature.balance - targetAmount;
  const newUsed = feature.used + targetAmount;
  const updatedFeatures = {
    ...doc.features,
    [targetFeatureId]: { ...feature, balance: newBalance, used: newUsed },
  };
  await ctx.db.patch(doc._id, { features: updatedFeatures });
  return newBalance;
}

/**
 * Increment the local quota for a feature.
 * Used for release semantics (e.g. archiving a course frees a slot).
 */
async function incrementQuota(
  ctx: MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<number> {
  const doc = await getQuotaDoc(ctx, userId);
  if (!doc) {
    throw new ConvexError(`No quota doc for user. Sync quotas first.`);
  }
  const { targetFeatureId, targetAmount } = resolveQuotaTarget(
    doc,
    featureId,
    amount,
  );
  const feature = doc.features[targetFeatureId];
  if (!feature) {
    throw new ConvexError(`No quota entry for feature "${targetFeatureId}". Sync quotas first.`);
  }
  const newBalance = feature.balance + targetAmount;
  const newUsed = Math.max(feature.used - targetAmount, 0);
  const updatedFeatures = {
    ...doc.features,
    [targetFeatureId]: { ...feature, balance: newBalance, used: newUsed },
  };
  await ctx.db.patch(doc._id, { features: updatedFeatures });
  return newBalance;
}

/**
 * Combined check + decrement. Throws ConvexError if not allowed.
 * Schedules trackUsage action automatically.
 */
export async function consumeQuota(
  ctx: MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<{ balance: number }> {
  // Single read, shared by the billing gate, the balance check and the
  // decrement below.
  const doc = await getQuotaDoc(ctx, userId);

  assertBillingCurrent(doc, featureId);

  const { allowed, balance, synced } = checkQuotaForDoc(doc, featureId, amount);

  if (!synced) {
    throw new ConvexError({
      code: 'QUOTA_NOT_SYNCED',
      message: `Quotas not yet synced. Please wait and try again.`,
      featureId,
    });
  }

  if (!allowed) {
    throw new ConvexError({
      code: 'USAGE_LIMIT',
      message: `Usage limit reached for "${featureId}".`,
      featureId,
      balance,
    });
  }

  const newBalance = await decrementQuotaForDoc(ctx, doc, featureId, amount);

  await ctx.scheduler.runAfter(0, internal.usage.tracking.trackUsage, {
    userId,
    featureId,
    value: amount,
  });

  return { balance: newBalance };
}

/**
 * Optimistically release quota locally and reconcile with Autumn asynchronously.
 * Mirrors `consumeQuota` but tracks a negative usage value.
 */
export async function releaseQuota(
  ctx: MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<{ balance: number }> {
  const newBalance = await incrementQuota(ctx, userId, featureId, amount);

  await ctx.scheduler.runAfter(0, internal.usage.tracking.trackUsage, {
    userId,
    featureId,
    value: -amount,
  });

  return { balance: newBalance };
}

/**
 * Charge the post-generation remainder of a chat message's dynamic credit
 * cost (1 chat_messages unit is consumed up-front in `sendMessage`; this adds
 * the extra units `generateResponse` derived from the actual LLM cost).
 * `extraMessageUnits` is denominated in chat_messages UNITS — decrementQuota
 * (via resolveQuotaTarget) and Autumn's credit schema each convert it into
 * credits exactly once, so a credit-denominated amount here would be
 * double-multiplied by CREDIT_COSTS[CHAT_MESSAGES]. Applied without a balance
 * check — the work is already done, so the balance may go negative and block
 * the next message instead.
 *
 * No-op for users on legacy plan versions (no `credits` balance): their
 * chat costs a flat 1 chat_messages unit per message.
 */
export const chargeExtraChatCredits = internalMutation({
  args: {
    userId: v.string(),
    extraMessageUnits: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.extraMessageUnits <= 0) return null;
    const doc = await getQuotaDoc(ctx, args.userId);
    if (!doc || !doc.features[FEATURE_IDS.CREDITS]) return null;

    await decrementQuota(
      ctx,
      args.userId,
      FEATURE_IDS.CHAT_MESSAGES,
      args.extraMessageUnits,
    );

    await ctx.scheduler.runAfter(0, internal.usage.tracking.trackUsage, {
      userId: args.userId,
      featureId: FEATURE_IDS.CHAT_MESSAGES,
      value: args.extraMessageUnits,
    });

    return null;
  },
});

/**
 * Overwrite all features in the user's quota doc at once.
 * Called during full sync from Autumn's GET /customers response.
 * Auto-archives excess active courses when plan limits are exceeded.
 */
export const syncAllFeatures = internalMutation({
  args: {
    userId: v.string(),
    features: v.record(v.string(), featureStateValidator),
    // Current Autumn plan, when derivable from the customer response.
    // Omitted → existing plan fields on the doc are left untouched.
    planId: v.optional(v.string()),
    planName: v.optional(v.string()),
    planStatus: v.optional(v.string()),
    // Whether ANY current plan is delinquent — see derivePlan. This, not
    // planStatus, drives the payment block.
    anyPastDue: v.boolean(),
    // Autumn returned no plans at all, so we don't know the billing state:
    // leave every plan field (including pastDueSince) untouched.
    productsMissing: v.boolean(),
    // Hosted page for the outstanding invoice, when past due.
    pastDueInvoiceUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await getQuotaDoc(ctx, args.userId);
    const now = Date.now();

    const newIncluded = args.features[FEATURE_IDS.COURSES]?.included;

    // E2E-only: a billingTestOverrides row forces the effective plan status
    // (dev/test deployments with E2E_TEST_HOOKS=1 only). Applied here — the
    // single funnel for both sync paths — so app reloads re-apply the
    // override on top of real Autumn data instead of clearing it. It must
    // also drive `anyPastDue`, since that is what the block keys on.
    let effectiveStatus = args.planStatus;
    let pastDue = args.anyPastDue;
    if (process.env.E2E_TEST_HOOKS === '1') {
      const override = await ctx.db
        .query('billingTestOverrides')
        .withIndex('by_userId', (q) => q.eq('userId', args.userId))
        .first();
      if (override) {
        effectiveStatus = override.planStatus;
        pastDue = override.planStatus === 'past_due';
      }
    }

    // First-seen timestamp for the overdue state: set on the transition into
    // past_due, kept while it lasts, cleared on recovery (undefined in a
    // patch removes the field). Tracked independently of the plan identity
    // fields, so a customer whose plans all expire still recovers rather
    // than staying blocked on a stale status.
    const billingFields = args.productsMissing
      ? {}
      : {
        ...(args.planId !== undefined
          ? {
            planId: args.planId,
            planName: args.planName,
            planStatus: effectiveStatus,
          }
          : {}),
        pastDueSince: pastDue ? (doc?.pastDueSince ?? now) : undefined,
        // Keep the last known URL while still past due — a later sync that
        // didn't expand invoices shouldn't blank the pay button.
        pastDueInvoiceUrl: pastDue
          ? (args.pastDueInvoiceUrl ?? doc?.pastDueInvoiceUrl)
          : undefined,
      };

    if (doc) {
      await ctx.db.patch(doc._id, {
        features: args.features,
        lastSyncedAt: now,
        ...billingFields,
      });
    } else {
      await ctx.db.insert('usageQuotas', {
        userId: args.userId,
        features: args.features,
        lastSyncedAt: now,
        ...billingFields,
      });
    }

    // Never auto-archive while the payment is past due. Autumn can revoke
    // entitlements during dunning (an org-level option), which would shrink
    // `included` and silently archive the user's courses — and paying the
    // invoice would not bring them back. Wait until billing is healthy.
    //
    // Keyed on the state that is actually persisted, not on `pastDue`: a
    // `productsMissing` reply leaves `pastDueSince` in place (the user stays
    // blocked) while carrying `anyPastDue: false`, so trusting the incoming
    // flag alone would archive courses in exactly the window this guard
    // exists to protect.
    const stillPastDue = args.productsMissing
      ? doc?.pastDueSince !== undefined
      : pastDue;

    if (newIncluded !== undefined && !stillPastDue) {
      const activeCourses = await getActiveCourses(ctx, args.userId);
      const overLimit = activeCourses.length > newIncluded;
      if (overLimit) {
        const settings = await getUserSettings(ctx, args.userId);
        const protectedId = settings?.activeCourseId;

        // Archive courses that aren't the user's current active course
        let toArchive = activeCourses.filter((c) => c._id !== protectedId);
        // Only archive what's needed to reach the new plan limit (keep at least 1)
        const excess = activeCourses.length - Math.max(newIncluded, 1);
        toArchive = toArchive.slice(0, excess);

        // NOTE: We intentionally do NOT call releaseQuota() here.
        // The features record was just overwritten with Autumn's authoritative
        // state, so the balance already reflects the new plan limits.
        for (const course of toArchive) {
          await ctx.db.patch(course._id, {
            isArchived: true,
            archivedAt: now,
          });
        }
      }
    }

    /**
     * Plan attributes on the PostHog person. This is the single funnel every
     * piece of Autumn state passes through, so it is the one place that can
     * keep them fresh — and it lets every other event be segmented by plan
     * without the client ever learning the plan id (`getMyQuotas` deliberately
     * withholds it).
     *
     * Fired only on change: this funnel runs on every app open (BillingGate →
     * syncQuotas), and re-identifying an unchanged plan each time is pure
     * event noise. Credit balances are deliberately not person properties — a
     * balance is a point-in-time fact that belongs on events, and its churn
     * would defeat this change gate.
     *
     * `plan_changed` is the missing bookend of the checkout funnel: the
     * client's `checkout_redirected` is the last observable step before
     * Stripe, and this is the first observable step after — activation,
     * cancellation, trial conversion and dunning all land here. Mirrors the
     * persistence rules above: `productsMissing` or an unknown plan keep the
     * stored identity, so a sync that learned nothing reports nothing.
     */
    const planPersisted = !args.productsMissing && args.planId !== undefined;
    const previous = {
      plan_id: doc?.planId,
      plan_name: doc?.planName,
      plan_status: doc?.planStatus,
      past_due: doc?.pastDueSince !== undefined,
      courses_included: doc?.features[FEATURE_IDS.COURSES]?.included,
    };
    const next = {
      plan_id: planPersisted ? args.planId : previous.plan_id,
      plan_name: planPersisted ? args.planName : previous.plan_name,
      plan_status: planPersisted ? effectiveStatus : previous.plan_status,
      past_due: stillPastDue,
      courses_included: newIncluded,
    };

    const planIdentityChanged =
      next.plan_id !== previous.plan_id ||
      next.plan_status !== previous.plan_status ||
      next.past_due !== previous.past_due;
    const anyPersonPropChanged =
      planIdentityChanged ||
      next.plan_name !== previous.plan_name ||
      next.courses_included !== previous.courses_included;

    if (anyPersonPropChanged) {
      await identifyUser(ctx, args.userId, next);
    }
    if (planIdentityChanged) {
      // First-ever sync reports { from_plan_id: undefined } — that is the
      // free-plan attach at signup, the top of the monetization funnel.
      await track(ctx, args.userId, EVENTS.PLAN_CHANGED, {
        from_plan_id: previous.plan_id,
        to_plan_id: next.plan_id,
        from_status: previous.plan_status,
        to_status: next.plan_status,
        past_due: stillPastDue,
      });
      // Notify the support inbox about real subscription events. The
      // first-ever sync is the automatic free-plan attach at signup —
      // already covered by the signup notification, so skip it.
      if (previous.plan_id !== undefined) {
        const profile = await ctx.db
          .query('userProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', args.userId))
          .first();
        const who = profile
          ? `${profile.name || '(no name)'} <${profile.email}>`
          : args.userId;
        await sendAdminNotificationEmail(ctx, {
          subject: `${describePlanChange(previous, next)}: ${profile?.email ?? args.userId}`,
          lines: [
            `User: ${who}`,
            `Plan: ${planLabel(previous)} → ${planLabel(next)}`,
          ],
        });
      }
    }

    return null;
  },
});

type PlanIdentity = {
  plan_id?: string;
  plan_name?: string;
  plan_status?: string;
};


function planLabel(p: PlanIdentity): string {
  if (p.plan_id === undefined) return 'none';
  return `${p.plan_name ?? p.plan_id} (${p.plan_status ?? 'unknown'})`;
}

/**
 * Human subject line for the admin notification about a plan identity
 * change. Exported for tests.
 */
export function describePlanChange(
  previous: PlanIdentity,
  next: PlanIdentity,
): string {
  const fromPaid =
    previous.plan_id !== undefined && previous.plan_id !== FREE_PLAN_ID;
  const toPaid = next.plan_id !== undefined && next.plan_id !== FREE_PLAN_ID;
  if (!fromPaid && toPaid) {
    return next.plan_status === 'trialing' ? 'Trial started' : 'New subscription';
  }
  if (fromPaid && !toPaid) return 'Subscription cancelled';
  if (fromPaid && toPaid && previous.plan_id !== next.plan_id) {
    return 'Plan changed';
  }
  // Same plan, status flip: trial conversion, past_due, recovery, ...
  return 'Plan status changed';
}

