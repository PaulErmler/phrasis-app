import { PostHog } from '@posthog/convex';

import { components } from './_generated/api';

/**
 * Server-side PostHog. Credentials live on the component (see
 * `convex/convex.config.ts`), so the constructor only needs the reference.
 *
 * `capture` / `identify` / `captureException` schedule their HTTP call via
 * `ctx.scheduler.runAfter`, so they return immediately and never add latency to
 * the mutation that fired them. That also means each one costs a scheduled
 * function call — which is the reason the event taxonomy in `convex/analytics.ts`
 * is session-level rather than per-review.
 *
 * Available in mutations and actions. Queries can read feature flags but cannot
 * capture (no scheduler).
 */
export const posthog = new PostHog(components.posthog);
