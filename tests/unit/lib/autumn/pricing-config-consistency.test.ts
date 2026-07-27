import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Plan, Variant } from 'atmn';

import {
  free,
  basic,
  basic_annual,
  pro,
  pro_annual,
  ultra,
  ultra_annual,
  credits,
  sentences,
} from '@/autumn.config';
import landingEn from '@/messages/landing/en.json';
import landingDe from '@/messages/landing/de.json';

// LandingJsonLd is an async server component; translations only feed its FAQ
// schema, so a key-echo getTranslations is enough to read the price offers.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

import { LandingJsonLd } from '@/components/landing/landing-json-ld';

/**
 * Standing consistency check between autumn.config.ts (the billing source of
 * truth) and every place the landing page advertises those numbers: the
 * en/de message catalogs and the JSON-LD offer list. Editing a grant or a
 * price in one place without the others now fails here instead of shipping
 * marketing copy that disagrees with what customers are actually billed.
 */

/** Included allowance of `featureId` on a plan, keyed by reset cadence. */
function grantOf(plan: Plan, featureId: string, resetInterval: 'month' | 'one_off'): number {
  const item = plan.items?.find(
    (i) => i.featureId === featureId && i.reset?.interval === resetInterval,
  );
  if (item?.included === undefined) {
    throw new Error(`Plan "${plan.id}" grants no ${resetInterval} ${featureId}`);
  }
  return item.included;
}

const monthlyCredits = (plan: Plan) => grantOf(plan, credits.id, 'month');

function monthlyPrice(plan: Plan): number {
  if (plan.price?.interval !== 'month') {
    throw new Error(`Plan "${plan.id}" is not priced monthly`);
  }
  return plan.price.amount;
}

function annualPrice(variant: Variant): number {
  const price = variant.customize?.price;
  if (!price || price.interval !== 'year') {
    throw new Error(`Variant "${variant.id}" is not priced yearly`);
  }
  return price.amount;
}

/**
 * Every integer in a catalog string, thousands separators removed — covers
 * both the en "2,000" and the de "2.000" spellings. The catalogs quote only
 * whole amounts, so stripping all separators is safe.
 */
function numbersIn(text: string): number[] {
  return (text.match(/\d[\d.,]*/g) ?? []).map((token) => Number(token.replace(/[.,]/g, '')));
}

const paidTiers = [
  { key: 'basic', monthly: basic, annual: basic_annual },
  { key: 'pro', monthly: pro, annual: pro_annual },
  { key: 'ultra', monthly: ultra, annual: ultra_annual },
] as const;

const catalogs = [
  { locale: 'en', pricing: landingEn.pricing },
  { locale: 'de', pricing: landingDe.pricing },
];

describe.each(catalogs)('$locale landing catalog vs autumn.config.ts', ({ pricing }) => {
  const { plans } = pricing;

  it("advertises Free's starter and monthly credit grants", () => {
    // "200 credits to start, then 30 per month" — one-off first, recurring second.
    expect(numbersIn(plans.free.features.credits)).toEqual([
      grantOf(free, credits.id, 'one_off'),
      grantOf(free, credits.id, 'month'),
    ]);
  });

  it("advertises Free's starter and monthly sentence grants", () => {
    expect(numbersIn(plans.free.features.sentences)).toEqual([
      grantOf(free, sentences.id, 'one_off'),
      grantOf(free, sentences.id, 'month'),
    ]);
  });

  it("advertises each paid tier's credit line as its increment over the tier below", () => {
    // The cards stack ("Everything from X, plus:"), so each credit bullet is
    // a delta, not a total — see the note on `basic` in autumn.config.ts.
    expect(numbersIn(plans.basic.features.credits)).toEqual([
      monthlyCredits(basic) - monthlyCredits(free),
    ]);
    expect(numbersIn(plans.pro.features.credits)).toEqual([
      monthlyCredits(pro) - monthlyCredits(basic),
    ]);
    expect(numbersIn(plans.ultra.features.credits)).toEqual([
      monthlyCredits(ultra) - monthlyCredits(pro),
    ]);
  });

  it('quotes the configured monthly prices', () => {
    for (const tier of paidTiers) {
      expect(numbersIn(plans[tier.key].priceMonthly)).toEqual([monthlyPrice(tier.monthly)]);
    }
  });

  it('quotes the configured annual totals and their per-month equivalent', () => {
    for (const tier of paidTiers) {
      // Yearly billing headlines the effective per-month price, with the
      // billed-annually total as a subline — both derive from the variant.
      expect(numbersIn(plans[tier.key].billedAnnually)).toEqual([annualPrice(tier.annual)]);
      expect(numbersIn(plans[tier.key].priceYearlyPerMonth)).toEqual([
        annualPrice(tier.annual) / 12,
      ]);
    }
  });

  it('prices Free at zero, matching the unpriced config plan', () => {
    expect(free.price).toBeUndefined();
    expect(numbersIn(plans.free.price)).toEqual([0]);
  });

  it('backs the yearly-billing save badge with the configured discount', () => {
    // "Save 25%" — every annual variant must actually be 12x monthly minus
    // that percentage, or the badge overstates (or hides) the discount.
    const [savePercent] = numbersIn(pricing.billing.save);
    for (const tier of paidTiers) {
      expect(annualPrice(tier.annual)).toBe(
        12 * monthlyPrice(tier.monthly) * (1 - savePercent / 100),
      );
    }
  });
});

describe('landing JSON-LD offers vs autumn.config.ts', () => {
  it('declares one EUR offer per plan with the configured price', async () => {
    const { container } = render(await LandingJsonLd({ siteUrl: 'https://flexling.app' }));
    const schemas = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]'),
    ).map((script) => JSON.parse(script.textContent ?? 'null') as Record<string, unknown>);
    const app = schemas.find((schema) => schema['@type'] === 'SoftwareApplication');
    expect(app).toBeDefined();

    const offers = app?.offers as Array<{ name: string; price: string; priceCurrency: string }>;
    expect(new Set(offers.map((offer) => offer.priceCurrency))).toEqual(new Set(['EUR']));
    // Keyed by plan name so a renamed/re-priced plan (or a forgotten offer)
    // fails with a readable diff. JSON-LD prices are strings per schema.org.
    expect(Object.fromEntries(offers.map((offer) => [offer.name, offer.price]))).toEqual({
      [free.name]: '0',
      [basic.name]: String(monthlyPrice(basic)),
      [basic_annual.name]: String(annualPrice(basic_annual)),
      [pro.name]: String(monthlyPrice(pro)),
      [pro_annual.name]: String(annualPrice(pro_annual)),
      [ultra.name]: String(monthlyPrice(ultra)),
      [ultra_annual.name]: String(annualPrice(ultra_annual)),
    });
  });
});
