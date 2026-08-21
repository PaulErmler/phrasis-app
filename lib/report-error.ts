'use client';

import { posthog } from '@/lib/posthog/client';

/**
 * Single sink for client-side errors: logs to the console *and* forwards to
 * PostHog error tracking.
 *
 * This is the helper the July 2026 code review asked for. Adopt it at the
 * ~50 existing `console.error` sites incrementally, starting with the ones that
 * currently swallow silently. Those are invisible today by construction.
 *
 * Deliberately not a drop-in for every catch block: errors the product expects
 * and handles (`USAGE_LIMIT`, autoplay rejection, `PAYMENT_PAST_DUE`) belong in
 * `capture`-style product events (`lib/posthog/events.ts`), not the exception
 * feed, or real crashes drown in noise.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error(error, context);

  try {
    posthog.captureException(error instanceof Error ? error : new Error(String(error)), context);
  } catch {
    // A broken reporter must not escalate into a broken app.
  }
}
