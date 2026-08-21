'use client';

import { useSyncExternalStore } from 'react';

import { isPostHogReady, posthog } from './client';

/**
 * 'initializing' is reported before the SDK boots, and, in a build without a
 * PostHog key, forever. It is distinct from the real statuses on purpose: it
 * hides the banner like an answered state, but consumers that persist the
 * choice (`ConsentSync`) must be able to tell "no SDK yet" from "granted",
 * and, critically, the transition initializing → granted must be a visible
 * snapshot change, or a stored grant read back on boot re-renders nothing.
 */
export type ConsentStatus = 'granted' | 'denied' | 'pending' | 'initializing';

/**
 * PostHog owns the consent record (it persists the choice itself and reads it
 * back on the next page load), so there is no second source of truth to keep in
 * sync. What it does *not* have is a change notification, so this module keeps a
 * tiny subscriber list and pokes it whenever we call opt-in/opt-out. Enough for
 * `useSyncExternalStore` to re-render the banner.
 *
 * Same shape as `lib/tutorials/use-tutorial.ts`, which solves the identical
 * "external mutable state, React needs to know" problem.
 */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Tell subscribers the SDK has finished booting.
 *
 * Load-bearing: before init, `getSnapshot` reports 'initializing' so no banner
 * flashes into SSR output, and the provider's own `setState` cannot wake the
 * banner up. `children` is a stable element, so React bails out of
 * re-rendering that subtree. Without this call the banner never appears at all.
 */
export function notifyConsentReady(): void {
  notify();
}

/** `useSyncExternalStore`'s subscribe half. Exported so it can be driven directly in tests. */
export function subscribeToConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reading consent requires the SDK to be booted. Before that, and in any build
 * without a PostHog key. Report 'initializing', which hides the banner (showing
 * a cookie banner for an app that sets no analytics cookies would be a lie, and
 * would break every e2e run against a key-less build) without impersonating a
 * real choice: a placeholder 'granted' here would make the boot transition for
 * a user with a stored grant invisible to `useSyncExternalStore` ('granted' →
 * 'granted'), and `ConsentSync` would never mirror the choice to the backend.
 */
function getSnapshot(): ConsentStatus {
  if (!isPostHogReady()) return 'initializing';
  return posthog.get_explicit_consent_status();
}

/** The server has no consent state; matches the pre-boot client snapshot so hydration agrees. */
function getServerSnapshot(): ConsentStatus {
  return 'initializing';
}

export function useConsentStatus(): ConsentStatus {
  return useSyncExternalStore(subscribeToConsent, getSnapshot, getServerSnapshot);
}

/**
 * Accept: PostHog switches out of cookieless mode, starts using cookies and
 * localStorage, and session replay becomes available.
 */
export function grantConsent(): void {
  if (!isPostHogReady()) return;
  posthog.opt_in_capturing();
  notify();
}

/**
 * Reject: PostHog stays in cookieless mode. Events keep flowing under a
 * server-side daily-rotated hash and no replay is recorded, so a rejection
 * costs us cross-session identity, not visibility. The only thing written to
 * the device is the choice itself (`__ph_opt_in_out_*`), which §25(2) TTDSG
 * exempts as strictly necessary; storing it is what stops the banner from
 * reappearing on every page load.
 */
export function denyConsent(): void {
  if (!isPostHogReady()) return;
  posthog.opt_out_capturing();
  notify();
}

export function setConsent(granted: boolean): void {
  if (granted) grantConsent();
  else denyConsent();
}

/**
 * `posthog.reset()` clears the stored opt-in/out choice along with identity.
 * Sign-out must forget who the user was, not whether they consented, so
 * capture the explicit status first and re-apply it after.
 *
 * The consent record is deliberately scoped to the DEVICE, not the person: we
 * assume one browser profile belongs to one user. On a shared device the next
 * person to sign in therefore inherits the previous answer instead of being
 * asked again. Scoping it per user id was tried and removed. It cannot be
 * done safely from here, because PostHog boots (and session replay starts)
 * before the auth query resolves, and `clear_opt_in_out_capturing()` resets
 * the stored record without stopping capture. Anything better has to gate
 * `posthog.init()` on the signed-in identity, not patch it afterwards.
 */
export function resetPreservingConsent(): void {
  const status = posthog.get_explicit_consent_status();
  posthog.reset();
  // Not a fresh opt-in, just restoring the record. Don't re-fire `$opt_in`.
  if (status === 'granted') posthog.opt_in_capturing({ captureEventName: null });
  else if (status === 'denied') posthog.opt_out_capturing();
  notify();
}
