import { describe, it, expect } from 'vitest';
import type { Product } from 'autumn-js';
import { findUpgradeProductFromPricingTable } from '@/lib/autumn/find-upgrade-product';

function makeProduct(partial: Partial<Product> & { id: string }): Product {
  return {
    id: partial.id,
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
      makeProduct({ id: 'a', scenario: 'current', items: [] }),
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
