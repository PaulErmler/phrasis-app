import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TrialState } from '@/lib/autumn/trial-eligibility';

const attachNewPlanMock = vi.fn();
const captureMock = vi.fn();

vi.mock('convex/react', () => ({
  useAction: () => attachNewPlanMock,
}));

vi.mock('@/convex/_generated/api', () => ({
  api: { billing: { attachNewPlan: 'attachNewPlan-ref' } },
}));

vi.mock('@/lib/posthog/events', () => ({
  CLIENT_EVENTS: { CHECKOUT_REDIRECTED: 'checkout_redirected' },
  capture: (...args: unknown[]) => captureMock(...args),
}));

// Imported (via use-checkout-error) but never exercised here.
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/report-error', () => ({ reportError: vi.fn() }));

import { useNewPlanCheckout } from '@/hooks/use-new-plan-checkout';

const trialState = (over: Partial<TrialState> = {}): TrialState => ({
  everTrialed: false,
  onTrial: false,
  trialEndsAt: undefined,
  hasPaidPlan: false,
  trialEligible: true,
  ...over,
});

const Dialog = () => null;

const renderCheckout = () => renderHook(() => useNewPlanCheckout()).result.current;

const realLocation = window.location;

/** jsdom refuses real navigation; capture href assignments instead. */
function captureHref() {
  const assigned: string[] = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...realLocation,
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

/**
 * First purchases must reach Autumn's v2 endpoint (hosted Stripe checkout on
 * an unpinned API version, Managed-Payments-safe) and must never touch
 * autumn-js `checkout()`; everything else stays on `checkout()` + dialog.
 * The routing is derived purely from the customer's own trial state.
 */
describe('useNewPlanCheckout', () => {
  beforeEach(() => {
    attachNewPlanMock.mockReset();
    captureMock.mockReset();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: realLocation,
    });
  });

  describe('isFirstPurchase', () => {
    it('is true exactly when the customer holds no paid plan and is not trialing', () => {
      const { isFirstPurchase } = renderCheckout();
      expect(isFirstPurchase(trialState())).toBe(true);
      // A lapsed customer (trialed before, nothing attached now) buys "first" again.
      expect(
        isFirstPurchase(trialState({ everTrialed: true, trialEligible: false })),
      ).toBe(true);
      expect(
        isFirstPurchase(trialState({ hasPaidPlan: true, trialEligible: false })),
      ).toBe(false);
      expect(
        isFirstPurchase(
          trialState({ onTrial: true, everTrialed: true, trialEligible: false }),
        ),
      ).toBe(false);
    });
  });

  describe('startNewPlanCheckout', () => {
    it('attaches the plan, captures the redirect event, and hands off to Stripe', async () => {
      attachNewPlanMock.mockResolvedValue({
        paymentUrl: 'https://stripe.test/session',
      });
      const hrefs = captureHref();
      const { startNewPlanCheckout } = renderCheckout();

      const out = await startNewPlanCheckout('basic', trialState());

      expect(attachNewPlanMock).toHaveBeenCalledWith({ productId: 'basic' });
      expect(captureMock).toHaveBeenCalledWith('checkout_redirected', {
        product_id: 'basic',
        flow: 'trial_start',
      });
      expect(hrefs).toEqual(['https://stripe.test/session']);
      expect(out).toEqual({ redirected: true });
    });

    it("labels the flow 'purchase' for a first buyer who is no longer trial-eligible", async () => {
      attachNewPlanMock.mockResolvedValue({ paymentUrl: 'https://stripe.test/x' });
      captureHref();
      const { startNewPlanCheckout } = renderCheckout();

      await startNewPlanCheckout(
        'pro',
        trialState({ everTrialed: true, trialEligible: false }),
      );

      expect(captureMock).toHaveBeenCalledWith(
        'checkout_redirected',
        expect.objectContaining({ flow: 'purchase' }),
      );
    });

    it('reports redirected: false and captures nothing without a payment URL', async () => {
      attachNewPlanMock.mockResolvedValue({ paymentUrl: null });
      const hrefs = captureHref();

      const out = await renderCheckout().startNewPlanCheckout(
        'basic',
        trialState(),
      );

      expect(out).toEqual({ redirected: false });
      expect(captureMock).not.toHaveBeenCalled();
      expect(hrefs).toEqual([]);
    });
  });

  describe('purchasePlan', () => {
    it('routes a first purchase through the v2 endpoint, never checkout()', async () => {
      attachNewPlanMock.mockResolvedValue({ paymentUrl: 'https://stripe.test/s' });
      captureHref();
      const checkout = vi.fn();

      await renderCheckout().purchasePlan({
        productId: 'basic',
        trialState: trialState(),
        checkout,
        dialog: Dialog,
      });

      expect(attachNewPlanMock).toHaveBeenCalledWith({ productId: 'basic' });
      expect(checkout).not.toHaveBeenCalled();
    });

    it('sends an existing paid customer through checkout() with freeTrial: false', async () => {
      const checkout = vi.fn().mockResolvedValue({ data: {}, error: null });

      await renderCheckout().purchasePlan({
        productId: 'pro',
        trialState: trialState({ hasPaidPlan: true, trialEligible: false }),
        checkout,
        dialog: Dialog,
      });

      expect(checkout).toHaveBeenCalledWith({
        productId: 'pro',
        dialog: Dialog,
        freeTrial: false,
      });
      expect(attachNewPlanMock).not.toHaveBeenCalled();
    });

    it('omits freeTrial for a trialing customer, whose running trial must survive', async () => {
      const checkout = vi.fn().mockResolvedValue({ data: {}, error: null });

      await renderCheckout().purchasePlan({
        productId: 'pro',
        trialState: trialState({
          onTrial: true,
          everTrialed: true,
          trialEligible: false,
        }),
        checkout,
        dialog: Dialog,
      });

      expect(checkout).toHaveBeenCalledWith({ productId: 'pro', dialog: Dialog });
    });

    it('treats a Free-plan target as cancel/downgrade: checkout() even for a first-time buyer', async () => {
      const checkout = vi.fn().mockResolvedValue({ data: {}, error: null });

      await renderCheckout().purchasePlan({
        productId: 'free',
        trialState: trialState(),
        checkout,
        dialog: Dialog,
        freeTarget: true,
      });

      expect(checkout).toHaveBeenCalledWith({ productId: 'free', dialog: Dialog });
      expect(attachNewPlanMock).not.toHaveBeenCalled();
    });

    it("surfaces autumn-js's resolved { error } container as a throw", async () => {
      const checkout = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'trial gate' } });

      await expect(
        renderCheckout().purchasePlan({
          productId: 'pro',
          trialState: trialState({ hasPaidPlan: true, trialEligible: false }),
          checkout,
          dialog: Dialog,
        }),
      ).rejects.toThrow(/trial gate/);
    });
  });
});
