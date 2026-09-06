import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { assertTestHooksEnabled, requireUserIdByEmail } from '../lib/testHooks';

/**
 * E2E test hooks for the onboarding wizard's resume logic
 * (`e2e/onboarding-resume.spec.ts`). Every function throws unless the
 * deployment has `E2E_TEST_HOOKS=1` set.
 *
 * The wizard maps a persisted `onboardingProgress.step` onto the current
 * step order (`resumeStepId` in app/app/onboarding/lib/resumeStep.ts). Rows
 * saved under an older order are told apart by the absence of `priorApps`,
 * a field the current order always writes past step 3. No UI can produce
 * such a row any more, so the spec plants one here.
 */

/**
 * Write a legacy-order progress row for `email`: `step` with the survey
 * answers the old wizard collected and NO `priorApps`. Replaces any
 * existing row so the spec starts from a known state.
 */
export const seedLegacyProgress = internalMutation({
  args: { email: v.string(), step: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);
    const existing = await ctx.db
      .query('onboardingProgress')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    const row = {
      userId,
      step: args.step,
      baseLanguages: ['en'],
      targetLanguages: ['es'],
      acquisitionSource: 'friend',
      learningGoals: ['curiosity'],
      dailyTimeGoalMinutes: 5,
      currentLevel: 'elementary' as const,
    };
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert('onboardingProgress', row);
    }
    return null;
  },
});
