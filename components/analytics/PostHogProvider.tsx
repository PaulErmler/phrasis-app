'use client';

import { useEffect } from 'react';
import { PostHogProvider as PHProvider } from '@posthog/react';

import { initPostHogClient, posthog } from '@/lib/posthog/client';
import { notifyConsentReady } from '@/lib/posthog/consent';

/**
 * Boots posthog-js on the client and exposes it through context so
 * `usePostHog()` works anywhere below.
 *
 * Initialization happens in an effect, not at module scope: `posthog.init`
 * touches `window`, and this provider wraps the whole tree including
 * server-rendered content.
 *
 * `notifyConsentReady()` is what makes the banner appear. Local state here
 * would not: `children` is a stable element passed down from the layout, so a
 * re-render of this component does not propagate into the subtree that reads
 * the consent snapshot.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHogClient();
    notifyConsentReady();
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
