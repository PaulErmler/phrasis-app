'use node';

import { v } from 'convex/values';
import { internalAction, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { type FeatureState } from './helpers';
import { FEATURE_IDS } from '../features/featureIds';
import { EVENTS, track } from '../analytics';
import {
  currentPlans,
  FREE_PLAN_ID,
  normalizePlans,
  type AutumnPlan,
} from '../../lib/autumn/customer-shape';
import { AUTUMN_API, getSecretKey } from './autumnClient';

/**
 * Pinned, because the customer payload's SHAPE is version-dependent and the
 * two families disagree about where delinquency lives (verified 2026-07-26
 * against one genuinely past-due customer):
 *
 *   v1.x (1.0/1.1/1.2/1.4) → `products[]`      status: 'past_due', no `past_due` field
 *   v2.x (2.0/2.1/2.2)     → `subscriptions[]` status: 'active',   past_due: true
 *
 * So a check against either field alone is correct under exactly one family
 * and blind under the other. This file wants the v2 shape (`subscriptions` +
 * `purchases`); convex/billing.ts deliberately pins 1.2 for its own trial
 * logic. Sending no header at all rode Autumn's moving default, which would
 * eventually have swapped the shape under us and silently disabled the
 * payment block. `balances` and `flags` are identical across 2.1/2.2 and the
 * old default, so pinning changes nothing else.
 *
 * If Autumn retires this version the request 400s loudly (1.3 already does)
 * rather than degrading quietly, and `normalizePlans` still falls back to
 * the v1 `products` shape if one ever arrives.
 */
const AUTUMN_API_VERSION = '2.2';

/** Fields returned per balance entry by `GET /customers/:id`. */
export type AutumnBalanceEntry = {
  feature_id: string;
  granted: number;
  remaining: number;
  usage: number;
  unlimited: boolean;
};

/**
 * Only the parts of the payload this file reads. Plan entries are left as
 * `unknown` on purpose. lib/autumn/customer-shape.ts owns those field
 * names, for either API family.
 */
type AutumnCustomerResponse = {
  balances?: Record<string, AutumnBalanceEntry>;
  /** Boolean features. Only the KEYS are read; the values carry no data we use. */
  flags?: Record<string, unknown>;
  subscriptions?: unknown;
  purchases?: unknown;
  products?: unknown;
  /** Only present when the request asked for `?expand=invoices`. */
  invoices?: AutumnInvoiceEntry[];
};

/** Entry in the expanded `invoices` array. Statuses per Autumn's docs. */
export type AutumnInvoiceEntry = {
  status?: string; // draft | open | paid | void | uncollectible
  hosted_invoice_url?: string | null;
  created_at?: number;
};

/** The customer still owes money on this invoice (hosted page or not). */
function isUnpaidInvoice(i: AutumnInvoiceEntry): boolean {
  return i.status === 'open' || i.status === 'uncollectible';
}

/**
 * Whether any expanded invoice is still unpaid. Unlike
 * `findPayableInvoiceUrl` this deliberately ignores whether a hosted page
 * exists: for "has the debt been settled?" an unpaid invoice without a
 * hosted page still counts as unpaid. Stripe flips an invoice to `paid`
 * synchronously at payment time, which makes this the race-free signal for
 * the cancel-while-overdue guard. The subscription's own past_due status
 * clears only after the Stripe→Autumn webhook. Only meaningful when
 * `invoices` was actually expanded; callers must treat a missing array as
 * "unknown", not as "nothing unpaid".
 */
export function hasUnpaidInvoice(data: {
  invoices?: AutumnInvoiceEntry[];
}): boolean {
  return (data.invoices ?? []).some(isUnpaidInvoice);
}

/**
 * The Stripe-hosted page for the outstanding invoice, so the overdue dialog
 * can send the user somewhere that actually settles the debt. Newest unpaid
 * invoice wins; `draft` is excluded because it has no payable page yet.
 */
export function findPayableInvoiceUrl(
  data: AutumnCustomerResponse,
): string | undefined {
  const unpaid = (data.invoices ?? [])
    .filter(
      (i) =>
        isUnpaidInvoice(i) &&
        typeof i.hosted_invoice_url === 'string' &&
        i.hosted_invoice_url.length > 0,
    )
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return unpaid[0]?.hosted_invoice_url ?? undefined;
}

/** "pro_yearly" → "Pro Yearly". The v1 payload carries no display name. */
function humanizePlanId(planId: string): string {
  return planId
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export type DerivedBilling = {
  /** Undefined only when Autumn reported no usable (non-expired) plan. */
  plan?: { planId: string; planName: string; planStatus: string };
  /**
   * Any current plan is delinquent. This, not `plan.planStatus`. Is what
   * drives the payment block, so a co-existing healthy entry can never mask
   * a past-due one.
   */
  anyPastDue: boolean;
  /** Autumn returned no plans at all; leave the doc's plan fields untouched. */
  productsMissing: boolean;
};

/**
 * Derive the customer's billing state from subscriptions (+ one-time
 * purchases as fallback).
 *
 * Add-ons are excluded, as are `expired` and `scheduled` entries, neither
 * describes what the customer holds right now. The auto-attached default
 * free plan is always listed as active, so paid plans are ranked first,
 * otherwise a trialing paid customer would be recorded as 'free'. Within a
 * list, a past-due plan is picked first so `planStatus` (and the admin
 * dashboard) surface the delinquency rather than hiding it behind a
 * healthier sibling.
 */
export function derivePlan(data: AutumnCustomerResponse): DerivedBilling {
  const all = normalizePlans(data);
  if (all.length === 0) {
    return { plan: undefined, anyPastDue: false, productsMissing: true };
  }

  const current = currentPlans(all).filter((p) => !p.isAddOn);
  const anyPastDue = current.some((p) => p.isPastDue);

  const pick = (list: AutumnPlan[]) =>
    list.find((p) => p.isPastDue) ??
    list.find((p) => p.rawStatus === 'active') ??
    list.find((p) => p.isTrialing) ??
    list[0];
  const paid = current.filter((p) => p.planId !== FREE_PLAN_ID);
  const plan = pick(paid) ?? pick(current);

  if (!plan) {
    // Autumn answered, but everything it returned was expired / scheduled /
    // an add-on: the customer currently holds nothing. Report no plan (so
    // stale plan fields aren't overwritten with an expired one) but NOT
    // `productsMissing`. This is a definitive answer, so the past-due state
    // must still be allowed to clear. `productsMissing` is reserved for "the
    // response was empty", where we genuinely don't know.
    return { plan: undefined, anyPastDue, productsMissing: false };
  }

  return {
    plan: {
      planId: plan.planId,
      planName: humanizePlanId(plan.planId),
      // Normalized back to a single string for the mirror and the admin
      // dashboard: v2 reports a delinquent plan as 'active'.
      planStatus: plan.isPastDue ? 'past_due' : plan.rawStatus,
    },
    anyPastDue,
    productsMissing: false,
  };
}

/**
 * Track usage with Autumn and sync the tracked feature back to Convex.
 * Called from mutations via scheduler.runAfter.
 */
export const trackUsage = internalAction({
  args: {
    userId: v.string(),
    featureId: v.string(),
    value: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await trackAndSync(
      ctx,
      getSecretKey(),
      args.userId,
      args.featureId,
      args.value,
    );
    return null;
  },
});

/** `POST /track`, then pull the customer and refresh the local mirror. */
async function trackAndSync(
  ctx: Pick<ActionCtx, 'runMutation'>,
  secretKey: string,
  userId: string,
  featureId: string,
  value: number,
): Promise<void> {
  const trackRes = await fetch(`${AUTUMN_API}/track`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      'x-api-version': AUTUMN_API_VERSION,
    },
    body: JSON.stringify({
      customer_id: userId,
      feature_id: featureId,
      value,
    }),
  });

  if (!trackRes.ok) {
    const body = await trackRes.text();
    console.error(`Autumn track failed (${trackRes.status}): ${body}`);
    return;
  }

  const customerData = await fetchCustomerData(secretKey, userId);
  if (!customerData) return;

  await pushCustomerState(ctx, secretKey, userId, customerData);
}

