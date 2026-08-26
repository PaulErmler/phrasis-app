import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: any) => {
        const { children, ...rest } = props;
        const Tag = 'div';
        return <Tag {...rest}>{children}</Tag>;
      },
    },
  ),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

import { PricingSection } from '@/components/landing/pricing-section';

describe('PricingSection', () => {
  it('renders title', () => {
    render(<PricingSection />);
    expect(screen.getByText('title')).toBeInTheDocument();
  });

  it('renders four plans', () => {
    render(<PricingSection />);
    // Each plan has a CTA button with translation key `plans.<plan>.cta`
    expect(screen.getByText('plans.free.cta')).toBeInTheDocument();
    expect(screen.getByText('plans.basic.cta')).toBeInTheDocument();
    expect(screen.getByText('plans.pro.cta')).toBeInTheDocument();
    expect(screen.getByText('plans.ultra.cta')).toBeInTheDocument();
  });

  it('stacks the paid tiers on the one below', () => {
    render(<PricingSection />);
    // Every paid tier carries an "Everything from X, plus:" line; Free is
    // the base and must not.
    expect(screen.getAllByText('everythingFrom')).toHaveLength(3);
  });

  it('does not repeat what a tier inherits', () => {
    render(<PricingSection />);
    // Free and Basic both cap at 1 course, and only Free spells out the
    // credit hint, so those bullets appear once, on the base card.
    expect(screen.getAllByText('plans.free.features.courses')).toHaveLength(1);
    expect(screen.queryByText('plans.basic.features.courses')).toBeNull();
    expect(screen.getAllByText('plans.free.features.creditsHint')).toHaveLength(
      1,
    );
    // Unlimited sentences are introduced by Basic and inherited above it.
    expect(
      screen.getByText('plans.basic.features.sentences'),
    ).toBeInTheDocument();
    expect(screen.queryByText('plans.pro.features.sentences')).toBeNull();
    expect(screen.queryByText('plans.ultra.features.sentences')).toBeNull();
  });

  // The price VALUES behind these catalog keys are pinned to autumn.config.ts
  // by tests/unit/lib/autumn/pricing-config-consistency.test.ts; these two
  // tests close the loop by proving the section renders exactly those keys.
  it('headlines the effective per-month price on the default yearly billing', () => {
    render(<PricingSection />);
    expect(screen.getByText('plans.free.price')).toBeInTheDocument();
    for (const plan of ['basic', 'pro', 'ultra']) {
      expect(
        screen.getByText(`plans.${plan}.priceYearlyPerMonth`),
      ).toBeInTheDocument();
      // With the billed-annually total as a subline.
      expect(
        screen.getByText(`plans.${plan}.billedAnnually`),
      ).toBeInTheDocument();
    }
  });

  it('switches paid tiers to the monthly price when toggled', () => {
    render(<PricingSection />);
    fireEvent.click(screen.getByText('billing.monthly'));
    for (const plan of ['basic', 'pro', 'ultra']) {
      expect(
        screen.getByText(`plans.${plan}.priceMonthly`),
      ).toBeInTheDocument();
      // The billed-annually subline only belongs to yearly billing.
      expect(screen.queryByText(`plans.${plan}.billedAnnually`)).toBeNull();
    }
  });

  it('renders traditional comparison section', () => {
    render(<PricingSection />);
    expect(screen.getByText('comparison.comparedWith')).toBeInTheDocument();
  });
});
