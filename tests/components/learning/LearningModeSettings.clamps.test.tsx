import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import type { CourseSettings } from '@/components/app/learning/types';
import type { Id } from '@/convex/_generated/dataModel';
import {
  MAX_INITIAL_REVIEW_COUNT,
  MIN_INITIAL_REVIEW_COUNT,
} from '@/lib/scheduling';

/**
 * The client-side clamp handlers (speed round-to-tenth + 0.6–2.0 clamp, the
 * "only new" 0/1–10 clamp) duplicate the server clamps in
 * `updateCourseSettings`. They can silently diverge. These tests pin what the
 * CLIENT currently sends for out-of-range values. The real stepper buttons
 * pre-clamp at the control level, so the child controls are stubbed to reach
 * the handlers with raw boundary values.
 */

const { updateSettings, timelineCards, steppers } = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  timelineCards: [] as Array<{
    code: string;
    type: 'base' | 'target';
    plays: number;
    showReorderButtons?: boolean;
    onSpeedChange: (value: number) => void;
  }>,
  steppers: [] as Array<{
    min: number;
    max: number;
    onChange: (value: number) => void;
  }>,
}));

vi.mock('convex/react', () => ({
  useMutation: () =>
    Object.assign(vi.fn(), { withOptimisticUpdate: () => updateSettings }),
  useQuery: () => undefined,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));

// Renders its own Sheet and issues Convex queries; irrelevant here.
vi.mock('@/components/course/CourseLanguageSettings', () => ({
  CourseLanguageSettings: () => null,
}));

// Stubbed so the tests can invoke onSpeedChange/onChange with raw values the
// real buttons could never produce.
vi.mock('@/components/app/learning/TimelineLanguageCard', () => ({
  TimelineLanguageCard: (props: (typeof timelineCards)[number]) => {
    timelineCards.push(props);
    return null;
  },
}));
vi.mock('@/components/app/learning/StepperControl', () => ({
  StepperControl: (props: (typeof steppers)[number]) => {
    steppers.push(props);
    return null;
  },
}));

// jsdom has no ResizeObserver, which Radix's slider thumb measures itself with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const COURSE_ID = 'course_1' as Id<'courses'>;

function renderSettings(settings: Partial<CourseSettings>) {
  render(
    <LearningModeSettings
      open
      onOpenChange={vi.fn()}
      courseSettings={{ courseId: COURSE_ID, ...settings } as CourseSettings}
      baseLanguages={['en']}
      targetLanguages={['ja', 'ko']}
    />,
  );
}

describe('LearningModeSettings: client clamp handlers', () => {
  beforeEach(() => {
    updateSettings.mockClear();
    timelineCards.length = 0;
    steppers.length = 0;
  });

  it('clamps the base-language playback speed to 0.6–2.0', async () => {
    renderSettings({ reviewMode: 'audio' });
    const base = timelineCards.find((c) => c.type === 'base');
    expect(base).toBeDefined();

    for (const [input, expected] of [
      [-1, 0.6],
      [0, 0.6],
      [0.5, 0.6],
      [10, 2],
      [50, 2],
    ] as const) {
      updateSettings.mockClear();
      await base!.onSpeedChange(input);
      expect(updateSettings).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        languagePlaybackSpeeds: { en: expected },
      });
    }
  });

  it('rounds in-range speeds to one decimal before saving', async () => {
    renderSettings({ reviewMode: 'audio' });
    const base = timelineCards.find((c) => c.type === 'base');

    await base!.onSpeedChange(1.2499);
    expect(updateSettings).toHaveBeenLastCalledWith({
      courseId: COURSE_ID,
      languagePlaybackSpeeds: { en: 1.2 },
    });
    await base!.onSpeedChange(1.25);
    expect(updateSettings).toHaveBeenLastCalledWith({
      courseId: COURSE_ID,
      languagePlaybackSpeeds: { en: 1.3 },
    });
  });

  it('clamps the Practice Listening (before-base) speed identically', async () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: true,
      // Distinguishes the before-target card (plays 3) from the after-target
      // card (default plays 2) for the same language code.
      targetBeforeRepetitions: { ja: 3, ko: 3 },
    });
    const before = timelineCards.find(
      (c) => c.type === 'target' && c.code === 'ja' && c.plays === 3,
    );
    expect(before).toBeDefined();

    for (const [input, expected] of [
      [-1, 0.6],
      [0, 0.6],
      [0.5, 0.6],
      [10, 2],
      [50, 2],
    ] as const) {
      updateSettings.mockClear();
      await before!.onSpeedChange(input);
      expect(updateSettings).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        targetBeforePlaybackSpeeds: { ja: expected },
      });
    }
  });

  it('clamps the transcribe after-submit replay speed identically', async () => {
    renderSettings({
      reviewMode: 'full',
      writingInputMode: 'transcribe',
    });
    // The after-submit group renders its cards without reorder buttons; the
    // prompt-group cards (2 targets) render with them.
    const afterSubmit = timelineCards.find(
      (c) => c.code === 'ja' && c.showReorderButtons === false,
    );
    expect(afterSubmit).toBeDefined();

    for (const [input, expected] of [
      [-1, 0.6],
      [0, 0.6],
      [0.5, 0.6],
      [10, 2],
      [50, 2],
    ] as const) {
      updateSettings.mockClear();
      await afterSubmit!.onSpeedChange(input);
      expect(updateSettings).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        transcribeAfterPlaybackSpeeds: { ja: expected },
      });
    }
  });

  it('clamps both listening-strategy steppers into 1–10 (∞ is the Continuously strategy now)', async () => {
    renderSettings({
      reviewMode: 'audio',
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
    });
    // cardsPerBatch is min 1/uncapped-ish, initial reviews min 2/max 10. The
    // two strategy steppers ("Only new" reps, "Until rated Good" count) are
    // the only 1..10 ranges, rendered in that order.
    const strategySteppers = steppers.filter(
      (s) => s.min === 1 && s.max === 10,
    );
    expect(strategySteppers).toHaveLength(2);
    const [onlyNew, untilGood] = strategySteppers;

    for (const [input, expected] of [
      [-1, 1],
      [0, 1],
      [0.5, 1],
      [10, 10],
      [50, 10],
    ] as const) {
      updateSettings.mockClear();
      await onlyNew.onChange(input);
      expect(updateSettings).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        targetBeforeOnlyNewReps: expected,
      });

      updateSettings.mockClear();
      await untilGood.onChange(input);
      expect(updateSettings).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        targetBeforeUntilGoodReps: expected,
      });
    }
  });

  /**
   * Regression: the stepper offered 1-20 while the server rejected anything
   * outside MIN/MAX_INITIAL_REVIEW_COUNT with a hard throw, so stepping past
   * 10 (or below 2) failed the whole save with a generic error toast.
   */
  it('bounds the initial-reviews stepper by the shared scheduling constants', async () => {
    renderSettings({ reviewMode: 'audio' });
    const initialReviews = steppers.find(
      (s) =>
        s.min === MIN_INITIAL_REVIEW_COUNT &&
        s.max === MAX_INITIAL_REVIEW_COUNT,
    );
    expect(initialReviews).toBeDefined();

    // The real StepperControl never emits outside [min, max]; an out-of-range
    // value is CLAMPED rather than dropped, matching `clampInitialReviewCount`
    // on the write paths. Dropping it would strand a stored value above the
    // max: StepperControl disables its minus at `value >= max`, so the control
    // would freeze with no way back into range.
    for (const [out, expected] of [
      [MIN_INITIAL_REVIEW_COUNT - 1, MIN_INITIAL_REVIEW_COUNT],
      [MAX_INITIAL_REVIEW_COUNT + 1, MAX_INITIAL_REVIEW_COUNT],
    ]) {
      updateSettings.mockClear();
      await initialReviews!.onChange(out);
      expect(updateSettings).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        initialReviewCount: expected,
      });
    }

    updateSettings.mockClear();
    await initialReviews!.onChange(MAX_INITIAL_REVIEW_COUNT);
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      initialReviewCount: MAX_INITIAL_REVIEW_COUNT,
    });
  });
});

