'use client';

import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { useCustomer } from 'autumn-js/react';

import { api } from '@/convex/_generated/api';
import { useIsNativeApp } from '@/hooks/use-native-app';
import {
  findCurrentPaidPlan,
  normalizePlans,
  type AutumnCustomerLike,
} from '@/lib/autumn/customer-shape';
import {
  clearCheckoutMarker,
  hasFired,
  loadOpenAIPixel,
  markFired,
  measureConversion,
  readCheckoutMarker,
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
): void {
  if (hasFired(eventId)) return;
  loadOpenAIPixel();
  if (measureConversion(event, data, { event_id: eventId })) markFired(eventId);
}

/**
 * Reports the two conversions ChatGPT ad campaigns are optimized on.
 *
 * - `registration_completed`: the signed-in user's account was created within
 *   the last 24 hours. Covers every signup path (email + OTP, Google, Apple)
 *   because it reads the account, not the form.
 * - `subscription_created` / `trial_started`: a paid Autumn plan is present
 *   AND a checkout was started from this browser recently (see
 *   `markCheckoutStarted`). The marker is what stops long-time subscribers
 *   from being counted on their first app open after deploy.
 *
 * Every effect re-runs when consent flips to granted, so a registration made
 * before the banner was accepted still reports. Subscriptions do not get that
 * grace: the checkout marker is only written after consent, so a checkout
 * started before accepting is unattributed. Renders nothing; mount once
 * inside the authenticated boundary next to `PostHogIdentify`.
 */
export function OpenAIPixelConversions() {
  const status = useConsentStatus();
  const isNative = useIsNativeApp();
  const user = useQuery(api.auth.getAuthUser) as AuthUserLike;
  // Same arguments as FreePlanUpgradeBadge so autumn-js serves both from one
  // fetch instead of two.
  const { customer } = useCustomer({
    errorOnNotFound: false,
    expand: ['trials_used'],
  });

  const { userId, createdAt } = readUser(user);
  const armed = status === 'granted' && !isNative && userId !== null;

  useEffect(() => {
    if (!armed || createdAt === null) return;
    if (Date.now() - createdAt > FRESH_SIGNUP_WINDOW_MS) return;
    fireOnce(`registration:${userId}`, 'registration_completed', {
      type: 'customer_action',
    });
  }, [armed, userId, createdAt]);

  useEffect(() => {
    if (!armed || !customer) return;
    const checkoutPlanId = readCheckoutMarker();
    if (checkoutPlanId === null) return;
    const paid = findCurrentPaidPlan(
      normalizePlans(customer as AutumnCustomerLike),
    );
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
