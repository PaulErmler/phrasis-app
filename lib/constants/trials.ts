/**
 * The single switch for free trials. Everything else derives from it: the
 * plan config in `autumn.config.ts`, the hardcoded landing copy in
 * `components/landing/pricing-section.tsx`, and which of the paired billing
 * e2e suites run.
 *
 * Trials are OFF for new customers (2026-09). Existing subscribers and anyone
 * mid-trial are unaffected: they stay on the plan version they bought, which
 * still carries the trial. Nothing is deleted, so turning them back on is
 * flipping this constant and running `atmn push`.
 *
 * This lives apart from `autumn.config.ts` because that file imports `atmn`
 * and `pricing-section.tsx` is a client component, so the two cannot share a
 * constant directly. Keeping the switch here is what stops the config and the
 * landing copy drifting apart.
 */
export const TRIALS_ENABLED = false;

/**
 * Spread into the paid plans in `autumn.config.ts`, which read it as absent
 * rather than `undefined` when trials are off, matching the shape `free`
 * already ships.
 */
export const FREE_TRIAL = TRIALS_ENABLED
  ? { durationLength: 7, durationType: 'day' as const, cardRequired: true }
  : null;