/**
 * Bring Autumn's `courses` usage counter back down to the number of active
 * courses. Scheduled (with a settle delay) by `syncAllFeatures` when a sync
 * sees the counter above the active count, a state the old auto-archive
 * path left behind for every lapsed subscriber.
 *
 * Release-only, by design: the counter is only ever LOWERED. A counter below
 * the active count (a manual grant, a hand-lowered counter, an in-flight
 * consume) is left untouched, so this can never take a slot away from a
 * user. Everything is re-read fresh here rather than trusted from the
 * scheduling sync: that snapshot may predate a release that has since
 * landed, and acting on it would over-release.
 */
export const reconcileCourseUsage = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secretKey = getSecretKey();
    const customerData = await fetchCustomerData(secretKey, args.userId);
    if (!customerData) return null;

    // Same deferral as the auto-archive: a delinquent account may be
    // carrying revoked entitlements, not a state worth reconciling against.
    if (derivePlan(customerData).anyPastDue) return null;

    const entry = customerData.balances?.[FEATURE_IDS.COURSES];
    if (!entry || entry.unlimited) return null;

    const activeCount = await ctx.runQuery(
      internal.usage.helpers.countActiveCourses,
      { userId: args.userId },
    );
    const ghosts = entry.usage - activeCount;
    if (ghosts <= 0) return null;

    await trackAndSync(
      ctx,
      secretKey,
      args.userId,
      FEATURE_IDS.COURSES,
      -ghosts,
    );
    await track(ctx, args.userId, EVENTS.COURSE_SLOTS_RECONCILED, {
      released: ghosts,
      active: activeCount,
      autumn_usage_before: entry.usage,
    });
    return null;
  },
});

