import { describe, expect, it } from 'vitest';
import {
  LEGACY_STEP_AFTER_FIRST_LESSON,
  PROGRESS_STEP_ORDER,
  resumeStepId,
  isLegacyFlowRow,
} from '@/app/app/onboarding/lib/resumeStep';

// A target that marks politeness, so the politeness step exists.
const ja = { priorApps: ['anki'], targetLanguages: ['ja'] };

describe('resumeStepId', () => {
  it('resumes a current-order row on the step it left', () => {
    PROGRESS_STEP_ORDER.forEach((stepId, i) => {
      expect(resumeStepId(i + 1, ja)).toBe(stepId);
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
    expect(resumeStepId(7, {})).toBe('review-mode');
    // Under the current order 7 is cefr-pick, and such rows carry priorApps.
    expect(resumeStepId(7, { priorApps: ['none'] })).toBe('cefr-pick');
  });

  it('sends a row past the wizard to review-mode', () => {
    expect(resumeStepId(PROGRESS_STEP_ORDER.length + 1, {})).toBe(
      'review-mode',
    );
  });

  it('skips the politeness step for a course no target of which marks it', () => {
    // 8 is politeness under the current order; a Swedish course never
    // asked it, so the row resumes on the step after.
    expect(resumeStepId(8, { priorApps: ['none'], targetLanguages: ['sv'] })).toBe(
      'review-mode',
    );
    expect(resumeStepId(8, { priorApps: ['none'] })).toBe('review-mode');
    expect(resumeStepId(8, ja)).toBe('politeness');
    // An old-flow row at 8 (mid-first-lesson) lands there too.
    expect(resumeStepId(8, { targetLanguages: ['de'] })).toBe('politeness');
  });

  it('graduates only rows past every step the wizard still has', () => {
    // The cutoff sits one past review-mode, so a new-order row can never
    // look legacy; an old-flow row at exactly 9 re-confirms the mode.
    expect(LEGACY_STEP_AFTER_FIRST_LESSON).toBe(PROGRESS_STEP_ORDER.length + 1);
    expect(isLegacyFlowRow({ step: 9 })).toBe(false);
    expect(isLegacyFlowRow({ step: 10 })).toBe(true);
    expect(isLegacyFlowRow({ step: 12 })).toBe(true);
    expect(resumeStepId(9, {})).toBe('review-mode');
    expect(resumeStepId(9, ja)).toBe('review-mode');
  });
});
