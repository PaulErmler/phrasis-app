import { PostHog } from 'posthog-node';

import { POSTHOG_INGEST_HOST, POSTHOG_KEY } from './hosts';

let client: PostHog | null = null;

/**
 * Node-side PostHog client for the Next server (route handlers, `onRequestError`).
 *
 * `flushAt: 1` / `flushInterval: 0` send each event immediately rather than
 * batching: serverless and standalone request handlers can be torn down at any
 * moment, and a batched exception that never flushed is an exception you never
 * hear about.
 *
 * Returns null when unconfigured so callers degrade to console-only rather than
 * throwing inside an error handler. The one place a second failure is worst.
 */
export function getPostHogServer(): PostHog | null {
  if (!POSTHOG_KEY) return null;

  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_INGEST_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

/**
 * Pull the PostHog distinct id out of the request cookie so a server-side
 * exception lands on the same person timeline as the browser events around it.
 * Best-effort by design: an unparseable cookie means an anonymous exception,
 * which is still far better than no exception.
 */
export function distinctIdFromCookie(
  cookieHeader: string | string[] | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  const raw = Array.isArray(cookieHeader)
    ? cookieHeader.join('; ')
    : cookieHeader;
  const match = raw.match(/ph_phc_.*?_posthog=([^;]+)/);
  if (!match?.[1]) return undefined;

  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as {
      distinct_id?: unknown;
    };
    return typeof parsed.distinct_id === 'string'
      ? parsed.distinct_id
      : undefined;
  } catch {
    return undefined;
  }
}