/**
 * Derive billing state from a customer payload and write it to the local
 * mirror. When the customer is past due, re-fetches with `?expand=invoices`
 * to capture the payable invoice URL. A second call, but only on the rare
 * delinquent path, so healthy syncs stay at one request.
 */
async function pushCustomerState(
  ctx: Pick<ActionCtx, 'runMutation'>,
  secretKey: string,
  userId: string,
  customerData: AutumnCustomerResponse,
): Promise<void> {
  const billing = derivePlan(customerData);

  let invoiceUrl: string | undefined;
  if (billing.anyPastDue) {
    const withInvoices =
      customerData.invoices !== undefined
        ? customerData
        : await fetchCustomerData(secretKey, userId, true);
    if (withInvoices) invoiceUrl = findPayableInvoiceUrl(withInvoices);
    if (!invoiceUrl) {
      // Loud, because the degradation is otherwise invisible: the overdue
      // dialog silently falls back to the billing-portal CTA, which only
      // swaps the card on file and never settles the debt. Expected only if
      // Stripe genuinely has no open invoice yet, if it fires for a
      // customer who demonstrably owes money, suspect `?expand=invoices`
      // not being honored on this API version.
      console.warn(
        `Past due with no payable invoice URL for ${userId} ` +
          `(x-api-version ${AUTUMN_API_VERSION}, invoices ` +
          `${withInvoices?.invoices === undefined ? 'absent' : `n=${withInvoices.invoices.length}`}) ` +
          `— the overdue dialog will fall back to the billing portal.`,
      );
    }
  }

  await ctx.runMutation(internal.usage.helpers.syncAllFeatures, {
    userId,
    features: toFeaturesRecord(customerData),
    anyPastDue: billing.anyPastDue,
    productsMissing: billing.productsMissing,
    ...(invoiceUrl !== undefined ? { pastDueInvoiceUrl: invoiceUrl } : {}),
    ...(billing.plan ?? {}),
  });
}

/**
 * Fetch an existing customer via `GET /customers/:id`.
 * Used after `POST /track` where the customer is known to exist.
 */
export async function fetchCustomerData(
  secretKey: string,
  userId: string,
  expandInvoices = false,
): Promise<AutumnCustomerResponse | null> {
  const res = await fetch(
    `${AUTUMN_API}/customers/${encodeURIComponent(userId)}${
      expandInvoices ? '?expand=invoices' : ''
    }`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'x-api-version': AUTUMN_API_VERSION,
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`Autumn get customer failed (${res.status}): ${body}`);
    return null;
  }

  return (await res.json()) as AutumnCustomerResponse;
}

/**
 * Idempotent getOrCreate via `POST /customers`.
 * Creates the customer if new; returns existing if known.
 * Combined with `autoEnable: true` on the free plan, this also
 * attaches the free plan automatically for new customers.
 */
async function getOrCreateCustomer(
  secretKey: string,
  userId: string,
): Promise<AutumnCustomerResponse | null> {
  const res = await fetch(`${AUTUMN_API}/customers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      'x-api-version': AUTUMN_API_VERSION,
    },
    body: JSON.stringify({ id: userId }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(
      `Autumn getOrCreate customer failed (${res.status}): ${body}`,
    );
    return null;
  }

  return (await res.json()) as AutumnCustomerResponse;
}

/**
 * Convert Autumn's customer response to our local FeatureState format.
 *
 * Metered features come from `balances` (fields: granted/remaining/usage).
 * Boolean features come from `flags` (on/off access).
 */
export function toFeaturesRecord(
  data: AutumnCustomerResponse,
): Record<string, FeatureState> {
  const result: Record<string, FeatureState> = {};

  for (const [id, entry] of Object.entries(data.balances ?? {})) {
    result[id] = {
      balance: entry.remaining,
      included: entry.granted,
      used: entry.usage,
      unlimited: entry.unlimited || undefined,
    };
  }

  if (data.flags) {
    for (const [id] of Object.entries(data.flags)) {
      result[id] = { balance: 1, included: 1, used: 0, unlimited: true };
    }
  }

  return result;
}

/** Pass JWT `subject` (same id as Autumn `customerId` and `consumeQuota`), not Convex user table `_id`. */
export const syncQuotasInternal = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await syncQuotasForUser(ctx, args.userId);
    return null;
  },
});

export async function syncQuotasForUser(
  ctx: Pick<ActionCtx, 'runMutation'>,
  userId: string,
): Promise<void> {
  const secretKey = getSecretKey();
  const customerData = await getOrCreateCustomer(secretKey, userId);
  if (!customerData) return;

  await pushCustomerState(ctx, secretKey, userId, customerData);
}
