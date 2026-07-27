import { describe, it, expect, vi } from 'vitest';
import type { Product, ProductItem } from 'autumn-js';

// Only the pure tier helpers are under test; the module pulls the Autumn
// React hooks in at import time.
vi.mock('autumn-js/react', () => ({
  useCustomer: () => ({}),
  usePricingTable: () => ({}),
}));

import { previousTier, itemsAddedOver } from '@/components/autumn/pricing-table';

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
    grant('credits', 200, null),
    grant('credits', 30),
    grant('sentences', 300, null),
    grant('sentences', 50),
    grant('courses', 1, null),
  ],
});
const basic = makePlan('basic', {
  price: 8,
  intervalGroup: 'month',
  items: [grant('credits', 430), grant('sentences', 20000), grant('courses', 1, null)],
});
const pro = makePlan('pro', {
  price: 16,
  intervalGroup: 'month',
  items: [
    grant('credits', 1030),
    grant('sentences', 20000),
    grant('courses', 10, null),
    grant('multiple_languages', 0, null),
  ],
});
const ultra = makePlan('ultra', {
  price: 32,
  intervalGroup: 'month',
  items: [
    grant('credits', 3030),
    grant('sentences', 20000),
    grant('courses', 10, null),
    grant('multiple_languages', 0, null),
  ],
});
const proAnnual = makePlan('pro_annual', {
  price: 144,
  intervalGroup: 'year',
  items: [grant('credits', 1030), grant('courses', 10, null)],
});
const ultraAnnual = makePlan('ultra_annual', {
  price: 288,
  intervalGroup: 'year',
  items: [grant('credits', 3030), grant('courses', 10, null)],
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
    // "Everything from Pro, plus 2,000 credits" — Pro's 1,030 is already
    // counted by the line above, and 1,030 + 2,000 is Ultra's real 3,030.
    expect(added[0].included_usage).toBe(2000);
  });

  // The grants are tuned so every step reads as a round number, and they
  // chain: bumping one tier shifts the increment of the tier above it.
  it('renders the whole ladder as round increments', () => {
    const creditsAdded = (plan: Product, below: Product) =>
      itemsAddedOver(plan.items.slice(1), below).find(
        (i) => i.feature_id === 'credits',
      )?.included_usage;

    expect(creditsAdded(basic, free)).toBe(400);
    expect(creditsAdded(pro, basic)).toBe(600);
    expect(creditsAdded(ultra, pro)).toBe(2000);
  });

  it('keeps a cap at its own total rather than an increment', () => {
    const added = itemsAddedOver(paidItems(pro), basic);
    // Courses is a simultaneous cap, not a pool that stacks: Pro allows 10
    // at once, not Basic's 1 plus another 9.
    expect(added.find((i) => i.feature_id === 'courses')?.included_usage).toBe(10);
    // Boolean flags the lower tier lacks are carried over untouched.
    expect(added.map((i) => i.feature_id)).toContain('multiple_languages');
    // Both grant 20,000 sentences, so it is not repeated.
    expect(added.map((i) => i.feature_id)).not.toContain('sentences');
  });

  it('does not conflate a one-off starter grant with a recurring one', () => {
    // Free gives 200 credits one-off + 30/month. Basic's 430/month must be
    // compared against the 30/month, not the larger one-off grant — giving
    // the round "plus 400 credits per month" the plans are tuned for.
    const added = itemsAddedOver(paidItems(basic), free);
    expect(added.find((i) => i.feature_id === 'credits')?.included_usage).toBe(400);
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
