'use client';

import { useEffect } from 'react';

import { useIsNativeApp } from '@/hooks/use-native-app';
import { syncOpenAIPixelConsent } from '@/lib/openai-pixel';
import { useConsentStatus } from '@/lib/posthog/consent';

/**
 * Loads the OpenAI Ads pixel the moment the visitor grants analytics consent,
 * and tells it to stop (and delete its cookies) on a later revoke.
 *
 * PostHog owns the consent record; this component just observes it, so every
 * surface that can change the answer (banner, settings dialog, footer link)
 * is covered without hooking any button. 'pending' and 'initializing' do
 * nothing: no grant, no script. Renders nothing; mount once in the root
 * layout so the landing page, where the ad click arrives, is covered.
 *
 * Skipped in the Capacitor store shell: those builds carry no purchase UI,
 * and an ad-attribution SDK has no business in a native WebView.
 */
export function OpenAIPixel() {
  const status = useConsentStatus();
  const isNative = useIsNativeApp();

  useEffect(() => {
    if (isNative) return;
    if (status === 'granted') syncOpenAIPixelConsent(true);
    else if (status === 'denied') syncOpenAIPixelConsent(false);
  }, [status, isNative]);

  return null;
}
