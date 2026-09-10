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

const current = { priorApps: ['anki'] };

describe('resumeStepId', () => {
  it('resumes a current-order row on the step it left', () => {
    PROGRESS_STEP_ORDER.forEach((stepId, i) => {
      expect(resumeStepId(i + 1, current)).toBe(stepId);
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

  it('walks the persisted order, numbers pinned', () => {
    expect(FLOW_ORDER[0]).toBe('language-pair');
    expect(stepAfter('language-pair')).toBe('acquisition');
    expect(stepAfter('review-mode')).toBe('review-mode');
    expect(flowIndex('placement-test')).toBe(flowIndex('cefr-pick'));
    // No step is asked out of turn any more, so the two orders coincide.
    expect([...FLOW_ORDER]).toEqual([...PROGRESS_STEP_ORDER]);
    // The persisted numbers are on disk: pin them.
    expect(PROGRESS_STEP_ORDER.indexOf('review-mode') + 1).toBe(8);
  });

  it('graduates only rows past every step the wizard still has', () => {
    // The cutoff sits one past review-mode, so a new-order row can never
    // look legacy; an old-flow row at exactly 8 re-confirms the mode.
    expect(LEGACY_STEP_AFTER_FIRST_LESSON).toBe(PROGRESS_STEP_ORDER.length + 1);
    expect(isLegacyFlowRow({ step: 8 })).toBe(false);
    expect(isLegacyFlowRow({ step: 9 })).toBe(true);
    expect(isLegacyFlowRow({ step: 12 })).toBe(true);
    expect(resumeStepId(8, {})).toBe('review-mode');
    expect(resumeStepId(8, current)).toBe('review-mode');
  });
});
