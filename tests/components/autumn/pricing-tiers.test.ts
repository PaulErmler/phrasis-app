import { describe, it, expect, vi } from 'vitest';
import type { Product, ProductItem } from 'autumn-js';
import type { Plan, Variant } from 'atmn';

// Only the pure tier helpers are under test; the module pulls the Autumn
// React hooks in at import time.
vi.mock('autumn-js/react', () => ({
  useCustomer: () => ({}),
  usePricingTable: () => ({}),
}));

import { previousTier, itemsAddedOver } from '@/components/autumn/pricing-table';
import {
  free as freePlan,
  basic as basicPlan,
  pro as proPlan,
  ultra as ultraPlan,
  pro_annual as proAnnualVariant,
  ultra_annual as ultraAnnualVariant,
} from '@/autumn.config';

// Allowances and prices are read from the real billing config, so a grant
// change there flows into the fixtures (and the expected increments below)
// instead of silently diverging. Only the Product SHAPE is hand-built.
const included = (
  plan: Plan,
  featureId: string,
  resetInterval?: 'month' | 'one_off',
): number => {
  const item = plan.items?.find(
    (i) =>
      i.featureId === featureId &&
      (resetInterval ? i.reset?.interval === resetInterval : i.reset === undefined),
  );
  if (item?.included === undefined) {
    throw new Error(`Plan "${plan.id}" grants no ${resetInterval ?? 'unreset'} ${featureId}`);
  }
  return item.included;
};

const monthlyCredits = (plan: Plan) => included(plan, 'credits', 'month');

const monthlyPrice = (plan: Plan): number => {
  if (!plan.price) throw new Error(`Plan "${plan.id}" has no price`);
  return plan.price.amount;
};

const annualPrice = (variant: Variant): number => {
  const amount = variant.customize?.price?.amount;
  if (amount === undefined) throw new Error(`Variant "${variant.id}" has no price`);
  return amount;
};

const price = (amount: number, interval: string) =>
  ({ price: amount, interval }) as unknown as ProductItem;

const grant = (
  feature_id: string,
  included_usage: number | 'inf' | undefined,
  interval: string | null = 'month',
) => ({ feature_id, included_usage, interval }) as unknown as ProductItem;

function makePlan(
  id: string,
  opts: {
    price?: number;
    intervalGroup?: string;
    isFree?: boolean;
    items: ProductItem[];
  },
): Product {
  return {
    id,
    name: id,
    items: opts.isFree
      ? opts.items
      : [price(opts.price ?? 0, opts.intervalGroup === 'year' ? 'year' : 'month'), ...opts.items],
    properties: {
      is_free: opts.isFree ?? false,
      interval_group: opts.intervalGroup,
    },
  } as unknown as Product;
}

// Mirrors autumn.config.ts closely enough to exercise the real edge cases:
// Free's one-off + recurring credit grants, and Pro/Ultra differing only in credits.
const free = makePlan('free', {
  isFree: true,
  items: [
    grant('credits', included(freePlan, 'credits', 'one_off'), null),
    grant('credits', included(freePlan, 'credits', 'month')),
    grant('sentences', included(freePlan, 'sentences', 'one_off'), null),
    grant('sentences', included(freePlan, 'sentences', 'month')),
    grant('courses', included(freePlan, 'courses'), null),
  ],
});
const basic = makePlan('basic', {
  price: monthlyPrice(basicPlan),
  intervalGroup: 'month',
  items: [
    grant('credits', included(basicPlan, 'credits', 'month')),
    grant('sentences', included(basicPlan, 'sentences', 'month')),
    grant('courses', included(basicPlan, 'courses'), null),
  ],
});
const pro = makePlan('pro', {
  price: monthlyPrice(proPlan),
  intervalGroup: 'month',
  items: [
    grant('credits', included(proPlan, 'credits', 'month')),
    grant('sentences', included(proPlan, 'sentences', 'month')),
    grant('courses', included(proPlan, 'courses'), null),
    grant('multiple_languages', 0, null),
  ],
});
const ultra = makePlan('ultra', {
  price: monthlyPrice(ultraPlan),
  intervalGroup: 'month',
  items: [
    grant('credits', included(ultraPlan, 'credits', 'month')),
    grant('sentences', included(ultraPlan, 'sentences', 'month')),
    grant('courses', included(ultraPlan, 'courses'), null),
    grant('multiple_languages', 0, null),
  ],
});
// Annual variants inherit their entitlements from the base plans in config.
const proAnnual = makePlan('pro_annual', {
  price: annualPrice(proAnnualVariant),
  intervalGroup: 'year',
  items: [
    grant('credits', included(proPlan, 'credits', 'month')),
    grant('courses', included(proPlan, 'courses'), null),
  ],
});
const ultraAnnual = makePlan('ultra_annual', {
  price: annualPrice(ultraAnnualVariant),
  intervalGroup: 'year',
  items: [
    grant('credits', included(ultraPlan, 'credits', 'month')),
    grant('courses', included(ultraPlan, 'courses'), null),
  ],
});

