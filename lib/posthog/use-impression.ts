'use client';

import { useEffect, useRef } from 'react';

import { CLIENT_EVENTS, capture, type ClientEvent } from './events';

/**
 * Fire an event once per transition into `open`, not once per render.
 *
 * The dialogs this is used by re-render whenever an Autumn query settles, so a
 * naive `if (open) capture(...)` inflates the impression count, which is the
 * denominator of every conversion rate on the monetization dashboard. Edge
 * triggering keeps "shown once" meaning shown once.
 */
export function useImpression(
  event: ClientEvent,
  open: boolean,
  properties?: Record<string, unknown>,
): void {
  const wasOpen = useRef(false);
  // Kept in a ref so changing property values don't re-fire the effect; the
  // values captured are the ones current at the moment the dialog opened.
  const latestProperties = useRef(properties);
  latestProperties.current = properties;

  useEffect(() => {
    if (open && !wasOpen.current) {
      capture(event, latestProperties.current);
    }
    wasOpen.current = open;
  }, [open, event]);
}

/** Paywall impression, keyed by the feature that triggered it. */
export function usePaywallImpression(open: boolean, featureId: string): void {
  useImpression(CLIENT_EVENTS.PAYWALL_SHOWN, open, { feature_id: featureId });
}
