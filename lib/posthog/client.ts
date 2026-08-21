'use client';

import posthog from 'posthog-js';

import { POSTHOG_API_HOST, POSTHOG_KEY, POSTHOG_UI_HOST } from './hosts';

/**
 * Attribute that hides an element's text from session replay. Masking runs in
 * the browser, so anything marked here never leaves the device.
 *
 * @see components/app/SettingsView.tsx, components/admin/UsersTable.tsx
 */
export const PH_MASK_ATTR = 'data-ph-mask';

/** Attribute that blocks an element from replay entirely (rendered as a placeholder box). */
export const PH_BLOCK_ATTR = 'data-ph-block';

let initialized = false;

/**
 * Boot the browser SDK. Idempotent, and a no-op when no project key is
 * configured. Local dev and CI builds run without one and must not crash.
 *
 * Must be called from a client component effect rather than at module scope:
 * `posthog.init` touches `window` and `document`, which do not exist while Next
 * renders on the server.
 */
export function initPostHogClient(): void {
  if (initialized || typeof window === 'undefined') return;
  if (!POSTHOG_KEY) return;

  posthog.init(POSTHOG_KEY, {
    // First-party path. See the `rewrites` block in next.config.ts. Pointing
    // straight at eu.i.posthog.com would lose every user running an ad blocker.
    api_host: POSTHOG_API_HOST,
    ui_host: POSTHOG_UI_HOST,
    defaults: '2026-06-25',

    /**
     * No cookies, localStorage or sessionStorage are touched until the user
     * answers the banner. If they reject, PostHog keeps capturing but derives
     * identity from a daily-rotated server-side hash instead of device storage,
     * which is outside TTDSG §25 entirely, so onboarding funnels and error
     * rates stay measurable for people who decline.
     *
     * Requires "cookieless mode" to also be enabled in the PostHog project
     * settings; without it the server silently drops every cookieless event.
     */
    cookieless_mode: 'on_reject',

    /**
     * Treat the *pending* state (banner shown, not yet answered) the same as
     * an explicit reject: capture cookieless. Without this flag the SDK drops
     * every event until a choice is made. The banner is non-modal, so all
     * landing traffic and any onboarding steps of users who ignore it would
     * simply not exist in the data. The legal footing is identical to the
     * reject path: nothing is stored on the device, identity is the rotating
     * hash. The banner still shows (`get_explicit_consent_status()` keeps
     * reporting 'pending'), and an explicit accept upgrades to cookies+replay.
     */
    opt_out_capturing_by_default: true,

    /**
     * Anonymous landing-page traffic doesn't need a person profile. Those are
     * the expensive part of the bill and useless until someone signs up.
     * `identify()` after login upgrades the user to a real profile.
     */
    person_profiles: 'identified_only',

    /**
     * `app/app/(main)/layout.tsx` switches tabs and opens the learn overlay with
     * raw `history.pushState`, never the Next router. Only `history_change`
     * notices those; with plain `true` the entire authenticated app collapses
     * into a single pageview.
     */
    capture_pageview: 'history_change',

    /**
     * Off deliberately (the SDK default is on). Autocapture records every click
     * on every button, which here means one event per card rating,
     * reintroducing per-review volume through the back door, roughly 9× the
     * event count at the same MAU, for data we already hold in better shape in
     * `dailyStats` / `courseStats` / `reviewDepthAccuracy`.
     *
     * It also captures each element's visible text, which in a flashcard app
     * would sweep up sentence content nobody asked us to send.
     *
     * Meaningful actions are captured explicitly instead. See
     * `lib/posthog/events.ts` and `convex/analytics.ts`. Pageviews and
     * pageleaves are unaffected and still fire automatically.
     */
    autocapture: false,

    /**
     * The SDK enables heatmap collection unless told otherwise. Nobody looks
     * at heatmaps for this app, and with autocapture off they would be the
     * only clickstream data, so turn them off rather than pay to ingest them.
     */
    capture_heatmaps: false,

    /**
     * Uncaught window errors and unhandled promise rejections. The React
     * error boundaries only see render-phase crashes; event handlers and
     * async code end up here. Set locally so error tracking does not depend
     * on the remote project toggle being flipped.
     */
    capture_exceptions: true,

    session_recording: {
      // Default, but stated explicitly because turning it off silently would
      // start recording password and email fields.
      maskAllInputs: true,
      maskTextSelector: `[${PH_MASK_ATTR}]`,
      blockSelector: `[${PH_BLOCK_ATTR}]`,
    },
  });

  initialized = true;
}

/** True once `initPostHogClient` has actually booted the SDK. */
export function isPostHogReady(): boolean {
  return initialized;
}

export { posthog };
