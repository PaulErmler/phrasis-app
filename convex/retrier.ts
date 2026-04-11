import { ActionRetrier } from '@convex-dev/action-retrier';
import { components } from './_generated/api';

// Used for retrying flaky external-API calls (currently: OpenRouter sentence-metadata fetch).
// Total max wait across attempts: <1 minute (3s + 6s + 12s + 24s) before final give-up.
export const retrier = new ActionRetrier(components.actionRetrier, {
  initialBackoffMs: 3_000,
  base: 2,
  maxFailures: 4,
});
