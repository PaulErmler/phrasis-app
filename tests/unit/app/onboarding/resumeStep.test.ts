import { describe, expect, it } from 'vitest';
import {
  FLOW_ORDER,
  LEGACY_STEP_AFTER_FIRST_LESSON,
  PROGRESS_STEP_ORDER,
  flowIndex,
  resumeStepId,
  stepAfter,
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

  it('skips the politeness step for every target but Japanese and Korean', () => {
    // 8 is the politeness NUMBER; the step itself follows the language
    // pair, so a row that does not get the question resumes on
    // acquisition. A Swedish course never asked it; a German course marks
    // politeness but the wizard no longer asks it either: it starts on
    // every level instead.
    expect(
      resumeStepId(8, { priorApps: ['none'], targetLanguages: ['sv'] }),
    ).toBe('acquisition');
    expect(
      resumeStepId(8, { priorApps: ['none'], targetLanguages: ['de'] }),
    ).toBe('acquisition');
    expect(resumeStepId(8, { priorApps: ['none'] })).toBe('acquisition');
    expect(resumeStepId(8, ja)).toBe('politeness');
    expect(
      resumeStepId(8, { priorApps: ['none'], targetLanguages: ['ko'] }),
    ).toBe('politeness');
  });

  it('tells a reload on the politeness step from an old-flow row at 8', () => {
    // Politeness comes before prior-apps now, so a Japanese sign-up that
    // reloads on it has number 8 and no priorApps yet. It resumes there,
    // not on the review mode with the whole survey skipped.
    expect(resumeStepId(8, { targetLanguages: ['ja'] })).toBe('politeness');
    expect(resumeStepId(8, { targetLanguages: ['de'] })).toBe('acquisition');
    // An old-flow row at 8 (mid-first-lesson) has its level settled and
    // finishes on the review mode rather than re-entering the survey.
    expect(
      resumeStepId(8, { targetLanguages: ['ja'], currentLevel: 'beginner' }),
    ).toBe('review-mode');
    expect(
      resumeStepId(8, { targetLanguages: ['de'], currentLevel: 'beginner' }),
    ).toBe('review-mode');
  });

  it('walks politeness right after the language pair, numbers unchanged', () => {
    expect(FLOW_ORDER[0]).toBe('language-pair');
    expect(FLOW_ORDER[1]).toBe('politeness');
    expect(stepAfter('language-pair')).toBe('politeness');
    expect(stepAfter('politeness')).toBe('acquisition');
    expect(stepAfter('review-mode')).toBe('review-mode');
    expect(flowIndex('placement-test')).toBe(flowIndex('cefr-pick'));
    expect(flowIndex('politeness')).toBe(1);
    // Same steps in both orders: a step can move, never appear or vanish
    // in one only.
    expect([...FLOW_ORDER].sort()).toEqual([...PROGRESS_STEP_ORDER].sort());
    // The persisted numbers are on disk: pin them.
    expect(PROGRESS_STEP_ORDER.indexOf('politeness') + 1).toBe(8);
    expect(PROGRESS_STEP_ORDER.indexOf('review-mode') + 1).toBe(9);
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
