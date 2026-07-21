import { describe, it, expect } from 'vitest';
import type { CheckoutResult } from 'autumn-js';
import { getCheckoutContent } from '@/lib/autumn/checkout-content';
import type { TrialState } from '@/lib/autumn/trial-eligibility';

/** Translate stub: returns the key so assertions can match on key names. */
const t = (key: string) => key;

const TRIAL_END = new Date('2026-08-01T12:00:00Z').getTime();

const onTrialState: TrialState = {
  everTrialed: true,
  onTrial: true,
  trialEndsAt: TRIAL_END,
  hasPaidPlan: true,
  trialEligible: false,
};

const notOnTrialState: TrialState = {
  everTrialed: true,
  onTrial: false,
  trialEndsAt: undefined,
  hasPaidPlan: true,
  trialEligible: false,
};

function makeCheckoutResult(overrides: {
  scenario: string;
  is_free?: boolean;
  is_one_off?: boolean;
  has_trial?: boolean;
  updateable?: boolean;
  next_cycle_starts_at?: number;
}): CheckoutResult {
  return {
    product: {
      id: overrides.is_free ? 'free' : 'pro_annual',
      name: overrides.is_free ? 'Free' : 'Pro Annual',
      scenario: overrides.scenario,
      properties: {
        is_free: overrides.is_free ?? false,
        is_one_off: overrides.is_one_off ?? false,
        has_trial: overrides.has_trial ?? false,
        updateable: overrides.updateable ?? false,
      },
    },
    current_product: { id: 'basic_annual', name: 'Basic Annual' },
    next_cycle: {
      starts_at: overrides.next_cycle_starts_at ?? TRIAL_END,
      total: 0,
    },
    options: [],
  } as unknown as CheckoutResult;
}

describe('getCheckoutContent — trialing user', () => {
  // Regression: a trialing user selecting the Free plan used to fall
  // through to the generic downgrade/cancel copy (and, in the dialog, to a
  // raw attach that the server trial gate rejects). Free during a trial is
  // scheduled at trial end; Autumn classifies the free/default target as
  // "downgrade" or "cancel" depending on version — both must map to the
  // dedicated copy.
  it.each(['downgrade', 'cancel'])(
    'free target with scenario "%s" gets the trialFreeScheduled copy',
    (scenario) => {
      const content = getCheckoutContent(
        makeCheckoutResult({ scenario, is_free: true }),
        t,
        onTrialState,
      );
      expect(content.title).toBe('trialFreeScheduledTitle');
      expect(content.message).toBe('trialFreeScheduledMessage');
    },
  );

  it('paid downgrade keeps the trialContinueScheduled copy', () => {
    const content = getCheckoutContent(
      makeCheckoutResult({ scenario: 'downgrade' }),
      t,
      onTrialState,
    );
    expect(content.title).toBe('trialContinueScheduledTitle');
    expect(content.message).toBe('trialContinueScheduledMessage');
  });

  it.each(['upgrade', 'new'])(
    'paid "%s" keeps the trialContinueSwitchNow copy',
    (scenario) => {
      const content = getCheckoutContent(
        makeCheckoutResult({ scenario }),
        t,
        onTrialState,
      );
      expect(content.title).toBe('trialContinueSwitchNowTitle');
      expect(content.message).toBe('trialContinueSwitchNowMessage');
    },
  );

  // Renewing (re-attaching the trialing plan to un-schedule a pending
  // switch) deliberately keeps the generic renew copy — it is accurate:
  // nothing is charged and no fresh trial starts. The dialog still routes
  // the confirm through switchPlanDuringTrial (see isTrialSwitch).
  it('paid "renew" keeps the generic renew copy', () => {
    const content = getCheckoutContent(
      makeCheckoutResult({ scenario: 'renew' }),
      t,
      onTrialState,
    );
    expect(content.title).toBe('renewTitle');
    expect(content.message).toBe('renewMessage');
  });

  it('free target with an unexpected scenario falls through to generic copy', () => {
    const content = getCheckoutContent(
      makeCheckoutResult({ scenario: 'renew', is_free: true }),
      t,
      onTrialState,
    );
    expect(content.title).toBe('renewTitle');
  });
});

describe('getCheckoutContent — period-end-anchored dates', () => {
  // Regression: Autumn's v1.2 checkout preview returns next_cycle.starts_at
  // one year early for annual plans (the current period START). The copy
  // for scenarios that take effect at period end must prefer the
  // customer's own current_period_end when provided.
  const PERIOD_START_2026 = new Date('2026-07-11T12:00:00Z').getTime();
  const PERIOD_END_2027 = new Date('2027-07-11T12:00:00Z').getTime();
  const correctDate = new Date(PERIOD_END_2027).toLocaleDateString('en');
  const previewDate = new Date(PERIOD_START_2026).toLocaleDateString('en');

  /** Translate stub that also exposes the date param. */
  const tDate = (key: string, params?: Record<string, string | number>) =>
    params?.date !== undefined ? `${key}|${params.date}` : key;

  it.each(['cancel', 'downgrade', 'scheduled'])(
    '"%s" message uses the customer period end over the preview next_cycle',
    (scenario) => {
      const content = getCheckoutContent(
        makeCheckoutResult({
          scenario,
          is_free: scenario === 'cancel',
          next_cycle_starts_at: PERIOD_START_2026,
        }),
        tDate,
        notOnTrialState,
        { currentPeriodEndsAt: PERIOD_END_2027, locale: 'en' },
      );
      expect(content.message).toContain(`|${correctDate}`);
      expect(content.message).not.toContain(previewDate);
    },
  );

  it('falls back to the preview next_cycle when no period end is known', () => {
    const content = getCheckoutContent(
      makeCheckoutResult({
        scenario: 'cancel',
        is_free: true,
        next_cycle_starts_at: PERIOD_START_2026,
      }),
      tDate,
      notOnTrialState,
      { locale: 'en' },
    );
    expect(content.message).toBe(`cancelMessage|${previewDate}`);
  });

  it('start-trial copy keeps the preview next_cycle (the trial end)', () => {
    const trialEligibleState: TrialState = {
      everTrialed: false,
      onTrial: false,
      trialEndsAt: undefined,
      hasPaidPlan: false,
      trialEligible: true,
    };
    const content = getCheckoutContent(
      makeCheckoutResult({
        scenario: 'new',
        has_trial: true,
        next_cycle_starts_at: PERIOD_START_2026,
      }),
      tDate,
      trialEligibleState,
      { currentPeriodEndsAt: PERIOD_END_2027, locale: 'en' },
    );
    expect(content.message).toBe(`startTrialMessage|${previewDate}`);
  });
});

describe('getCheckoutContent — not trialing', () => {
  it('free downgrade gets the generic downgrade copy, not trial copy', () => {
    const content = getCheckoutContent(
      makeCheckoutResult({ scenario: 'downgrade', is_free: true }),
      t,
      notOnTrialState,
    );
    expect(content.title).toBe('downgradeTitle');
  });

  it('free cancel gets the generic cancel copy, not trial copy', () => {
    const content = getCheckoutContent(
      makeCheckoutResult({ scenario: 'cancel', is_free: true }),
      t,
      notOnTrialState,
    );
    expect(content.title).toBe('cancelTitle');
  });
});
