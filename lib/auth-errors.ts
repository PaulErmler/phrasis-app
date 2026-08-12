import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';

/**
 * Diagnostics + user-facing copy for failed Better Auth requests.
 *
 * Background, because the failure mode is non-obvious: better-auth-ui issues
 * every request with `fetchOptions: { throw: true }`, so failures surface as a
 * `BetterFetchError` whose message is `statusText || String(status)`. HTTP/2
 * has no reason phrase, so browsers report `statusText === ''` — which means a
 * response Better Auth's router answers with an empty body (unmatched path,
 * wrong method for a known path, trailing-slash mismatch) reaches the user as
 * a toast reading exactly "404". Real auth failures always carry a JSON body
 * with a `code`, so they localize fine; only the transport-level ones degrade
 * into a bare number.
 */

/** Fields of better-fetch's `ErrorContext` this module actually reads. */
type AuthFetchErrorContext = {
  response: Response;
  responseText?: string;
  error?: { code?: string; status?: number; statusText?: string };
  request?: { method?: string };
};

/**
 * `/convex/token` answers 401 for every signed-out visitor — that is the
 * normal reply on the landing page, not a failure worth recording.
 */
const EXPECTED_UNAUTHENTICATED_PATH = '/api/auth/convex/token';

/**
 * Report a failed auth request to PostHog. Never throws — `capture` swallows
 * its own errors, and this must not change what the user sees.
 *
 * Deliberately records no request body and no query string: verification
 * codes, reset tokens and OAuth state all travel in the query.
 */
export function reportAuthRequestFailure(context: AuthFetchErrorContext): void {
  const { response } = context;

  let path = '';
  try {
    path = new URL(response.url).pathname;
  } catch {
    // `response.url` is empty for some synthetic responses; the status and
    // the rest of the properties are still worth reporting.
  }

  if (response.status === 401 && path === EXPECTED_UNAUTHENTICATED_PATH) return;

  capture(CLIENT_EVENTS.AUTH_REQUEST_FAILED, {
    status: response.status,
    path,
    method: context.request?.method ?? 'unknown',
    // The whole diagnosis lives in these three. `error_code` null + empty body
    // means the request never matched an endpoint (see the module comment);
    // `redirected` catches the leading suspect for that — a POST downgraded to
    // a GET by a 301/302 in front of the app, which then misses the POST-only
    // route.
    error_code: context.error?.code ?? null,
    body_empty: !context.responseText,
    redirected: response.redirected,
  });
}

/**
 * Reason phrases servers put in `statusText` on a bodiless response — on
 * HTTP/1.1 (local dev, some proxies) these reach the user instead of the bare
 * status number — plus the browsers' `TypeError` messages for a network-level
 * failure (offline, DNS, TLS), which better-fetch rethrows as-is.
 */
const RAW_STATUS_TEXTS = new Set([
  'Not Found',
  'Method Not Allowed',
  'Internal Server Error',
  'Bad Gateway',
  'Service Unavailable',
  'Gateway Timeout',
  'Failed to fetch', // Chromium
  'Load failed', // WebKit
  'NetworkError when attempting to fetch resource.', // Firefox
]);

/**
 * True when an auth error message is a transport artifact rather than
 * something a user can act on: a bare status number ("404") or a raw HTTP
 * reason phrase. Callers should show their own copy instead.
 */
export function isTransportErrorMessage(message?: string): boolean {
  if (!message) return false;
  const trimmed = message.trim();
  return /^\d{3}$/.test(trimmed) || RAW_STATUS_TEXTS.has(trimmed);
}
