import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ready: false,
  status: 'pending' as 'granted' | 'denied' | 'pending',
  optIn: vi.fn(),
  optOut: vi.fn(),
}));

vi.mock('@/lib/posthog/client', () => ({
  isPostHogReady: () => mocks.ready,
  posthog: {
    get_explicit_consent_status: () => mocks.status,
    opt_in_capturing: mocks.optIn,
    opt_out_capturing: mocks.optOut,
  },
}));

import {
  denyConsent,
  grantConsent,
  notifyConsentReady,
  setConsent,
  subscribeToConsent,
  useConsentStatus,
} from '@/lib/posthog/consent';

describe('consent', () => {
  beforeEach(() => {
    mocks.ready = false;
    mocks.status = 'pending';
    mocks.optIn.mockClear();
    mocks.optOut.mockClear();
  });

  it('does nothing before the SDK is ready', () => {
    grantConsent();
    denyConsent();
    expect(mocks.optIn).not.toHaveBeenCalled();
    expect(mocks.optOut).not.toHaveBeenCalled();
  });

  it('opts in on accept', () => {
    mocks.ready = true;
    grantConsent();
    expect(mocks.optIn).toHaveBeenCalledTimes(1);
    expect(mocks.optOut).not.toHaveBeenCalled();
  });

  it('opts out on reject — which keeps cookieless capture running', () => {
    mocks.ready = true;
    denyConsent();
    expect(mocks.optOut).toHaveBeenCalledTimes(1);
    expect(mocks.optIn).not.toHaveBeenCalled();
  });

  it('routes setConsent to the matching side', () => {
    mocks.ready = true;
    setConsent(true);
    expect(mocks.optIn).toHaveBeenCalledTimes(1);
    setConsent(false);
    expect(mocks.optOut).toHaveBeenCalledTimes(1);
  });

  /**
   * The regression this exists for: the provider boots the SDK inside an
   * effect, but `children` is a stable element, so React does not re-render the
   * subtree that reads the consent snapshot. Without an explicit notification
   * the banner stays invisible forever and nobody is ever asked for consent.
   */
  it('notifies subscribers when the SDK becomes ready', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToConsent(listener);

    notifyConsentReady();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    notifyConsentReady();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when the user answers, so the banner can hide', () => {
    mocks.ready = true;
    const listener = vi.fn();
    const unsubscribe = subscribeToConsent(listener);

    grantConsent();
    expect(listener).toHaveBeenCalledTimes(1);
    denyConsent();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  /**
   * The pre-boot snapshot must be a value no real status can take. When it
   * impersonated 'granted', a user whose *stored* choice was granted saw
   * 'granted' → 'granted' across SDK boot — no snapshot change, no re-render —
   * and `ConsentSync` never mirrored the choice to `userSettings`, so chat
   * content was withheld for a user who had consented (the consent-before-signup
   * path, on every fresh page load).
   */
  it('reports initializing before boot, then surfaces a stored grant as a status change', () => {
    mocks.ready = false;
    mocks.status = 'granted';

    const { result } = renderHook(() => useConsentStatus());
    expect(result.current).toBe('initializing');

    act(() => {
      mocks.ready = true;
      notifyConsentReady();
    });
    expect(result.current).toBe('granted');
  });
});
