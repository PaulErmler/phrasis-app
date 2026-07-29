'use client';

import { posthog } from './client';

/**
 * Client-side event names.
 *
 * Split from the backend list in `convex/analytics.ts` on purpose — these are
 * the events that only the browser can see (intent, navigation, UI state), plus
 * the ones the backend *cannot* record because they happen on a failed
 * transaction.
 *
 * That last point is subtle and worth stating: a Convex mutation that throws
 * rolls back everything it did, including any analytics event it scheduled. So
 * "the user hit their quota" can never be captured from inside the mutation
 * that rejected them — it has to be captured here, where the ConvexError is
 * caught.
 */
export const CLIENT_EVENTS = {
  REVIEW_SESSION_STARTED: 'review_session_started',
  /**
   * Fired when the learn overlay closes — which covers both "finished the
   * queue" and "gave up", so it is deliberately named for the transition rather
   * than an outcome we cannot actually observe from here.
   */
  REVIEW_SESSION_ENDED: 'review_session_ended',

  CHAT_MESSAGE_FAILED: 'chat_message_failed',

  QUOTA_EXHAUSTED: 'quota_exhausted',
  PAYWALL_SHOWN: 'paywall_shown',
  PLAN_CTA_CLICKED: 'plan_cta_clicked',
  CHECKOUT_REDIRECTED: 'checkout_redirected',
  CHECKOUT_FAILED: 'checkout_failed',
  PAYMENT_PAST_DUE_SHOWN: 'payment_past_due_shown',

  /** Carries `previous_step` + `previous_step_duration_ms`, so one event type
   *  yields both the drop-off funnel and per-step timing. */
  ONBOARDING_STEP_VIEWED: 'onboarding_step_viewed',
  ONBOARDING_FAILED: 'onboarding_failed',
  PLACEMENT_CONTENT_RETRY: 'placement_content_retry',

  TUTORIAL_STARTED: 'tutorial_started',
  TUTORIAL_COMPLETED: 'tutorial_completed',
  LOCALE_CHANGED: 'locale_changed',
  THEME_CHANGED: 'theme_changed',
  PWA_INSTALL_PROMPTED: 'pwa_install_prompted',
  /** The browser's `appinstalled` event — fires however the install started
   *  (our dialog, the omnibox icon, browser menu), Chromium-only. */
  PWA_INSTALLED: 'pwa_installed',
} as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];

/**
 * Capture a product event. Never throws — a broken analytics call must not
 * change what the user sees.
 */
export function capture(event: ClientEvent, properties?: Record<string, unknown>): void {
  try {
    posthog.capture(event, properties);
  } catch {
    // Intentionally silent: this is the one code path where logging an error
    // about failing to log an error helps nobody.
  }
}
