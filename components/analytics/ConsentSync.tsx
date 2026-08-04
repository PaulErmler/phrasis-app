'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { reconcileConsentOwner, useConsentStatus } from '@/lib/posthog/consent';

/**
 * Mirrors the browser's analytics-consent choice to `userSettings` so the
 * backend can honor it — chat cost events attach message content as
 * `$ai_input`, and the privacy policy promises that declining keeps that
 * content out of PostHog. The backend cannot read PostHog's device-side
 * consent record, so this is the bridge.
 *
 * Renders nothing; mount once inside the authenticated boundary, next to
 * `PostHogIdentify`. Covers every path a choice can be made on (banner,
 * settings dialog, footer link) and the consent-before-signup case, because it
 * observes the status rather than hooking the buttons.
 */
export function ConsentSync() {
  const status = useConsentStatus();
  const user = useQuery(api.auth.getAuthUser);
  const setAnalyticsConsent = useMutation(api.features.consent.setAnalyticsConsent);
  const lastSyncedRef = useRef<'granted' | 'denied' | null>(null);

  useEffect(() => {
    // 'initializing' (SDK not booted — and in key-less builds, forever) and
    // 'pending' (banner unanswered) both mean there is no choice to mirror.
    // The readiness gate lives in the status itself rather than a separate
    // `isPostHogReady()` check: this effect only re-runs when `status` changes,
    // so a non-reactive guard would silently skip a grant that was already
    // stored before this page load (initializing → granted IS a status change).
    if (status !== 'granted' && status !== 'denied') return;
    // The device's stored choice may belong to a previous user of a shared
    // browser (`resetPreservingConsent` keeps it across sign-out). Wait for
    // the auth user, then only mirror a choice this user owns — reconcile
    // clears a foreign choice back to pending (re-showing the banner) instead
    // of writing the predecessor's answer onto this account.
    if (!user?._id) return;
    if (!reconcileConsentOwner(String(user._id))) return;
    if (lastSyncedRef.current === status) return;

    lastSyncedRef.current = status;
    setAnalyticsConsent({ granted: status === 'granted' }).catch(() => {
      // Cleared so the next status change (or remount) retries. Fail-safe by
      // construction: the backend treats unset as declined, so a lost sync can
      // only withhold content, never leak it.
      lastSyncedRef.current = null;
    });
  }, [status, user, setAnalyticsConsent]);

  return null;
}
