import { describe, it, expect } from 'vitest';
import type { Product } from 'autumn-js';
import {
  findCurrentIntervalGroup,
  findUpgradeProductFromPricingTable,
  preferIntervalGroup,
} from '@/lib/autumn/find-upgrade-product';

function makeProduct(partial: Partial<Product> & { id: string }): Product {
  return {
    name: partial.name ?? partial.id,
    scenario: partial.scenario ?? 'upgrade',
    items: partial.items ?? [],
    properties: partial.properties,
    ...partial,
  } as Product;
}

describe('findUpgradeProductFromPricingTable', () => {
  it('returns undefined for undefined product list', () => {
    expect(findUpgradeProductFromPricingTable(undefined, 'x', 0)).toBeUndefined();
  });

  it('returns undefined when no product matches', () => {
    const products = [
      // 'current' is not in autumn-js' ProductScenario union. The matcher
      // only distinguishes 'upgrade'/'new' from everything else, so the
      // legacy fixture value is kept as-is.
      makeProduct({
        id: 'a',
        scenario: 'current' as unknown as Product['scenario'],
        items: [],
      }),
    ];
    expect(findUpgradeProductFromPricingTable(products, 'x', 0)).toBeUndefined();
  });

  it('finds product with higher included_usage for consumable feature', () => {
    const products = [
      makeProduct({
        id: 'pro',
        scenario: 'upgrade',
        items: [{ feature_id: 'chat', included_usage: 100 } as never],
      }),
    ];
    const found = findUpgradeProductFromPricingTable(products, 'chat', 10, true);
    expect(found?.id).toBe('pro');
  });

  it('skips products with equal or lower included_usage', () => {
    const products = [
      makeProduct({
        id: 'same',
        scenario: 'upgrade',
        items: [{ feature_id: 'chat', included_usage: 10 } as never],
      }),
    ];
    expect(
      findUpgradeProductFromPricingTable(products, 'chat', 10, true),
    ).toBeUndefined();
  });

  it('accepts "inf" as unlimited usage', () => {
    const products = [
      makeProduct({
        id: 'unlimited',
        scenario: 'upgrade',
        items: [{ feature_id: 'chat', included_usage: 'inf' } as never],
      }),
    ];
    const found = findUpgradeProductFromPricingTable(
      products,
      'chat',
      99999,
      true,
    );
    expect(found?.id).toBe('unlimited');
  });

  it('accepts any product with the feature for boolean features (consumable=undefined)', () => {
    const products = [
      makeProduct({
        id: 'any',
        scenario: 'upgrade',
        items: [{ feature_id: 'flag', included_usage: 0 } as never],
      }),
    ];
    const found = findUpgradeProductFromPricingTable(products, 'flag', 0);
    expect(found?.id).toBe('any');
  });

  // With three paid tiers (Basic/Pro/Ultra), Autumn's dashboard order is not
  // price order. The lookup must still land on the cheapest sufficient tier.
  it('returns the cheapest sufficient tier regardless of input order', () => {
    const tier = (id: string, price: number, credits: number) =>
      makeProduct({
        id,
        scenario: 'upgrade',
        properties: { is_free: false } as never,
        items: [
          { price } as never,
          { feature_id: 'credits', included_usage: credits } as never,
        ],
      });
    // Deliberately most-expensive-first.
    const products = [tier('ultra', 32, 3000), tier('pro', 16, 1000), tier('basic', 8, 400)];

    expect(
      findUpgradeProductFromPricingTable(products, 'credits', 30, true)?.id,
    ).toBe('basic');
    expect(
      findUpgradeProductFromPricingTable(products, 'credits', 400, true)?.id,
    ).toBe('pro');
    expect(
      findUpgradeProductFromPricingTable(products, 'credits', 1000, true)?.id,
    ).toBe('ultra');
  });

  it('stays on the interval the customer already pays on', () => {
    const tier = (id: string, price: number, credits: number, group: string) =>
      makeProduct({
        id,
        scenario: 'upgrade',
        properties: { is_free: false, interval_group: group } as never,
        items: [
          { price } as never,
          { feature_id: 'credits', included_usage: credits } as never,
        ],
      });
    const products = [
      tier('pro', 16, 1000, 'month'),
      tier('ultra', 32, 3000, 'month'),
      tier('pro_annual', 144, 1000, 'year'),
      tier('ultra_annual', 288, 3000, 'year'),
    ];

    // An annual subscriber must not be sent to monthly Ultra just because
    // €32 sorts below €288.
    expect(
      findUpgradeProductFromPricingTable(products, 'credits', 1000, true, 'year')?.id,
    ).toBe('ultra_annual');
    expect(
      findUpgradeProductFromPricingTable(products, 'credits', 1000, true, 'month')?.id,
    ).toBe('ultra');
    // No paid plan yet → no interval to honour, cheapest wins.
    expect(
      findUpgradeProductFromPricingTable(products, 'credits', 1000, true)?.id,
    ).toBe('ultra');
  });

  it('crosses intervals rather than offering no upgrade at all', () => {
    const monthlyOnly = makeProduct({
      id: 'ultra',
      scenario: 'upgrade',
      properties: { is_free: false, interval_group: 'month' } as never,
      items: [
        { price: 32 } as never,
        { feature_id: 'credits', included_usage: 3000 } as never,
      ],
    });
    expect(
      findUpgradeProductFromPricingTable([monthlyOnly], 'credits', 1000, true, 'year')?.id,
    ).toBe('ultra');
  });

  it('never returns a free plan, whatever scenario Autumn reports', () => {
    const free = makeProduct({
      id: 'free',
      scenario: 'upgrade',
      properties: { is_free: true } as never,
      items: [{ feature_id: 'chat', included_usage: 100 } as never],
    });
    expect(
      findUpgradeProductFromPricingTable([free], 'chat', 0, true),
    ).toBeUndefined();
  });

  it('accepts "new" scenario only when not free', () => {
    const free = makeProduct({
      id: 'free',
      scenario: 'new',
      properties: { is_free: true } as never,
      items: [{ feature_id: 'chat', included_usage: 100 } as never],
    });
    const paid = makeProduct({
      id: 'paid',
      scenario: 'new',
      properties: { is_free: false } as never,
      items: [{ feature_id: 'chat', included_usage: 100 } as never],
    });
    expect(
      findUpgradeProductFromPricingTable([free], 'chat', 0, true),
    ).toBeUndefined();
    expect(findUpgradeProductFromPricingTable([paid], 'chat', 0, true)?.id).toBe(
      'paid',
    );
  });
});

