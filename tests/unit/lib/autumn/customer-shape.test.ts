import { describe, it, expect } from 'vitest';
import {
  normalizePlans,
  normalizePlanList,
  currentPlans,
  findCurrentPaidPlan,
  type AutumnPlan,
} from '@/lib/autumn/customer-shape';

/**
 * The TRIALING fixtures below are real payloads captured from Autumn on
 * 2026-07-26. The same customer, the same instant, fetched twice with
 * different `x-api-version` headers. The PAST-DUE pair comes from a
 * separate genuinely past-due customer and is hand-trimmed to the fields
 * the assertions touch (the trimming matters: an untrimmed v1 past-due
 * entry would carry `current_period_end`, which normalizeOne folds into
 * `trialEndsAt`). Together they are the whole point of this module: the two
 * families disagree about where trialing and past_due live, so the central
 * assertion is that both normalize to an identical AutumnPlan.
 *
 * `now` is passed explicitly everywhere. The v2 trialing signal is
 * `trial_ends_at > now`, so a wall-clock default would make these tests start
 * failing once the captured timestamps fall into the past.
 */

/** Between the captures and every trial_ends_at below. */
const NOW = 1785085000000;

// --- trialing: same customer, both versions -------------------------------

const V1_TRIALING = {
  id: 'basic_annual',
  name: 'Basic Annual',
  group: null,
  status: 'trialing',
  canceled_at: null,
  started_at: 1785081918328,
  is_default: false,
  is_add_on: false,
  version: 1,
  current_period_start: 1785081912000,
  current_period_end: 1785687307000,
};

const V2_TRIALING = {
  id: 'cus_prod_3H31Q3FPD2vZGDjbOwMMwhOyycq',
  plan_id: 'basic_annual',
  auto_enable: false,
  add_on: false,
  status: 'active',
  past_due: false,
  canceled_at: null,
  expires_at: null,
  trial_ends_at: 1785687307000,
  started_at: 1785081918328,
  current_period_start: 1785081912000,
  current_period_end: 1785687307000,
  quantity: 1,
  scope: 'customer',
};

// --- past due: same customer, both versions -------------------------------

/** v1 folds delinquency into `status` and omits the boolean entirely. */
const V1_PAST_DUE = {
  id: 'basic',
  status: 'past_due',
  is_default: false,
  is_add_on: false,
};

/** v2 reports `status: "active"` and flags it only via the boolean. */
const V2_PAST_DUE = {
  id: 'cus_prod_3H39PYKPPPCRPWBCRHNCP5BXnS1',
  plan_id: 'basic',
  auto_enable: false,
  add_on: false,
  status: 'active',
  past_due: true,
  canceled_at: null,
  expires_at: null,
  trial_ends_at: null,
};

const V2_FREE = {
  id: 'cus_prod_3H36p5avVrlDjBHODZ5ne4WN01R',
  plan_id: 'free',
  auto_enable: true,
  add_on: false,
  status: 'active',
  past_due: false,
};

const V1_FREE = {
  id: 'free',
  status: 'active',
  is_default: true,
  is_add_on: false,
};

const only = (p: AutumnPlan[]) => {
  expect(p).toHaveLength(1);
  return p[0];
};

describe('normalizePlans: the two wire families agree after normalization', () => {
  it('trialing normalizes identically despite v2 reporting status "active"', () => {
    const v1 = only(normalizePlans({ products: [V1_TRIALING] }, NOW));
    const v2 = only(normalizePlans({ subscriptions: [V2_TRIALING] }, NOW));

    expect(v1.isTrialing).toBe(true);
    expect(v2.isTrialing).toBe(true);
    expect(v1.planId).toBe('basic_annual');
    expect(v2.planId).toBe('basic_annual');
    expect(v1.trialEndsAt).toBe(1785687307000);
    expect(v2.trialEndsAt).toBe(1785687307000);

    // Everything except the raw wire status must match exactly.
    const { rawStatus: s1, ...rest1 } = v1;
    const { rawStatus: s2, ...rest2 } = v2;
    expect(rest1).toEqual(rest2);
    expect(s1).toBe('trialing');
    expect(s2).toBe('active');
  });

  it('past_due normalizes identically despite v2 reporting status "active"', () => {
    const v1 = only(normalizePlans({ products: [V1_PAST_DUE] }, NOW));
    const v2 = only(normalizePlans({ subscriptions: [V2_PAST_DUE] }, NOW));

    expect(v1.isPastDue).toBe(true);
    expect(v2.isPastDue).toBe(true);

    const { rawStatus: s1, ...rest1 } = v1;
    const { rawStatus: s2, ...rest2 } = v2;
    expect(rest1).toEqual(rest2);
    expect(s1).toBe('past_due');
    expect(s2).toBe('active');
  });

  it('the auto-attached free plan is isDefault on both (is_default / auto_enable)', () => {
    expect(only(normalizePlans({ products: [V1_FREE] }, NOW)).isDefault).toBe(true);
    expect(only(normalizePlans({ subscriptions: [V2_FREE] }, NOW)).isDefault).toBe(true);
  });

  it('a GRANDFATHERED free attachment with NO default flag is still isDefault', () => {
    // Free attachments created under old product versions report
    // is_default:false on v1.2 (live payload, 2026-08-11), the plan id is
    // the only reliable signal, and misreading it as non-default made every
    // consumer treat those customers as paying.
    expect(
      only(
        normalizePlans(
          { products: [{ id: 'free', status: 'active', is_default: false, is_add_on: false }] },
          NOW,
        ),
      ).isDefault,
    ).toBe(true);
  });

  it('reads the product id from plan_id on v2, never the cus_prod_ row id', () => {
    const v2 = only(normalizePlans({ subscriptions: [V2_TRIALING] }, NOW));
    expect(v2.planId).toBe('basic_annual');
    expect(v2.planId).not.toContain('cus_prod_');
  });
});

