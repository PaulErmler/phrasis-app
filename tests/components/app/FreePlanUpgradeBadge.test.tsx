import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// The badge derives its visibility from `useCustomer` (autumn-js) through the
// REAL `getTrialState`, so the customers below are v1.2-shaped wire payloads
// (products[] + trials_used[]), not pre-digested trial states. That keeps the
// suite honest about the plan-source contract: if getTrialState's reading of
// the wire shape changes, these tests fail with it.
// ---------------------------------------------------------------------------
let currentCustomer: Record<string, unknown> | null = null;
let customerLoading = false;
vi.mock('autumn-js/react', () => ({
  useCustomer: () => ({
    customer: currentCustomer,
    isLoading: customerLoading,
  }),
}));

let nativeApp = false;
vi.mock('@/hooks/use-native-app', () => ({
  useIsNativeApp: () => nativeApp,
}));

const captureMock = vi.fn();
vi.mock('@/lib/posthog/events', () => ({
  capture: (...args: unknown[]) => captureMock(...args),
  CLIENT_EVENTS: { PLAN_CTA_CLICKED: 'plan_cta_clicked' },
}));

// The pricing table pulls the whole autumn checkout tree; the badge only
// needs to prove it mounts one inside the dialog.
vi.mock('@/components/autumn/pricing-table', () => ({
  default: () => <div data-testid="pricing-table" />,
}));

import { FreePlanUpgradeBadge } from '@/components/app/FreePlanUpgradeBadge';

/** Free-only customer: just Autumn's auto-attached default plan. */
const freeCustomer = () => ({
  products: [{ id: 'free', status: 'active', is_default: true }],
  trials_used: [],
});

const paidCustomer = () => ({
  products: [
    { id: 'free', status: 'active', is_default: true },
    { id: 'basic', status: 'active' },
  ],
  trials_used: [{ product_id: 'basic' }],
});

const trialingCustomer = () => ({
  products: [
    { id: 'free', status: 'active', is_default: true },
    {
      id: 'pro',
      status: 'trialing',
      current_period_end: Date.now() + 5 * 24 * 3_600_000,
    },
  ],
  trials_used: [{ product_id: 'pro' }],
});

beforeEach(() => {
  currentCustomer = freeCustomer();
  customerLoading = false;
  nativeApp = false;
  captureMock.mockClear();
});

describe('FreePlanUpgradeBadge visibility', () => {
  it('renders the Free pill and Upgrade button for a free-plan customer', () => {
    render(<FreePlanUpgradeBadge />);
    expect(screen.getByTestId('home-free-plan-badge')).toBeInTheDocument();
    expect(screen.getByText('freePlan')).toBeInTheDocument();
    expect(screen.getByTestId('home-upgrade-button')).toBeInTheDocument();
  });

  it('renders nothing while the customer is still loading (no flash for paid users)', () => {
    customerLoading = true;
    currentCustomer = null;
    render(<FreePlanUpgradeBadge />);
    expect(
      screen.queryByTestId('home-free-plan-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when there is no customer at all', () => {
    currentCustomer = null;
    render(<FreePlanUpgradeBadge />);
    expect(
      screen.queryByTestId('home-free-plan-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing for a customer on a paid plan', () => {
    currentCustomer = paidCustomer();
    render(<FreePlanUpgradeBadge />);
    expect(
      screen.queryByTestId('home-free-plan-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing for a currently-trialing customer', () => {
    currentCustomer = trialingCustomer();
    render(<FreePlanUpgradeBadge />);
    expect(
      screen.queryByTestId('home-free-plan-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing inside the native store build (no purchase UI policy)', () => {
    nativeApp = true;
    render(<FreePlanUpgradeBadge />);
    expect(
      screen.queryByTestId('home-free-plan-badge'),
    ).not.toBeInTheDocument();
  });
});

describe('FreePlanUpgradeBadge upgrade dialog', () => {
  it('opens the pricing dialog on click and captures the CTA event', async () => {
    const user = userEvent.setup();
    render(<FreePlanUpgradeBadge />);

    expect(screen.queryByTestId('home-upgrade-dialog')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('home-upgrade-button'));

    expect(screen.getByTestId('home-upgrade-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-table')).toBeInTheDocument();
    expect(captureMock).toHaveBeenCalledWith('plan_cta_clicked', {
      product_id: 'none',
      source: 'home_header',
    });
  });
});