describe('preferIntervalGroup', () => {
  const monthly = { properties: { interval_group: 'month' } };
  const annual = { properties: { interval_group: 'year' } };

  it('keeps only the matching interval when one exists', () => {
    expect(preferIntervalGroup([monthly, annual], 'year')).toEqual([annual]);
  });

  it('falls back to the full list when nothing matches', () => {
    expect(preferIntervalGroup([monthly], 'year')).toEqual([monthly]);
  });

  it('passes everything through when there is no interval to honour', () => {
    expect(preferIntervalGroup([monthly, annual], undefined)).toEqual([
      monthly,
      annual,
    ]);
  });
});

describe('findCurrentIntervalGroup', () => {
  const products = [
    makeProduct({
      id: 'pro_annual',
      properties: { interval_group: 'year' } as never,
    }),
    makeProduct({
      id: 'pro',
      properties: { interval_group: 'month' } as never,
    }),
  ];

  it('reads the interval off the plan the customer holds', () => {
    const customer = { products: [{ id: 'pro_annual', status: 'active' }] };
    expect(findCurrentIntervalGroup(customer, products)).toBe('year');
  });

  it('ignores the auto-attached free plan', () => {
    const customer = {
      products: [{ id: 'free', status: 'active', is_default: true }],
    };
    expect(findCurrentIntervalGroup(customer, products)).toBeUndefined();
  });

  it('returns undefined for a customer with no plans', () => {
    expect(findCurrentIntervalGroup(undefined, products)).toBeUndefined();
  });
});
