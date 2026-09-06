import { describe, expect, it } from 'vitest';
import {
  LEGACY_STEP_AFTER_FIRST_LESSON,
  PROGRESS_STEP_ORDER,
  resumeStepId,
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
    expect(resumeStepId(7, {})).toBe('review-mode');
    // Under the current order 7 is cefr-pick, and such rows carry priorApps.
    expect(resumeStepId(7, { priorApps: ['none'] })).toBe('cefr-pick');
  });

  it('sends a row past the wizard to review-mode', () => {
    expect(resumeStepId(PROGRESS_STEP_ORDER.length + 1, {})).toBe(
      'review-mode',
    );
  });

  it('keeps headroom between the wizard and the legacy graduation cutoff', () => {
    // A row at LEGACY_STEP_AFTER_FIRST_LESSON or beyond graduates straight
    // to the dashboard (`useLegacyGraduation`), so a live wizard step must
    // never reach that number. Inserting a step without raising the
    // constant would force-finalize users mid-wizard.
    expect(PROGRESS_STEP_ORDER.length).toBeLessThan(
      LEGACY_STEP_AFTER_FIRST_LESSON,
    );
  });
});
