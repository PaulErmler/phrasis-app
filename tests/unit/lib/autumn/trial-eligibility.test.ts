import { describe, it, expect } from 'vitest';
import {
  getTrialState,
  findCurrentPaidProduct,
  checkoutTrialParams,
} from '@/lib/autumn/trial-eligibility';

/**
 * Characterization tests: these pin the behaviour of the trial gate BEFORE it
 * is refactored onto the shared normalizer, so the refactor is provably
 * behaviour-preserving. They must keep passing unchanged afterwards.
 *
 * This module gates every checkout in the app — 1 server caller
 * (convex/autumn.ts gateTrialArgs) and 5 client callers (pricing table,
 * checkout dialog x2, paywall, low-quota) — and had no direct tests.
 *
 * Payloads are the v1.2 shape, which is what both callers actually receive:
 * the client SDK is pinned to 1.2, and convex/autumn.ts requests it explicitly.
 */

const paid = (over: Record<string, unknown> = {}) => ({
  id: 'basic_annual',
  status: 'active',
  is_default: false,
  is_add_on: false,
  ...over,
});

const freePlan = { id: 'free', status: 'active', is_default: true, is_add_on: false };
const addOn = { id: 'extra', status: 'active', is_default: false, is_add_on: true };

describe('getTrialState', () => {
  it('a brand-new customer with only the free plan is trial-eligible', () => {
    expect(getTrialState({ products: [freePlan], trials_used: [] })).toEqual({
      everTrialed: false,
      onTrial: false,
      trialEndsAt: undefined,
      hasPaidPlan: false,
      trialEligible: true,
    });
  });

  it('a customer with no products at all is trial-eligible', () => {
    expect(getTrialState({}).trialEligible).toBe(true);
    expect(getTrialState(null).trialEligible).toBe(true);
    expect(getTrialState(undefined).trialEligible).toBe(true);
  });

  it('detects a running trial and reads its end from current_period_end', () => {
    // v1.2 leaves trial_ends_at null while trialing and reports the end via
    // current_period_end — the exact quirk this helper exists to absorb.
    const state = getTrialState({
      products: [paid({ status: 'trialing', current_period_end: 1785687307000 })],
      trials_used: [],
    });
    expect(state.onTrial).toBe(true);
    expect(state.trialEndsAt).toBe(1785687307000);
    // A running trial implies "trialed", even without the trials_used expand.
    expect(state.everTrialed).toBe(true);
    expect(state.trialEligible).toBe(false);
  });

  it('prefers trial_ends_at when Autumn does populate it', () => {
    const state = getTrialState({
      products: [
        paid({ status: 'trialing', trial_ends_at: 111, current_period_end: 222 }),
      ],
      trials_used: [],
    });
    expect(state.trialEndsAt).toBe(111);
  });

  it('blocks trial-hopping: a past trial disqualifies even after cancelling', () => {
    // trials_used is the durable record; products only lists CURRENT ones, so
    // this is the case that stops basic -> pro -> basic_annual trial farming.
    const state = getTrialState({
      products: [freePlan],
      trials_used: [{ product_id: 'basic' }],
    });
    expect(state.everTrialed).toBe(true);
    expect(state.hasPaidPlan).toBe(false);
    expect(state.trialEligible).toBe(false);
  });

  it('an existing paying customer is not trial-eligible', () => {
    const state = getTrialState({ products: [freePlan, paid()], trials_used: [] });
    expect(state.hasPaidPlan).toBe(true);
    expect(state.onTrial).toBe(false);
    expect(state.trialEligible).toBe(false);
  });

  it('treats a GRANDFATHERED free plan (is_default:false) as free, not paid', () => {
    // Free attachments created under old product versions carry NO default
    // flag on v1.2 (live payload, 2026-08-11: a May-2026 customer's only
    // product was free/active/is_default:false). Reading that as a paid
    // plan sent the customer down the legacy checkout path — cardless →
    // Autumn minted a non-MoR session → the Managed Payments backstop
    // threw on their very first purchase attempt.
    const grandfatheredFree = {
      id: 'free',
      status: 'active',
      is_default: false,
      is_add_on: false,
    };
    const state = getTrialState({
      products: [grandfatheredFree],
      trials_used: [],
    });
    expect(state.hasPaidPlan).toBe(false);
    expect(state.trialEligible).toBe(true);
  });

  it('ignores expired entries — a lapsed customer is a first purchase again', () => {
    // A lapsed trial / executed cancel can leave the old plan in the
    // payload with status 'expired'; it is not a held plan.
    const state = getTrialState({
      products: [freePlan, paid({ status: 'expired' })],
      trials_used: [{ product_id: 'basic_annual' }],
    });
    expect(state.hasPaidPlan).toBe(false);
    expect(state.onTrial).toBe(false);
    // The durable trials_used record still blocks a second trial.
    expect(state.trialEligible).toBe(false);
  });

  it('an early-cancelled trial (expired, trial_ends_at still future) is not onTrial', () => {
    const state = getTrialState({
      products: [
        freePlan,
        paid({ status: 'expired', trial_ends_at: Date.now() + 86_400_000 }),
      ],
      trials_used: [{ product_id: 'basic_annual' }],
    });
    expect(state.onTrial).toBe(false);
    expect(state.hasPaidPlan).toBe(false);
  });

  it('a scheduled entry is a pending change, not a held plan', () => {
    const state = getTrialState({
      products: [freePlan, paid({ status: 'scheduled' })],
      trials_used: [],
    });
    expect(state.hasPaidPlan).toBe(false);
  });

  it('ignores the free plan and add-ons when deciding hasPaidPlan', () => {
    expect(
      getTrialState({ products: [freePlan, addOn], trials_used: [] }).hasPaidPlan,
    ).toBe(false);
  });

  it('does not treat a trialing add-on or free plan as a trial', () => {
    expect(
      getTrialState({
        products: [{ ...addOn, status: 'trialing' }],
        trials_used: [],
      }).onTrial,
    ).toBe(false);
    expect(
      getTrialState({
        products: [{ ...freePlan, status: 'trialing' }],
        trials_used: [],
      }).onTrial,
    ).toBe(false);
  });
});

