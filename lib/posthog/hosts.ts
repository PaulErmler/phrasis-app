/**
 * PostHog host resolution, shared by `next.config.ts` (which sets up the proxy
 * rewrites) and the browser client (which points `api_host` at the proxy).
 *
 * Deliberately dependency-free. `next.config.ts` imports this, so anything
 * pulled in here has to survive being bundled into the config loader. No
 * `lib/env`, no React, no Convex.
 */

/**
 * First-party path that all PostHog ingestion is proxied through.
 *
 * Not `/analytics`, `/track`, `/telemetry` or `/posthog`: every mainstream
 * blocklist matches those by name, which would defeat the entire point of
 * running a proxy. Changing this value is a breaking change for any session
 * already running an older bundle, so treat it as permanent.
 */
export const POSTHOG_PROXY_PATH = '/ph-relay';

/** EU Cloud. Flexling's projects live here. See the privacy policy's "Frankfurt" claim. */
const DEFAULT_INGEST_HOST = 'https://eu.i.posthog.com';

/**
 * Where the proxy forwards to. Read from the environment so a self-hosted or
 * US-region deployment needs no code change, but the value has to be
 * present at **build** time: it is inlined into both the rewrite rules and the
 * client bundle.
 */
export const POSTHOG_INGEST_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_INGEST_HOST;

/**
 * Static assets (the recorder bundle, toolbar, surveys) come from a separate
 * origin than the event API. PostHog names it by prefixing the region with
 * `-assets`, so derive it rather than asking for a second env var that could
 * drift out of sync with the first.
 */
export const POSTHOG_ASSETS_HOST = POSTHOG_INGEST_HOST.replace(
  /^(https?:\/\/)([a-z0-9-]+)\.i\.posthog\.com$/i,
  (_match, scheme: string, region: string) =>
    `${scheme}${region}-assets.i.posthog.com`,
);

/** What the browser passes as `api_host`. First-party, so ad blockers don't match it. */
export const POSTHOG_API_HOST = POSTHOG_PROXY_PATH;

/**
 * Project token, or undefined when analytics aren't configured for this build.
 *
 * Read here rather than through `lib/env` on purpose: that module hard-throws
 * on missing *required* variables, and pulling it into the PostHog path would
 * make every unit test that touches a component importing analytics fail on an
 * unrelated Convex URL. Analytics are optional; the app must run without them.
 *
 * Inlined at build time, on Coolify this has to be a **build** argument, not a
 * runtime variable, or it resolves to undefined in the shipped bundle.
 */
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

/**
 * Where "open in PostHog" links point. The ingest host (`eu.i.`) does not serve
 * the app UI, so this has to be the bare regional domain.
 */
export const POSTHOG_UI_HOST = POSTHOG_INGEST_HOST.replace(
  '.i.posthog.com',
  '.posthog.com',
);
