import { test } from '@playwright/test';

import { TRIALS_ENABLED } from '../lib/constants/trials';

/**
 * The billing journeys come in pairs: one that needs a free trial to exist and
 * one that needs it not to. Both are always present in the tree, and this
 * picks which pair member runs from the same constant the plan config and the
 * landing copy read, so flipping trials on or off swaps the coverage over
 * without editing a spec.
 *
 * Gating at the DESCRIBE level matters: a `test.skip()` inside the body still
 * runs `beforeAll`, which for these suites signs up a throwaway user and
 * drives a real Stripe checkout for a run that cannot pass.
 */
export const trialSuite = TRIALS_ENABLED ? test.describe : test.describe.skip;

export const noTrialSuite = TRIALS_ENABLED ? test.describe.skip : test.describe;

export { TRIALS_ENABLED };
