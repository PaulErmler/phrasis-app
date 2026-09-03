/**
 * OpenAI Ads measurement pixel (`oaiq`), consent-gated.
 *
 * Attribution for ChatGPT ad campaigns: the pixel reads the `oppref` click id
 * the ad appends to the landing URL, and conversions measured here are matched
 * back to the campaign in OpenAI's ads manager. PostHog remains the product
 * analytics source of truth; this module reports three conversion moments to
 * one more vendor and nothing else.
 *
 * Privacy stance, mirroring `lib/posthog/client.ts`: the SDK script is NOT
 * injected until the user accepts the cookie banner. The SDK itself fetches
 * its matching config from `bzrcdn.openai.com` on init regardless of its own
 * consent flag, and writes `__oppref` / `__obref` cookies, so "load it early
 * with consent=false" would still contact a third party from the visitor's
 * browser. Loading only on grant is the only arrangement that keeps the
 * privacy policy's "nothing without consent" claim true. The cost is known:
 * a visitor who accepts the banner on a later page than the landing page has
 * already lost the `oppref` from the URL, and that click is unattributed.
 *
 * Wire facts verified against the SDK bundle (2026-09-01): consent is
 * `oaiq('consent', boolean)` and must precede `init`; events queue while
 * consent is null and are dropped on false; revoking consent deletes the
 * SDK's own cookies. Docs: https://developers.openai.com/ads/measurement-pixel
 *
 * Pixel id is public (ships in the bundle), read like `NEXT_PUBLIC_POSTHOG_KEY`:
 * undefined means "not configured for this build" and every function here is
 * a no-op. On Coolify it has to be a **build** argument, not a runtime variable.
 */

export const OPENAI_PIXEL_ID = process.env.NEXT_PUBLIC_OPENAI_PIXEL_ID;

export const OPENAI_PIXEL_SDK_URL = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';

type OaiqFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    oaiq?: OaiqFn & { q?: IArguments[] };
  }
}

/** Standard pixel event names this app reports. */
export type ConversionEvent =
  | 'registration_completed'
  | 'subscription_created'
  | 'trial_started';

/** Everything this module persists is prefixed so a consent revoke can sweep it. */
const STORAGE_PREFIX = 'flexling_oaiq_';
const FIRED_KEY = `${STORAGE_PREFIX}fired`;
const CHECKOUT_KEY = `${STORAGE_PREFIX}checkout`;

/** A checkout started longer ago than this no longer explains a paid plan. */
export const CHECKOUT_MARKER_TTL_MS = 2 * 60 * 60 * 1000;

/** Keep the dedupe list bounded; a device sees a handful of conversions, ever. */
const FIRED_LIMIT = 20;

let loaded = false;

export function isOpenAIPixelLoaded(): boolean {
  return loaded;
}

/**
 * The official snippet's command queue: calls made before the SDK script
 * arrives are buffered on `q` and replayed by the SDK. Kept as a `function`
 * so `arguments` is available, matching what the SDK replays.
 */
function ensureQueue(): OaiqFn {
  if (window.oaiq) return window.oaiq;
  const stub = function (this: unknown) {
    // eslint-disable-next-line prefer-rest-params
    stub.q.push(arguments);
  } as OaiqFn & { q: IArguments[] };
  stub.q = [];
  window.oaiq = stub;
  return stub;
}

function injectScript(): void {
  if (document.querySelector(`script[src="${OPENAI_PIXEL_SDK_URL}"]`)) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = OPENAI_PIXEL_SDK_URL;
  document.head.appendChild(script);
}

/**
 * Inject the SDK and initialize the pixel. Idempotent. Call only once the
 * user has granted analytics consent; see the module comment for why.
 */