describe('LearningModeSettings: the Radio scope clamps into its own fields', () => {
  beforeEach(() => {
    updateSettings.mockClear();
    timelineCards.length = 0;
    steppers.length = 0;
  });

  /** Renders with the split on and clicks through to the Radio scope. */
  const inRadioScope = (settings: Partial<CourseSettings>) => {
    renderSettings({
      reviewMode: 'audio',
      separateRadioSettings: true,
      ...settings,
    });
    // Cleared BEFORE the click: the click is what re-renders the sheet under
    // the Radio scope, so the steppers captured after it are the radio ones.
    steppers.length = 0;
    fireEvent.click(screen.getByTestId('settings-scope-radio'));
    updateSettings.mockClear();
  };

  it('both strategy steppers write the *Radio window, clamped to 1-10', async () => {
    inRadioScope({ playTargetBeforeBase: true, playTargetAfterBase: true });
    const strategySteppers = steppers.filter(
      (s) => s.min === 1 && s.max === 10,
    );
    // "Until rated Good" is rendered under the Radio scope too: radio plays
    // can't advance a card's good count, but the count it already carries
    // still graduates it, so the window has to be settable here.
    expect(strategySteppers).toHaveLength(2);
    const [onlyNew, untilGood] = strategySteppers;

    for (const [input, expected] of [
      [-1, 1],
      [0, 1],
      [50, 10],
      [3.7, 3],
    ] as const) {
      updateSettings.mockClear();
      await onlyNew.onChange(input);
      expect(updateSettings).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        targetBeforeOnlyNewRepsRadio: expected,
      });

      updateSettings.mockClear();
      await untilGood.onChange(input);
      expect(updateSettings).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        targetBeforeUntilGoodRepsRadio: expected,
      });
    }
  });

  it('the same steppers still write the shared fields under the Review scope', () => {
    renderSettings({
      reviewMode: 'audio',
      separateRadioSettings: true,
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
    });
    const [, untilGood] = steppers.filter((s) => s.min === 1 && s.max === 10);
    void untilGood.onChange(5);
    expect(updateSettings).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      targetBeforeUntilGoodReps: 5,
    });
  });
});
