/**
 * The single place that knows what Autumn's customer payloads look like.
 *
 * `GET /customers/:id` returns one of two unrelated shapes depending on the
 * `x-api-version` header (v1.2 `products[]` vs v2.x `subscriptions[]`), and
 * the two disagree about where trial/past-due state lives. Every consumer
 * reads the version-independent `AutumnPlan` instead; this file is the only
 * place either set of raw field names appears. Full field mapping table and
 * why both versions coexist: documentation/autumn-usage-tracking.md,
 * "v1.2 vs v2.x customer shapes (why both)".
 */

/** Plan entry as it appears on `x-api-version: 1.2` (`products[]`). */
type AutumnV1Product = {
  id?: string;
  status?: string;
  is_add_on?: boolean;
  is_default?: boolean;
  past_due?: boolean;
  trial_ends_at?: number | null;
  current_period_end?: number | null;
};

/** Plan entry as it appears on `x-api-version: 2.x` (`subscriptions[]`/`purchases[]`). */
type AutumnV2Subscription = {
  plan_id?: string;
  status?: string;
  add_on?: boolean;
  auto_enable?: boolean;
  past_due?: boolean;
  trial_ends_at?: number | null;
  current_period_end?: number | null;
  expires_at?: number | null;
  canceled_at?: number | null;
};

type AutumnRawPlan = AutumnV1Product & AutumnV2Subscription;

/** Anything that might carry plan entries, in either shape. */
export type AutumnCustomerLike = {
  products?: unknown;
  subscriptions?: unknown;
  purchases?: unknown;
};

/** Version-independent view of one attached plan. */
export type AutumnPlan = {
  planId: string;
  /**
   * The wire `status` verbatim. Safe for display and the admin dashboard;
   * never branch on it — use the booleans, which are correct on both shapes.
   */
  rawStatus: string;
  /** Bolt-on usage product, not a subscription. */
  isAddOn: boolean;
  /** Autumn's auto-attached free plan, which every customer has. */
  isDefault: boolean;
  isPastDue: boolean;
  isTrialing: boolean;
  isExpired: boolean;
  /** A pending plan change that has not taken effect yet. */
  isScheduled: boolean;
  /**
   * Best-effort trial end in ms — only meaningful when `isTrialing`. The
   * v1 shape reports a running trial's end via `current_period_end`, so
   * this falls back to that field and therefore carries the ordinary
   * renewal date for ACTIVE non-trialing v1 products. Gate on `isTrialing`
   * before reading it.
   */
  trialEndsAt?: number;
  currentPeriodEnd?: number;
};

function asArray(value: unknown): AutumnRawPlan[] {
  return Array.isArray(value) ? (value as AutumnRawPlan[]) : [];
}

function normalizeOne(raw: AutumnRawPlan, now: number): AutumnPlan {
  const status = raw.status ?? '';
  // v1 reports the trial end through current_period_end and leaves
  // trial_ends_at null; v2 populates trial_ends_at directly.
  const trialEndsAt = raw.trial_ends_at ?? raw.current_period_end ?? undefined;

  return {
    // v2's `id` is the customer-product row id (`cus_prod_…`), NOT the plan.
    planId: raw.plan_id ?? raw.id ?? '',
    rawStatus: status,
    isAddOn: raw.add_on === true || raw.is_add_on === true,
    isDefault: raw.auto_enable === true || raw.is_default === true,
    isPastDue: raw.past_due === true || status === 'past_due',
    // On v2 a trialing plan reports status 'active', so the timestamp is the
    // only signal. Guard on it still being in the future, otherwise every
    // plan that ever had a trial would read as trialing forever.
    isTrialing:
      status === 'trialing' ||
      (raw.trial_ends_at != null && raw.trial_ends_at > now),
    isExpired: status === 'expired',
    isScheduled: status === 'scheduled',
    trialEndsAt: trialEndsAt ?? undefined,
    currentPeriodEnd: raw.current_period_end ?? undefined,
  };
}

/**
 * Flatten whichever plan shape the payload carries into `AutumnPlan[]`.
 *
 * `products` is only consulted when neither `subscriptions` nor `purchases`
 * is present, so a payload carrying both never double-counts.
 */
export function normalizePlans(
  payload: AutumnCustomerLike | null | undefined,
  now: number = Date.now(),
): AutumnPlan[] {
  if (!payload) return [];

  const v2 = [...asArray(payload.subscriptions), ...asArray(payload.purchases)];
  const raw = v2.length > 0 ? v2 : asArray(payload.products);

  return raw.map((entry) => normalizeOne(entry, now));
}

/** Normalize a bare array of plan entries (either shape). */
export function normalizePlanList(
  entries: unknown,
  now: number = Date.now(),
): AutumnPlan[] {
  return asArray(entries).map((entry) => normalizeOne(entry, now));
}

/** Plans the customer holds right now — excludes expired and scheduled. */
export function currentPlans(plans: AutumnPlan[]): AutumnPlan[] {
  return plans.filter((p) => !p.isExpired && !p.isScheduled);
}

/**
 * The paid plan the customer is currently on: non-default, non-add-on, not
 * expired. A `scheduled` entry (a pending change that hasn't taken effect)
 * never wins over the active/trialing one, regardless of array order.
 */
export function findCurrentPaidPlan(
  plans: AutumnPlan[],
): AutumnPlan | undefined {
  const candidates = plans.filter(
    (p) => !p.isDefault && !p.isAddOn && !p.isExpired,
  );
  return candidates.find((p) => !p.isScheduled) ?? candidates[0];
}