export function loadOpenAIPixel(): void {
  if (loaded || typeof window === 'undefined' || !OPENAI_PIXEL_ID) return;
  loaded = true;
  const oaiq = ensureQueue();
  // Docs: "Set consent before initializing the Pixel."
  oaiq('consent', true);
  oaiq('init', {
    pixelId: OPENAI_PIXEL_ID,
    // Verbose console output while testing; silent in the shipped bundle.
    debug: process.env.NODE_ENV !== 'production',
  });
  injectScript();
}

/**
 * Mirror the banner choice into the pixel.
 *
 * Grant: load on first grant, re-enable on a later re-grant. Deny: the script
 * cannot be unloaded, so tell the SDK (it drops its queue and deletes its
 * cookies) and sweep this module's own storage. Before the pixel has ever
 * loaded a deny is a no-op: nothing was written.
 */
export function syncOpenAIPixelConsent(granted: boolean): void {
  if (typeof window === 'undefined') return;
  if (granted) {
    if (loaded) window.oaiq?.('consent', true);
    else loadOpenAIPixel();
    return;
  }
  if (!loaded) return;
  window.oaiq?.('consent', false);
  clearOpenAIPixelStorage();
}

/**
 * Report a conversion. Returns whether it was handed to the SDK, so callers
 * only mark an event as fired when it actually went out. Never throws: a
 * broken ad pixel must not change what the user sees.
 *
 * `event_id` is the cross-channel dedupe key. Reuse the same string if the
 * same conversion is ever also sent from the server (Conversions API).
 */
export function measureConversion(
  event: ConversionEvent,
  data: Record<string, unknown>,
  options?: { event_id?: string },
): boolean {
  if (!loaded) return false;
  try {
    window.oaiq?.('measure', event, data, options);
    return true;
  } catch {
    return false;
  }
}

// ── Device-side bookkeeping ─────────────────────────────────────────────────
//
// Only ever written after consent (every caller checks `loaded` or the consent
// status first), so this storage falls under the same grant as the SDK's own
// cookies. All of it is swept by `clearOpenAIPixelStorage`.

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked. Losing dedupe means at worst a duplicate
    // conversion, which `event_id` still lets the vendor collapse.
  }
}

/** Has this conversion (by `event_id`) already been reported from this device? */
export function hasFired(eventId: string): boolean {
  return readJson<string[]>(FIRED_KEY)?.includes(eventId) ?? false;
}

export function markFired(eventId: string): void {
  const fired = readJson<string[]>(FIRED_KEY) ?? [];
  if (fired.includes(eventId)) return;
  writeJson(FIRED_KEY, [...fired, eventId].slice(-FIRED_LIMIT));
}

type CheckoutMarker = { planId: string; at: number };

/**
 * Remember that the user just left for Stripe to buy `planId`. The customer
 * comes back as a fresh page load, so the only way to tell "this paid plan
 * is the outcome of a checkout that started here" from "a long-time
 * subscriber opened the app" is a note left before the redirect. Without
 * it, the first app open after this feature ships would report every
 * existing paying customer as a fresh conversion.
 */
export function markCheckoutStarted(planId: string): void {
  if (!loaded) return;
  writeJson(CHECKOUT_KEY, { planId, at: Date.now() } satisfies CheckoutMarker);
}

/** The plan a still-fresh checkout marker points at, or null. Expired markers are dropped. */
export function readCheckoutMarker(): string | null {
  const marker = readJson<CheckoutMarker>(CHECKOUT_KEY);
  if (!marker) return null;
  if (Date.now() - marker.at > CHECKOUT_MARKER_TTL_MS) {
    clearCheckoutMarker();
    return null;
  }
  return marker.planId;
}

export function clearCheckoutMarker(): void {
  try {
    window.localStorage.removeItem(CHECKOUT_KEY);
  } catch {
    // Nothing to do; an unremovable marker expires on its own.
  }
}

export function clearOpenAIPixelStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable means nothing was stored.
  }
}

/** Test seam: forget the module-level "loaded" state. */
export function resetOpenAIPixelForTests(): void {
  loaded = false;
}
