import { describe, expect, it } from 'vitest';
import {
  LEGACY_STEP_AFTER_FIRST_LESSON,
  PROGRESS_STEP_ORDER,
  resumeStepId,
  isLegacyFlowRow,
} from '@/app/app/onboarding/lib/resumeStep';

describe('resumeStepId', () => {
  it('resumes a current-order row on the step it left', () => {
    PROGRESS_STEP_ORDER.forEach((stepId, i) => {
      expect(resumeStepId(i + 1, { priorApps: ['anki'] })).toBe(stepId);
    });
  });

  it('resumes an older-order row one step earlier, on the inserted question', () => {
    // Old order: 3 was goal; the row has no priorApps, so it lands on the
    // new prior-apps question with its saved answers intact.
    expect(resumeStepId(3, {})).toBe('prior-apps');
    expect(resumeStepId(6, {})).toBe('proficiency');
  });

  it('sends an older-order last step to review-mode, not the level picker', () => {
    // 7 was review-mode under the previous order and customizing under the
    // 12-step flow; both users had settled their level already.
    // Without a first-person answer the new questions come first (every
    // course gets an explicit sentence-form setting); with one, review-mode.
    expect(resumeStepId(7, {})).toBe('first-person-forms');
    expect(resumeStepId(7, { firstPersonForms: 'both' })).toBe('review-mode');
    // Under the current order 7 is cefr-pick, and such rows carry priorApps.
    expect(resumeStepId(7, { priorApps: ['none'] })).toBe('cefr-pick');
  });

  it('sends a row past the wizard to review-mode', () => {
    expect(resumeStepId(PROGRESS_STEP_ORDER.length + 1, {})).toBe(
      'first-person-forms',
    );
    expect(
      resumeStepId(PROGRESS_STEP_ORDER.length + 1, {
        firstPersonForms: 'feminine',
      }),
    ).toBe('review-mode');
  });

  it('tells a legacy-flow row from a new-order row past the graduation cutoff', () => {
    // The wizard now has steps at and past LEGACY_STEP_AFTER_FIRST_LESSON
    // (politeness, review-mode), so the graduation rule cannot key off the
    // number alone: a new-order row there always carries the first-person
    // answer, an old-flow row never does.
    expect(PROGRESS_STEP_ORDER.length).toBeGreaterThanOrEqual(
      LEGACY_STEP_AFTER_FIRST_LESSON,
    );
    expect(isLegacyFlowRow({ step: 9 })).toBe(true);
    expect(isLegacyFlowRow({ step: 12 })).toBe(true);
    expect(isLegacyFlowRow({ step: 9, firstPersonForms: 'both' })).toBe(false);
    expect(isLegacyFlowRow({ step: 10, firstPersonForms: 'feminine' })).toBe(
      false,
    );
    expect(isLegacyFlowRow({ step: 8 })).toBe(false);
    expect(resumeStepId(8, { priorApps: ['none'] })).toBe('first-person-forms');
    expect(
      resumeStepId(9, { priorApps: ['none'], firstPersonForms: 'both' }),
    ).toBe('politeness');
    expect(
      resumeStepId(10, { priorApps: ['none'], firstPersonForms: 'both' }),
    ).toBe('review-mode');
  });
});
