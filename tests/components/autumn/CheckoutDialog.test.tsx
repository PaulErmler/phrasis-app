import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CheckoutDialog from '@/components/autumn/checkout-dialog';
import type { CheckoutDialogProps } from '@/components/autumn/checkout-dialog';

const attachMock = vi.fn();
const refetchMock = vi.fn();
const refetchPricingTableMock = vi.fn();
// Swapped per test — the trial state derived from this customer decides
// whether confirm bills through attach() or the Convex trial-switch action.
let currentCustomer: Record<string, unknown> | null = null;
vi.mock('autumn-js/react', () => ({
  useCustomer: () => ({
    attach: (...args: unknown[]) => attachMock(...args),
    customer: currentCustomer,
    refetch: (...args: unknown[]) => refetchMock(...args),
    checkout: vi.fn(),
  }),
  usePricingTable: () => ({
    refetch: (...args: unknown[]) => refetchPricingTableMock(...args),
  }),
}));

const switchPlanMock = vi.fn();
vi.mock('convex/react', () => ({
  useAction: () => (...args: unknown[]) => switchPlanMock(...args),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const TRIAL_ENDS_AT = Date.now() + 5 * 24 * 3_600_000;

/**
 * v1.2-shaped customers (autumn-js pins x-api-version 1.2): a trialing
 * plan reports status "trialing" with the trial end in current_period_end.
 */
const trialingCustomer = () => ({
  products: [
    { id: 'basic', status: 'trialing', current_period_end: TRIAL_ENDS_AT },
  ],
  trials_used: [{ product_id: 'basic' }],
});

// Trialed in the past, now on a regular paid plan — the population where a
// phantom cross-plan trial (or a fresh one) must never be offered again.
const paidNonTrialCustomer = () => ({
  products: [{ id: 'basic', status: 'active' }],
  trials_used: [{ product_id: 'basic' }],
});

function checkoutResult(
  productOverrides: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    product: {
      id: 'pro',
      name: 'Pro',
      scenario: 'upgrade',
      properties: {
        is_free: false,
        is_one_off: false,
        has_trial: false,
        updateable: false,
      },
      items: [
        {
          type: 'price',
          price: 10,
          display: { primary_text: '$10.00', secondary_text: 'per month' },
        },
      ],
      ...productOverrides,
    },
    current_product: { id: 'basic', name: 'Basic' },
    options: [],
    lines: [],
    has_prorations: false,
    total: 10,
    currency: 'usd',
    next_cycle: undefined,
    ...overrides,
  } as unknown as CheckoutDialogProps['checkoutResult'];
}

function renderDialog(result: CheckoutDialogProps['checkoutResult']) {
  const setOpen = vi.fn();
  render(<CheckoutDialog open={true} setOpen={setOpen} checkoutResult={result} />);
  return { setOpen };
}

const confirm = () =>
  userEvent.click(screen.getByTestId('checkout-dialog-confirm'));

/** jsdom refuses real navigation; capture the assignment instead. */
function captureLocationHref() {
  const assigned: string[] = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      set href(v: string) {
        assigned.push(v);
      },
      get href() {
        return 'http://localhost/app';
      },
    },
  });
  return assigned;
}

const realLocation = window.location;

