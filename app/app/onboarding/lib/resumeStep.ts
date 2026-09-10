/**
 * The wizard's step order and the resume mapping for a persisted
 * `onboardingProgress.step`. Kept out of page.tsx so the mapping is a plain
 * function a unit test can pin (a Next.js page can only export its route
 * pieces).
 */

import { onboardingAsksPoliteness } from '@/lib/languageForms';

export type StepId =
  | 'language-pair'
  | 'acquisition'
  | 'prior-apps'
  | 'goal'
  | 'daily-time'
  | 'proficiency'
  | 'cefr-pick'
  | 'placement-test'
  | 'politeness'
  | 'review-mode';

/**
 * The persisted step NUMBERS: `onboardingProgress.step` is this array's
 * 1-based index. Append-only. The numbers are on disk for every in-flight
 * sign-up, so a step keeps its number even when it moves in the flow
 * (politeness is 8 here and second in `FLOW_ORDER`). The order the wizard
 * walks is `FLOW_ORDER`.
 */
export const PROGRESS_STEP_ORDER: StepId[] = [
  'language-pair',
  'acquisition',
  'prior-apps',
  'goal',
  'daily-time',
  'proficiency',
  'cefr-pick', // collapsed with placement-test for progress purposes
  'politeness', // asked only for the targets in ONBOARDING_POLITENESS_TARGETS
  'review-mode',
];

/**
 * The order the wizard walks, for the progress bar and the funnel's step
 * index. Politeness comes right after the language pair (only for the
 * targets in ONBOARDING_POLITENESS_TARGETS); placement-test collapses onto
 * cefr-pick as in `PROGRESS_STEP_ORDER`.
 */
export const FLOW_ORDER: StepId[] = [
  'language-pair',
  'politeness',
  'acquisition',
  'prior-apps',
  'goal',
  'daily-time',
  'proficiency',
  'cefr-pick',
  'review-mode',
];

/** The step Continue leads to from `step` when the flow does not branch. */
export function stepAfter(step: StepId): StepId {
  const idx = FLOW_ORDER.indexOf(step);
  return FLOW_ORDER[idx + 1] ?? 'review-mode';
}

/** 0-based position in `FLOW_ORDER`; placement-test sits on cefr-pick. */
export function flowIndex(step: StepId): number {
  return Math.max(
    0,
    FLOW_ORDER.indexOf(step === 'placement-test' ? 'cefr-pick' : step),
  );
}

/**
 * First step of the retired 12-step flow that the wizard has no step for
 * any more: 7 customizing, 8 first-lesson, 9 stats-recap, 10
 * word-projection, 11 feature-tour, 12 plan-pick. A row at 10+ finished or
 * skipped the embedded first lesson; everything the wizard still asks for
 * is already answered, and everything past it no longer exists. Those
 * users are graduated straight out to the dashboard instead of being walked
 * back through the wizard; see `useLegacyGraduation`. The cutoff sits one
 * past the current order's last step (review-mode is 9), so a new-order
 * row can never look legacy; an old-flow row at exactly 9 resumes on
 * review-mode instead, re-confirms the mode and finishes
 * (`completeOnboarding` is idempotent).
 */
export const LEGACY_STEP_AFTER_FIRST_LESSON = 10;

/** Whether a persisted row belongs to the retired 12-step flow. */
export function isLegacyFlowRow(progress: { step: number }): boolean {
  return progress.step >= LEGACY_STEP_AFTER_FIRST_LESSON;
}

/**
 * Map a persisted 1-based step number onto the current wizard order.
 *
 * `priorApps` tells the two orders apart. The `prior-apps` step blocks
 * Continue on an empty pick, so every row saved past step 3 under the
 * current order carries it, and a row without it at step 3 or later was
 * saved under an older order. `targetLanguages` decides whether the
 * politeness step exists for the row's course: a row that would land on
 * it for a course the wizard does not ask it for (`onboardingAsksPoliteness`)
 * resumes on acquisition, the step that follows it in `FLOW_ORDER`.
 */
export function resumeStepId(
  savedStep: number,
  progress: {
    priorApps?: string[];
    targetLanguages?: string[];
    currentLevel?: string;
  },
): StepId {
  const step = rawResumeStepId(savedStep, progress);
  if (
    step === 'politeness' &&
    !onboardingAsksPoliteness(progress.targetLanguages ?? [])
  ) {
    return stepAfter('politeness');
  }
  return step;
}

function rawResumeStepId(
  savedStep: number,
  progress: { priorApps?: string[]; currentLevel?: string },
): StepId {
  // Steps 1-2 line up with every past wizard order. `prior-apps` was inserted
  // at 3 later, so an older in-progress row resumes one step earlier than it
  // left, on the new question, with its saved answers intact. The one place
  // that shift lands wrong is the old last step. 7 was review-mode under the
  // previous order and customizing under the 12-step flow, and both users
  // had already settled their level, so they resume on review-mode rather
  // than on the level picker, which would overwrite a finished placement
  // test with the slider. 8, mid-first-lesson, is an old-flow row whose
  // user never settled a review mode; its level is settled too, so it
  // resumes on review-mode as well rather than on the politeness number,
  // which now leads back into the survey. A politeness-step row under the
  // current flow has the same number and no `priorApps` either (the step
  // comes before prior-apps now), so it is the settled level that tells
  // the two apart: a row on the politeness step never has one.
  // `completeOnboarding` is idempotent, so users whose course already
  // exists (old flow got past customizing) just re-confirm the mode and
  // finish. Rows at 10+ never reach here. They graduate out first.
  if (savedStep > PROGRESS_STEP_ORDER.length) return 'review-mode';
  const isOlderOrder = savedStep >= 3 && progress.priorApps === undefined;
  if (isOlderOrder && savedStep === 7) return 'review-mode';
  if (isOlderOrder && savedStep === 8 && progress.currentLevel !== undefined) {
    return 'review-mode';
  }
  return PROGRESS_STEP_ORDER[savedStep - 1] ?? 'language-pair';
}