describe('normalizePlans: shape selection', () => {
  it('prefers subscriptions+purchases and ignores products when both present', () => {
    const plans = normalizePlans(
      {
        subscriptions: [V2_PAST_DUE],
        purchases: [],
        products: [V1_TRIALING],
      },
      NOW,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].isPastDue).toBe(true);
  });

  it('merges purchases into subscriptions', () => {
    const plans = normalizePlans(
      { subscriptions: [V2_FREE], purchases: [V2_PAST_DUE] },
      NOW,
    );
    expect(plans.map((p) => p.planId)).toEqual(['free', 'basic']);
  });

  it('falls back to products when no v2 arrays are present', () => {
    expect(normalizePlans({ products: [V1_TRIALING] }, NOW)).toHaveLength(1);
  });

  it('returns [] for empty, null and malformed payloads', () => {
    expect(normalizePlans(null, NOW)).toEqual([]);
    expect(normalizePlans(undefined, NOW)).toEqual([]);
    expect(normalizePlans({}, NOW)).toEqual([]);
    expect(normalizePlans({ subscriptions: 'nonsense' }, NOW)).toEqual([]);
    expect(normalizePlans({ products: null }, NOW)).toEqual([]);
  });

  it('normalizePlanList handles a bare array of either shape', () => {
    expect(normalizePlanList([V1_TRIALING], NOW)[0].planId).toBe('basic_annual');
    expect(normalizePlanList([V2_PAST_DUE], NOW)[0].isPastDue).toBe(true);
    expect(normalizePlanList(undefined, NOW)).toEqual([]);
  });
});

describe('normalizePlans: flags', () => {
  it('marks add-ons from either field name', () => {
    expect(only(normalizePlanList([{ id: 'x', is_add_on: true }], NOW)).isAddOn).toBe(true);
    expect(only(normalizePlanList([{ plan_id: 'x', add_on: true }], NOW)).isAddOn).toBe(true);
  });

  it('marks expired and scheduled', () => {
    expect(only(normalizePlanList([{ id: 'x', status: 'expired' }], NOW)).isExpired).toBe(true);
    expect(only(normalizePlanList([{ id: 'x', status: 'scheduled' }], NOW)).isScheduled).toBe(true);
  });

  it('does not treat a plan whose trial already ended as trialing', () => {
    // Otherwise every plan that ever had a trial would read as trialing.
    const past = only(
      normalizePlanList([{ plan_id: 'x', status: 'active', trial_ends_at: NOW - 1 }], NOW),
    );
    expect(past.isTrialing).toBe(false);
  });

  it('does not infer a trial from current_period_end alone', () => {
    // v2 uses current_period_end for ordinary billing periods; only
    // trial_ends_at signals a trial there.
    const active = only(
      normalizePlanList(
        [{ plan_id: 'x', status: 'active', current_period_end: NOW + 999_999 }],
        NOW,
      ),
    );
    expect(active.isTrialing).toBe(false);
  });

  it('tolerates entries missing every optional field', () => {
    const bare = only(normalizePlanList([{}], NOW));
    expect(bare).toMatchObject({
      planId: '',
      rawStatus: '',
      isAddOn: false,
      isDefault: false,
      isPastDue: false,
      isTrialing: false,
      isExpired: false,
      isScheduled: false,
    });
  });
});

describe('currentPlans / findCurrentPaidPlan', () => {
  const plans = (raw: unknown[]) => normalizePlanList(raw, NOW);

  it('currentPlans drops expired and scheduled', () => {
    const p = plans([
      { id: 'a', status: 'active' },
      { id: 'b', status: 'expired' },
      { id: 'c', status: 'scheduled' },
    ]);
    expect(currentPlans(p).map((x) => x.planId)).toEqual(['a']);
  });

  it('skips the free plan and add-ons', () => {
    const p = plans([V1_FREE, { id: 'addon', is_add_on: true }, V1_PAST_DUE]);
    expect(findCurrentPaidPlan(p)?.planId).toBe('basic');
  });

  it('prefers the active plan over a scheduled one regardless of order', () => {
    const scheduledFirst = plans([
      { id: 'next', status: 'scheduled' },
      { id: 'now', status: 'active' },
    ]);
    expect(findCurrentPaidPlan(scheduledFirst)?.planId).toBe('now');
  });

  it('falls back to a scheduled plan when it is the only candidate', () => {
    expect(findCurrentPaidPlan(plans([{ id: 'next', status: 'scheduled' }]))?.planId).toBe('next');
  });

  it('returns undefined when only the free plan is attached', () => {
    expect(findCurrentPaidPlan(plans([V1_FREE]))).toBeUndefined();
  });
});