const ALL = [free, basic, pro, ultra, proAnnual, ultraAnnual];

describe('previousTier', () => {
  it('returns the next cheaper paid plan in the same interval', () => {
    expect(previousTier(ultra, ALL)?.id).toBe('pro');
    expect(previousTier(pro, ALL)?.id).toBe('basic');
  });

  it('returns the free plan for the entry paid tier', () => {
    expect(previousTier(basic, ALL)?.id).toBe('free');
  });

  it('never crosses billing intervals', () => {
    // Annual Ultra builds on annual Pro, not on monthly Pro — even though
    // monthly Pro (€16) is the cheaper plan by raw price.
    expect(previousTier(ultraAnnual, ALL)?.id).toBe('pro_annual');
  });

  it('returns undefined for the free plan itself', () => {
    expect(previousTier(free, ALL)).toBeUndefined();
  });

  it('returns undefined when the tier below is off the table', () => {
    // The onboarding picker passes excludeFreePlan, so Basic has no base.
    expect(previousTier(basic, [basic, pro, ultra])).toBeUndefined();
  });
});

describe('itemsAddedOver', () => {
  const paidItems = (p: Product) => p.items.slice(1);

  it('lists only what the tier actually adds, as an increment', () => {
    const added = itemsAddedOver(paidItems(ultra), pro);
    expect(added.map((i) => i.feature_id)).toEqual(['credits']);
    // "Everything from Pro, plus N credits" — Pro's total is already counted
    // by the line above, so only the delta up to Ultra's grant is listed.
    expect(added[0].included_usage).toBe(monthlyCredits(ultraPlan) - monthlyCredits(proPlan));
  });

  // The grants are tuned so every step reads as a round number, and they
  // chain: bumping one tier shifts the increment of the tier above it.
  it('renders the whole ladder as round increments', () => {
    const creditsAdded = (plan: Product, below: Product) =>
      itemsAddedOver(plan.items.slice(1), below).find(
        (i) => i.feature_id === 'credits',
      )?.included_usage;

    const steps = [
      [creditsAdded(basic, free), monthlyCredits(basicPlan) - monthlyCredits(freePlan)],
      [creditsAdded(pro, basic), monthlyCredits(proPlan) - monthlyCredits(basicPlan)],
      [creditsAdded(ultra, pro), monthlyCredits(ultraPlan) - monthlyCredits(proPlan)],
    ] as const;
    for (const [rendered, configDelta] of steps) {
      expect(rendered).toBe(configDelta);
      // The tuning invariant itself: every advertised step is round.
      expect(configDelta % 100).toBe(0);
    }
  });

  it('keeps a cap at its own total rather than an increment', () => {
    const added = itemsAddedOver(paidItems(pro), basic);
    // Courses is a simultaneous cap, not a pool that stacks: Pro allows 10
    // at once, not Basic's 1 plus another 9.
    expect(added.find((i) => i.feature_id === 'courses')?.included_usage).toBe(
      included(proPlan, 'courses'),
    );
    // Boolean flags the lower tier lacks are carried over untouched.
    expect(added.map((i) => i.feature_id)).toContain('multiple_languages');
    // Both grant 20,000 sentences, so it is not repeated.
    expect(added.map((i) => i.feature_id)).not.toContain('sentences');
  });

  it('does not conflate a one-off starter grant with a recurring one', () => {
    // Free gives a one-off starter pot of credits plus a monthly trickle.
    // Basic's monthly grant must be compared against the monthly trickle,
    // not the larger one-off grant — giving the round "plus N credits per
    // month" increment the plans are tuned for.
    const added = itemsAddedOver(paidItems(basic), free);
    expect(added.find((i) => i.feature_id === 'credits')?.included_usage).toBe(
      monthlyCredits(basicPlan) - monthlyCredits(freePlan),
    );
  });

  it('drops equal allowances', () => {
    const added = itemsAddedOver(paidItems(basic), free);
    // Free and Basic both cap at 1 course.
    expect(added.map((i) => i.feature_id)).not.toContain('courses');
  });

  it('treats "inf" as greater than any number but not than itself', () => {
    const unlimited = makePlan('unlimited', {
      price: 99,
      intervalGroup: 'month',
      items: [grant('sentences', 'inf')],
    });
    expect(itemsAddedOver(paidItems(unlimited), basic)).toHaveLength(1);
    expect(itemsAddedOver(paidItems(unlimited), unlimited)).toHaveLength(0);
    // A finite allowance never "adds" over an unlimited one.
    expect(itemsAddedOver(paidItems(basic), unlimited).map((i) => i.feature_id)).not.toContain(
      'sentences',
    );
  });

  it('returns every item when there is no tier below', () => {
    expect(itemsAddedOver(paidItems(ultra), undefined)).toHaveLength(4);
  });
});
