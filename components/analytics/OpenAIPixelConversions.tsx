'use client';

import { useEffect } from 'react';
import { useQuery, usePreloadedQuery } from 'convex/react';
import { useCustomer } from 'autumn-js/react';

import { api } from '@/convex/_generated/api';
import { useAppData } from '@/components/app/AppDataProvider';
import { useIsNativeApp } from '@/hooks/use-native-app';
import {
  findCurrentPaidPlan,
  normalizePlans,
} from '@/lib/autumn/customer-shape';
import {
  clearCheckoutMarker,
  hasFired,
  loadOpenAIPixel,
  markFired,
  measureConversion,
  readCheckoutMarker,
  SIGNUP_CUSTOM_EVENT_NAME,
  type ConversionEvent,
} from '@/lib/openai-pixel';
import { useConsentStatus } from '@/lib/posthog/consent';

/**
 * A signup older than this is not a conversion the current visit produced.
 * Generous because the banner is non-modal: someone can sign up, ignore it,
 * and accept hours later on their first real session.
 */
export const FRESH_SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The Better Auth user document, as far as this component reads it. */
type AuthUserLike = { _id?: unknown; createdAt?: unknown } | null | undefined;

function readUser(user: AuthUserLike): {
  userId: string | null;
  createdAt: number | null;
} {
  const userId = user?._id ? String(user._id) : null;
  const createdAt = typeof user?.createdAt === 'number' ? user.createdAt : null;
  return { userId, createdAt };
}

/**
 * Fire once per device per `eventId`; the id doubles as the vendor-side
 * dedupe key.
 *
 * Loads the pixel first (idempotent). Callers only get here with consent
 * granted, and `OpenAIPixel` — the component that normally loads it — is a
 * later sibling of this one's layout subtree, so on the consent flip React
 * runs this effect before that one. Measuring against an unloaded pixel would
 * return false, and with unchanged deps the effect would never retry.
 */
function fireOnce(
  eventId: string,
  event: ConversionEvent,
  data: Record<string, unknown>,
  options?: { custom_event_name?: string },
): void {
  if (hasFired(eventId)) return;
  loadOpenAIPixel();
  if (measureConversion(event, data, { ...options, event_id: eventId })) {
    markFired(eventId);
  }
}

/**
 * Reports the conversions ChatGPT ad campaigns are optimized on.
 *
 * - `signup` (a custom event): the signed-in user's account was created
 *   within the last 24 hours. Reads the account, not the form, so it covers
 *   every signup path (email + OTP, Google, Apple).
 * - `registration_completed`: the signed-in user finished the onboarding
 *   wizard (`hasCompletedOnboarding`), on that same fresh account. The
 *   standard name goes to the stronger moment on purpose: an account that
 *   never picks a language pair is worth nothing, so it is finishing the
 *   wizard the campaigns optimize on. Reading the flag rather than hooking the
 *   wizard's finish handler means it still reports for someone who accepts
 *   the cookie banner afterwards, and a reload mid-finish cannot lose it.
 *   `finalizeOnboarding` flips the flag optimistically (see `OnboardingGuard`),
 *   so a mutation that then fails still reports; the user is bounced back into
 *   the wizard and finishing again is deduped by `event_id`.
 * - `subscription_created` / `trial_started`: a paid Autumn plan is present
 *   AND a checkout was started from this browser recently (see
 *   `markCheckoutStarted`). The marker is what stops long-time subscribers
 *   from being counted on their first app open after deploy.
 *
 * The 24 h account-age window on the first two is load-bearing: every
 * existing user is signed up and onboarded, so without it the first app open
 * after a deploy would report the whole user base as conversions.
 *
 * Every effect re-runs when consent flips to granted, so a signup or an
 * onboarding finished before the banner was accepted still reports.
 * Subscriptions do not get that grace: the checkout marker is only written
 * after consent, so a checkout started before accepting is unattributed.
 * Renders nothing; mount once inside the authenticated boundary next to
 * `PostHogIdentify`.
 */
export function OpenAIPixelConversions() {
  const status = useConsentStatus();
  const isNative = useIsNativeApp();
  const user = useQuery(api.auth.getAuthUser);
  // Same arguments as FreePlanUpgradeBadge so autumn-js serves both from one
  // fetch instead of two.
  const { customer } = useCustomer({
    errorOnNotFound: false,
    expand: ['trials_used'],
  });

  // The subscription this reads is AppDataProvider's, already live for every
  // /app route; `usePreloadedQuery` on the same handle costs nothing extra.
  const { preloadedSettings } = useAppData();
  const settings = usePreloadedQuery(preloadedSettings);

  const { userId, createdAt } = readUser(user);
  const hasCompletedOnboarding = settings?.hasCompletedOnboarding === true;
  const armed = status === 'granted' && !isNative && userId !== null;

  useEffect(() => {
    if (!armed || createdAt === null) return;
    if (Date.now() - createdAt > FRESH_SIGNUP_WINDOW_MS) return;
    fireOnce(
      `signup:${userId}`,
      'custom',
      { type: 'custom' },
      { custom_event_name: SIGNUP_CUSTOM_EVENT_NAME },
    );
  }, [armed, userId, createdAt]);

  useEffect(() => {
    if (!armed || createdAt === null || !hasCompletedOnboarding) return;
    if (Date.now() - createdAt > FRESH_SIGNUP_WINDOW_MS) return;
    fireOnce(`registration:${userId}`, 'registration_completed', {
      type: 'customer_action',
    });
  }, [armed, userId, createdAt, hasCompletedOnboarding]);

  useEffect(() => {
    if (!armed || !customer) return;
    const checkoutPlanId = readCheckoutMarker();
    if (checkoutPlanId === null) return;
    const paid = findCurrentPaidPlan(normalizePlans(customer));
    // Autumn may not have processed the Stripe webhook yet on the very first
    // load back; keep the marker and try again on the next customer refresh.
    // A paid plan OTHER than the one checked out is the same case from a
    // subscriber's side: their existing plan is not this checkout's outcome.
    if (!paid || paid.planId !== checkoutPlanId) return;

    if (paid.isTrialing) {
      fireOnce(`trial:${userId}:${paid.planId}`, 'trial_started', {
        type: 'plan_enrollment',
        plan_id: paid.planId,
      });
    } else {
      fireOnce(
        `subscription:${userId}:${paid.planId}`,
        'subscription_created',
        { type: 'plan_enrollment', plan_id: paid.planId },
      );
    }
    clearCheckoutMarker();
  }, [armed, userId, customer]);

  return null;
}