beforeEach(() => {
  currentCustomer = paidNonTrialCustomer();
  attachMock.mockReset();
  attachMock.mockResolvedValue({ data: {}, error: null });
  refetchMock.mockReset();
  refetchMock.mockResolvedValue(null);
  refetchPricingTableMock.mockReset();
  refetchPricingTableMock.mockResolvedValue(null);
  switchPlanMock.mockReset();
  switchPlanMock.mockResolvedValue({
    mode: 'immediate',
    trialEndsAt: TRIAL_ENDS_AT,
    paymentUrl: null,
  });
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  // The component's own catch logs the failure; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.error).mockRestore();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('CheckoutDialog', () => {
  it('non-trial confirm attaches with freeTrial:false and closes', async () => {
    // freeTrial:false is the money guard: without it Autumn would grant a
    // phantom cross-plan trial (preview AND charge), letting a previously
    // trialed customer plan-hop through endless free weeks.
    const { setOpen } = renderDialog(
      checkoutResult(
        {},
        { options: [{ feature_id: 'seats', quantity: 2 }] },
      ),
    );
    await confirm();

    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(false));
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledWith({
      productId: 'pro',
      freeTrial: false,
      options: [{ featureId: 'seats', quantity: 2 }],
    });
    // The trial-switch action must stay out of non-trial checkouts — it
    // would throw ("No active trial") and block a perfectly payable order.
    expect(switchPlanMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('trialing plan switch routes through the Convex action, not attach', async () => {
    // A plain attach during a trial hits the server-side trial gate (or,
    // ungated, would end the running trial and bill immediately) — the
    // Convex action is the only path that carries the trial over.
    currentCustomer = trialingCustomer();
    const { setOpen } = renderDialog(checkoutResult({ scenario: 'upgrade' }));
    await confirm();

    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(false));
    expect(switchPlanMock).toHaveBeenCalledTimes(1);
    expect(switchPlanMock).toHaveBeenCalledWith({ productId: 'pro' });
    expect(attachMock).not.toHaveBeenCalled();
    // The action bypasses attach()'s internal SWR refetches, so the dialog
    // must refresh both the customer and the pricing-table scenarios —
    // otherwise the table still shows the pre-switch CTA (e.g. "Cancel")
    // and invites a second, conflicting billing action.
    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(refetchPricingTableMock).toHaveBeenCalledTimes(1);
  });

  // The isTrialSwitch routing table must mirror the scenarios accepted by
  // convex/billing.ts switchPlanDuringTrial — nothing else pins that
  // correspondence. A row drifting to "attach" bills a trialing customer
  // early; drifting to "action" makes the server reject a valid checkout.
  const routingTable: Array<{
    name: string;
    scenario: string;
    is_free: boolean;
    is_one_off?: boolean;
    route: 'action' | 'attach';
  }> = [
    { name: 'paid upgrade', scenario: 'upgrade', is_free: false, route: 'action' },
    { name: 'paid downgrade', scenario: 'downgrade', is_free: false, route: 'action' },
    { name: 'paid new', scenario: 'new', is_free: false, route: 'action' },
    // "renew" = re-attaching the trialing plan to un-schedule a pending
    // switch; a raw attach would instead restart billing on the spot.
    { name: 'paid renew', scenario: 'renew', is_free: false, route: 'action' },
    // Free targets are scheduled at trial end like any downgrade (Autumn
    // classifies free/default as "downgrade" or "cancel").
    { name: 'free downgrade', scenario: 'downgrade', is_free: true, route: 'action' },
    { name: 'free cancel', scenario: 'cancel', is_free: true, route: 'action' },
    // One-off purchases are bolt-ons, not subscriptions — they must not be
    // rerouted into the subscription-switch action mid-trial.
    { name: 'one-off purchase', scenario: 'new', is_free: false, is_one_off: true, route: 'attach' },
    // A free non-downgrade target is outside the action's accepted set
    // (the server throws on it) — it stays on the plain attach path.
    { name: 'free enable (new)', scenario: 'new', is_free: true, route: 'attach' },
  ];

  it.each(routingTable)(
    'while trialing, $name confirms via $route',
    async ({ scenario, is_free, is_one_off, route }) => {
      currentCustomer = trialingCustomer();
      const { setOpen } = renderDialog(
        checkoutResult({
          scenario,
          properties: {
            is_free,
            is_one_off: is_one_off === true,
            has_trial: false,
            updateable: false,
          },
        }),
      );
      await confirm();

      await waitFor(() => expect(setOpen).toHaveBeenCalledWith(false));
      if (route === 'action') {
        expect(switchPlanMock).toHaveBeenCalledWith({ productId: 'pro' });
        expect(attachMock).not.toHaveBeenCalled();
      } else {
        expect(attachMock).toHaveBeenCalledTimes(1);
        expect(switchPlanMock).not.toHaveBeenCalled();
        // checkoutTrialParams contract: a trialing customer must never send
        // freeTrial:false — that would end the running trial and bill now.
        expect(attachMock.mock.calls[0][0]).not.toHaveProperty('freeTrial');
      }
    },
  );

  it('surfaces an attach rejection instead of silently closing', async () => {
    // A silently-reset dialog looks like nothing happened — this is exactly
    // how the trial-gate rejection was hidden before (the user believed the
    // plan changed when no money moved).
    attachMock.mockRejectedValue(new Error('trial gate rejected'));
    const { setOpen } = renderDialog(checkoutResult());
    await confirm();

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('confirmError'));
    expect(setOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId('checkout-dialog-title')).toBeInTheDocument();
    // The spinner must reset so the user can retry (or pick another plan).
    expect(screen.getByTestId('checkout-dialog-confirm')).toBeEnabled();
  });

  it('surfaces a trial-switch rejection the same way', async () => {
    currentCustomer = trialingCustomer();
    switchPlanMock.mockRejectedValue(new Error('scenario not applicable'));
    const { setOpen } = renderDialog(checkoutResult({ scenario: 'upgrade' }));
    await confirm();

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('confirmError'));
    expect(setOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId('checkout-dialog-confirm')).toBeEnabled();
  });

  it('redirects to paymentUrl when the trial switch needs payment action', async () => {
    // Card is normally on file during a trial; when Autumn still demands
    // payment action, NOT redirecting would leave the switch half-applied
    // with the customer unaware anything is owed.
    currentCustomer = trialingCustomer();
    const url = 'https://checkout.stripe.com/pay/cs_123';
    switchPlanMock.mockResolvedValue({
      mode: 'immediate',
      trialEndsAt: TRIAL_ENDS_AT,
      paymentUrl: url,
    });
    const assigned = captureLocationHref();

    const { setOpen } = renderDialog(checkoutResult({ scenario: 'upgrade' }));
    await confirm();

    await waitFor(() => expect(assigned).toEqual([url]));
    // The confirm handler returns before closing — the page is navigating
    // away, and closing first would flash the app behind the redirect.
    expect(setOpen).not.toHaveBeenCalled();
    expect(refetchMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
