/**
 * The wizard's step order and the resume mapping for a persisted
 * `onboardingProgress.step`. Kept out of page.tsx so the mapping is a plain
 * function a unit test can pin (a Next.js page can only export its route
 * pieces).
 */

export type StepId =
  | 'language-pair'
  | 'acquisition'
  | 'prior-apps'
  | 'goal'
  | 'daily-time'
  | 'proficiency'
  | 'cefr-pick'
  | 'placement-test'
  | 'review-mode';

export const PROGRESS_STEP_ORDER: StepId[] = [
  'language-pair',
  'acquisition',
  'prior-apps',
  'goal',
  'daily-time',
  'proficiency',
  'cefr-pick', // collapsed with placement-test for progress purposes
  'review-mode',
];

/**
 * First step of the retired 12-step flow that sits AFTER the embedded first
 * lesson: 7 customizing, 8 first-lesson, 9 stats-recap, 10 word-projection,
 * 11 feature-tour, 12 plan-pick. A row at 9+ means the user finished or
 * skipped that lesson. Everything the wizard still asks for is already
 * answered, and everything past it (stats recap, word projection, feature
 * tour, plan pick) no longer exists. Those users are graduated straight out
 * to the dashboard instead of being walked back through the wizard; see
 * `useLegacyGraduation`.
 */
export const LEGACY_STEP_AFTER_FIRST_LESSON = 9;

/**
 * Map a persisted 1-based step number onto the current wizard order.
 *
 * `priorApps` tells the two orders apart. The `prior-apps` step blocks
 * Continue on an empty pick, so every row saved past step 3 under the
 * current order carries it, and a row without it at step 3 or later was
 * saved under an older order.
 */
export function resumeStepId(
  savedStep: number,
  progress: { priorApps?: string[] },
): StepId {
  // Steps 1-2 line up with every past wizard order. `prior-apps` was inserted
  // at 3 later, so an older in-progress row resumes one step earlier than it
  // left, on the new question, with its saved answers intact. The one place
  // that shift lands wrong is the old last step. 7 was review-mode under the
  // previous order and customizing under the 12-step flow, and both users
  // had already settled their level, so they resume on review-mode rather
  // than on the level picker, which would overwrite a finished placement
  // test with the slider. 8, mid-first-lesson, is an old-flow row whose
  // user never settled a review mode. It lands on review-mode too.
  // `completeOnboarding` is idempotent, so users whose course already exists
  // (old flow got past customizing) just re-confirm the mode and finish.
  // Rows at 9+ never reach here. They graduate out first.
  if (savedStep > PROGRESS_STEP_ORDER.length) return 'review-mode';
  const isOlderOrder = savedStep >= 3 && progress.priorApps === undefined;
  if (isOlderOrder && savedStep === 7) return 'review-mode';
  return PROGRESS_STEP_ORDER[savedStep - 1] ?? 'language-pair';
}
