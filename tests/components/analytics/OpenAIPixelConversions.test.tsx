import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: 'granted' as 'granted' | 'denied' | 'pending' | 'initializing',
  native: false,
  user: null as Record<string, unknown> | null | undefined,
  customer: null as Record<string, unknown> | null,
  measure: vi.fn((..._args: unknown[]) => true),
  load: vi.fn(),
  fired: new Set<string>(),
  checkoutMarker: null as string | null,
  clearMarker: vi.fn(),
}));

vi.mock('@/lib/posthog/consent', () => ({
  useConsentStatus: () => mocks.status,
}));
vi.mock('@/hooks/use-native-app', () => ({
  useIsNativeApp: () => mocks.native,
}));
vi.mock('convex/react', () => ({
  useQuery: () => mocks.user,
}));
vi.mock('autumn-js/react', () => ({
  useCustomer: () => ({ customer: mocks.customer, isLoading: false }),
}));
vi.mock('@/lib/openai-pixel', () => ({
  loadOpenAIPixel: () => mocks.load(),
  measureConversion: (...args: unknown[]) => mocks.measure(...args),
  hasFired: (id: string) => mocks.fired.has(id),
  markFired: (id: string) => {
    mocks.fired.add(id);
  },
  readCheckoutMarker: () => mocks.checkoutMarker,
  clearCheckoutMarker: () => {
    mocks.clearMarker();
    mocks.checkoutMarker = null;
  },
}));

import {
  FRESH_SIGNUP_WINDOW_MS,
  OpenAIPixelConversions,
} from '@/components/analytics/OpenAIPixelConversions';

const NOW = new Date('2026-09-01T10:00:00Z').getTime();

const freshUser = () => ({ _id: 'u1', createdAt: NOW - 5 * 60_000 });
const oldUser = () => ({
  _id: 'u2',
  createdAt: NOW - FRESH_SIGNUP_WINDOW_MS - 1,
});

/** v1.2-shaped Autumn payloads, same as the pricing-table tests use. */
const freeCustomer = () => ({
  products: [{ id: 'free', status: 'active', is_default: true }],
});
const paidCustomer = () => ({
  products: [
    { id: 'free', status: 'active', is_default: true },
    { id: 'pro', status: 'active' },
  ],
});
const trialingCustomer = () => ({
  products: [
    { id: 'free', status: 'active', is_default: true },
    { id: 'pro', status: 'trialing', trial_ends_at: NOW + 7 * 86_400_000 },
  ],
});

describe('OpenAIPixelConversions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.status = 'granted';
    mocks.native = false;
    mocks.user = freshUser();
    mocks.customer = freeCustomer();
    mocks.measure.mockClear();
    mocks.load.mockClear();
    mocks.measure.mockReturnValue(true);
    mocks.fired.clear();
    mocks.checkoutMarker = null;
    mocks.clearMarker.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a fresh signup once, keyed for cross-channel dedupe', () => {
    const { rerender } = render(<OpenAIPixelConversions />);
    expect(mocks.measure).toHaveBeenCalledTimes(1);
    expect(mocks.measure).toHaveBeenCalledWith(
      'registration_completed',
      { type: 'customer_action' },
      { event_id: 'registration:u1' },
    );

    rerender(<OpenAIPixelConversions />);
    expect(mocks.measure).toHaveBeenCalledTimes(1);
  });

  it('loads the pixel itself before measuring, so effect order cannot drop an event', () => {
    // This component sits inside the root layout's children while
    // OpenAIPixel is a later sibling, so on the consent flip React runs this
    // effect first. Measuring against an unloaded pixel would return false
    // and the effect deps would never change again.
    render(<OpenAIPixelConversions />);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.load.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.measure.mock.invocationCallOrder[0],
    );
  });

  it('does not report an account older than the signup window', () => {
    mocks.user = oldUser();
    render(<OpenAIPixelConversions />);
    expect(mocks.measure).not.toHaveBeenCalled();
  });

  it('stays silent without consent, in the native shell, or signed out', () => {
    mocks.status = 'pending';
    render(<OpenAIPixelConversions />);
    mocks.status = 'denied';
    render(<OpenAIPixelConversions />);
    mocks.status = 'granted';
    mocks.native = true;
    render(<OpenAIPixelConversions />);
    mocks.native = false;
    mocks.user = null;
    render(<OpenAIPixelConversions />);
    expect(mocks.measure).not.toHaveBeenCalled();
  });

  it('does not re-mark an event the pixel refused', () => {
    mocks.measure.mockReturnValue(false);
    const { rerender } = render(<OpenAIPixelConversions />);
    expect(mocks.fired.has('registration:u1')).toBe(false);
    mocks.measure.mockReturnValue(true);
    rerender(<OpenAIPixelConversions />);
    // Still deduped by the effect deps, but a later mount would retry.
    expect(mocks.measure).toHaveBeenCalledTimes(1);
  });

  it('reports subscription_created for a paid plan only behind a checkout marker', () => {
    mocks.user = oldUser();
    mocks.customer = paidCustomer();

    render(<OpenAIPixelConversions />);
    expect(mocks.measure).not.toHaveBeenCalled();

    mocks.checkoutMarker = 'pro';
    render(<OpenAIPixelConversions />);
    expect(mocks.measure).toHaveBeenCalledWith(
      'subscription_created',
      { type: 'plan_enrollment', plan_id: 'pro' },
      { event_id: 'subscription:u2:pro' },
    );
    expect(mocks.clearMarker).toHaveBeenCalledTimes(1);
  });

  it('reports trial_started for a trialing plan', () => {
    mocks.user = oldUser();
    mocks.customer = trialingCustomer();
    mocks.checkoutMarker = 'pro';
    render(<OpenAIPixelConversions />);
    expect(mocks.measure).toHaveBeenCalledWith(
      'trial_started',
      { type: 'plan_enrollment', plan_id: 'pro' },
      { event_id: 'trial:u2:pro' },
    );
  });

  it('ignores a paid plan the marker did not point at', () => {
    // An existing subscriber starts an upgrade checkout, abandons it and
    // comes back: the plan they already had must not read as a conversion.
    mocks.user = oldUser();
    mocks.customer = paidCustomer();
    mocks.checkoutMarker = 'basic';
    render(<OpenAIPixelConversions />);
    expect(mocks.measure).not.toHaveBeenCalled();
    expect(mocks.clearMarker).not.toHaveBeenCalled();
    expect(mocks.checkoutMarker).toBe('basic');
  });

  it('keeps the marker while Autumn has not attached the plan yet', () => {
    mocks.user = oldUser();
    mocks.customer = freeCustomer();
    mocks.checkoutMarker = 'pro';
    render(<OpenAIPixelConversions />);
    expect(mocks.measure).not.toHaveBeenCalled();
    expect(mocks.clearMarker).not.toHaveBeenCalled();
    expect(mocks.checkoutMarker).toBe('pro');
  });
});