describe('findCurrentPaidProduct', () => {
  // Returns a normalized AutumnPlan now, so the id is read as `planId`.
  // Which plan gets SELECTED — the assertions below — is unchanged.
  it('returns the paid plan, skipping free and add-ons', () => {
    expect(findCurrentPaidProduct([freePlan, addOn, paid()])?.planId).toBe(
      'basic_annual',
    );
  });

  it('excludes expired plans', () => {
    expect(findCurrentPaidProduct([paid({ status: 'expired' })])).toBeUndefined();
  });

  it('prefers the active plan over a scheduled one regardless of array order', () => {
    const result = findCurrentPaidProduct([
      paid({ id: 'next', status: 'scheduled' }),
      paid({ id: 'now', status: 'active' }),
    ]);
    expect(result?.planId).toBe('now');
  });

  it('falls back to the scheduled plan when it is the only candidate', () => {
    expect(
      findCurrentPaidProduct([paid({ id: 'next', status: 'scheduled' })])?.planId,
    ).toBe('next');
  });

  it('handles null/undefined/empty input', () => {
    expect(findCurrentPaidProduct(null)).toBeUndefined();
    expect(findCurrentPaidProduct(undefined)).toBeUndefined();
    expect(findCurrentPaidProduct([])).toBeUndefined();
  });
});

describe('checkoutTrialParams', () => {
  const state = (over: Record<string, unknown>) =>
    ({
      everTrialed: false,
      onTrial: false,
      trialEndsAt: undefined,
      hasPaidPlan: false,
      trialEligible: false,
      ...over,
    }) as Parameters<typeof checkoutTrialParams>[0];

  it('passes nothing for a trial-eligible user so Autumn starts the trial', () => {
    expect(checkoutTrialParams(state({ trialEligible: true }))).toEqual({});
  });

  it('passes nothing while on trial — freeTrial:false would bill immediately', () => {
    expect(checkoutTrialParams(state({ onTrial: true }))).toEqual({});
  });

  it('forces freeTrial:false for everyone else', () => {
    expect(checkoutTrialParams(state({}))).toEqual({ freeTrial: false });
    expect(
      checkoutTrialParams(state({ everTrialed: true, hasPaidPlan: true })),
    ).toEqual({ freeTrial: false });
  });
});
