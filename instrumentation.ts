import type { Instrumentation } from 'next';

/**
 * Next calls this once per runtime on boot. Nothing to set up — the PostHog
 * node client is created lazily on first use — but the export has to exist for
 * Next to load this module and register `onRequestError` below.
 */
export function register(): void {}

/**
 * Server-side errors Next catches on our behalf: React Server Component
 * renders, route handlers, and server actions. Without this they only ever
 * reach the container's stdout.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
) => {
  // The edge runtime has no posthog-node; only the Node.js runtime can report.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { getPostHogServer, distinctIdFromCookie } = await import('@/lib/posthog/server');
  const posthog = getPostHogServer();
  if (!posthog) return;

  try {
    await posthog.captureException(
      err instanceof Error ? err : new Error(String(err)),
      distinctIdFromCookie(request.headers.cookie),
      { path: request.path, method: request.method },
    );
  } catch {
    // Reporting an error must never be the thing that takes down the request.
  }
};
