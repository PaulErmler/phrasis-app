import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Free play is ONE scheduling mode ('radio') with two faces, chosen by
 * `reviewMode`. useLearningAudio is where that choice becomes behaviour:
 *
 *   Shadowing → "Radio":      hands-free: forces autoplay + auto-advance
 *                             regardless of the user's settings.
 *   Writing   → "Free Study": user-paced: resolves the `*Full` playback
 *                             settings and never auto-advances.
 *
 * These tests pin exactly that, by mocking `useAudioPlayer` and inspecting
 * the props the hook feeds it (plus firing `onScheduleComplete`, the
 * auto-advance path).
 */
const player = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
  useAudioPlayer: vi.fn(),
}));

vi.mock('@/hooks/use-audio-player', () => ({
  useAudioPlayer: (props: Record<string, unknown>) => {
    player.lastProps = props;
    return { play: vi.fn(), pause: vi.fn() };
  },
}));

import { useLearningAudio } from '@/components/app/learning/useLearningAudio';
import type { LearningState } from '@/components/app/learning/useLearningMode';

type Settings = Record<string, unknown>;

/** A minimal `reviewing` state carrying just what useLearningAudio reads. */
function reviewingState(courseSettings: Settings): LearningState {
  return {
    status: 'reviewing',
    settingsOpen: false,
    courseSettings,
    cardId: 'card1',
    audioRecordings: [],
    nextCard: null,
    baseLanguages: ['en'],
    targetLanguages: ['es'],
    translations: [],
    audioSpeedOverrides: undefined,
    preReviewCount: 0,
    fsrsState: null,
    radioPlayCount: 0,
    goodReviewCount: 0,
    getReviewInitiatedByThisTab: () => false,
    handleNext: vi.fn(),
    resetReviewFlag: vi.fn(),
    setSettingsOpen: vi.fn(),
  } as unknown as LearningState;
}

/** Free play + the given review mode, with BOTH per-mode autoplay/advance
 *  settings turned off, so anything that ends up on counts as forced. */
const freePlay = (reviewMode: 'audio' | 'full'): Settings => ({
  schedulingMode: 'radio',
  reviewMode,
  autoPlayAudio: false,
  autoPlayAudioFull: false,
  autoAdvance: false,
});

beforeEach(() => {
  player.lastProps = null;
});

describe('useLearningAudio: free-play faces', () => {
  it('forces autoplay in the listening face, despite autoplay being off', () => {
    const { result } = renderHook(() =>
      useLearningAudio(reviewingState(freePlay('audio'))),
    );
    expect(result.current.userAutoPlay).toBe(true);
    expect(player.lastProps?.autoPlay).toBe(true);
  });

  it('leaves autoplay to the user in the writing face', () => {
    const { result } = renderHook(() =>
      useLearningAudio(reviewingState(freePlay('full'))),
    );
    expect(result.current.userAutoPlay).toBe(false);
    expect(player.lastProps?.autoPlay).toBe(false);
  });

  it('auto-advances in the listening face even with auto-advance off', () => {
    const state = reviewingState(freePlay('audio'));
    renderHook(() => useLearningAudio(state));
    act(() => {
      (player.lastProps?.onScheduleComplete as () => void)();
    });
    expect(
      state.status === 'reviewing' && state.handleNext,
    ).toHaveBeenCalledTimes(1);
  });

  it('never auto-advances in the writing face', () => {
    const state = reviewingState(freePlay('full'));
    renderHook(() => useLearningAudio(state));
    act(() => {
      (player.lastProps?.onScheduleComplete as () => void)();
    });
    expect(
      state.status === 'reviewing' && state.handleNext,
    ).not.toHaveBeenCalled();
    // Writing also strips the trailing pause-before-advance from the blob.
    expect((player.lastProps?.settings as Settings).autoAdvance).toBe(false);
  });

  it('resolves the writing-mode playback settings in the writing face', () => {
    // Regression: free play used to force the audio-mode settings in BOTH
    // faces (`isFullMode = reviewMode !== 'audio' && !isRadio`), so the typing
    // face silently borrowed Radio's listening config.
    const base = {
      schedulingMode: 'radio',
      languageRepetitions: { en: 3 },
      languageRepetitionsFull: { en: 1 },
    };
    const { rerender } = renderHook(
      ({ cs }: { cs: Settings }) => useLearningAudio(reviewingState(cs)),
      { initialProps: { cs: { ...base, reviewMode: 'audio' } as Settings } },
    );
    expect((player.lastProps?.settings as { reps: unknown }).reps).toEqual({
      en: 3,
    });

    rerender({ cs: { ...base, reviewMode: 'full' } as Settings });
    expect((player.lastProps?.settings as { reps: unknown }).reps).toEqual({
      en: 1,
    });
  });

  it('counts radio plays toward Practice Listening in the listening face', () => {
    // `radioPlayCount` graduates a card out of Practice Listening. The writing
    // face never reaches this path. `isFullMode` returns the fixed
    // base→target sequence before `applyOnlyNewListening` runs.
    const cs = {
      schedulingMode: 'radio',
      playTargetBeforeBase: true,
      targetBeforeOnlyNewReps: 1,
    };
    const state = reviewingState({ ...cs, reviewMode: 'audio' });
    (state as unknown as { radioPlayCount: number }).radioPlayCount = 5;
    renderHook(() => useLearningAudio(state));
    // 5 radio plays > the 1-rep "only new" window → Practice Listening is off.
    expect((player.lastProps?.settings as Settings).playTargetBefore).toBe(
      false,
    );
  });
});

describe('useLearningAudio: the Radio settings split', () => {
  // A doc where all three copies differ, so whichever one playback picks is
  // unambiguous. `*Full` is present specifically to catch radio chaining
  // through the writing copies instead of branching off audio.
  const split = (extra: Settings = {}): Settings => ({
    schedulingMode: 'radio',
    reviewMode: 'audio',
    languageRepetitions: { es: 3 },
    languageRepetitionsFull: { es: 9 },
    languageRepetitionsRadio: { es: 1 },
    languageRepetitionPauses: { es: 4 },
    languageRepetitionPausesRadio: { es: 0 },
    ...extra,
  });

  const reps = () =>
    (player.lastProps?.settings as { reps: Record<string, number> }).reps;
  const repPauses = () =>
    (player.lastProps?.settings as { repPauses: Record<string, number> })
      .repPauses;

  it('uses the shared review values while the split is off', () => {
    renderHook(() =>
      useLearningAudio(reviewingState(split({ separateRadioSettings: false }))),
    );
    expect(reps()).toEqual({ es: 3 });
    expect(repPauses()).toEqual({ es: 4 });
  });

  it('treats a missing switch as off, so existing docs do not move', () => {
    renderHook(() => useLearningAudio(reviewingState(split())));
    expect(reps()).toEqual({ es: 3 });
  });

  it('uses the radio values once the split is on', () => {
    renderHook(() =>
      useLearningAudio(reviewingState(split({ separateRadioSettings: true }))),
    );
    expect(reps()).toEqual({ es: 1 });
    expect(repPauses()).toEqual({ es: 0 });
  });

  it('Learn & Review is unaffected by the split being on', () => {
    // Same doc, ordinary scheduling: the radio copies must not leak in.
    renderHook(() =>
      useLearningAudio(
        reviewingState(
          split({
            separateRadioSettings: true,
            schedulingMode: 'learnAndReview',
          }),
        ),
      ),
    );
    expect(reps()).toEqual({ es: 3 });
    expect(repPauses()).toEqual({ es: 4 });
  });

  it('Free Study keeps the writing copies, never the radio ones', () => {
    // Free play while typing is Free Study, not Radio. It is a typing session
    // and must not borrow Radio's listening config, split on or not.
    renderHook(() =>
      useLearningAudio(
        reviewingState(
          split({ separateRadioSettings: true, reviewMode: 'full' }),
        ),
      ),
    );
    expect(reps()).toEqual({ es: 9 });
  });

  it('flipping the split swaps the values live, in both directions', () => {
    const { rerender } = renderHook(
      ({ cs }: { cs: Settings }) => useLearningAudio(reviewingState(cs)),
      { initialProps: { cs: split({ separateRadioSettings: true }) } },
    );
    expect(reps()).toEqual({ es: 1 });
    rerender({ cs: split({ separateRadioSettings: false }) });
    expect(reps()).toEqual({ es: 3 });
    rerender({ cs: split({ separateRadioSettings: true }) });
    expect(reps()).toEqual({ es: 1 });
  });

  it('forks Practice Listening independently of Learn & Review', () => {
    const cs = {
      schedulingMode: 'radio',
      reviewMode: 'audio',
      separateRadioSettings: true,
      playTargetBeforeBase: true,
      playTargetAfterBase: true,
      targetBeforeRepetitions: { es: 3 },
      targetBeforeRepetitionsRadio: { es: 1 },
      targetBeforeListeningStrategyRadio: 'continuous',
      targetBeforeListeningStrategy: 'onlyNew',
      targetBeforeOnlyNewReps: 1,
    };
    const state = reviewingState(cs);
    (state as unknown as { radioPlayCount: number }).radioPlayCount = 5;
    renderHook(() => useLearningAudio(state));
    const settings = player.lastProps?.settings as {
      beforeReps: Record<string, number>;
      playTargetBefore: boolean;
    };
    expect(settings.beforeReps).toEqual({ es: 1 });
    // Radio's own 'continuous' strategy wins, so 5 plays do NOT graduate the
    // card the way the shared 'onlyNew' window would have.
    expect(settings.playTargetBefore).toBe(true);
  });

  it('still forces autoplay and auto-advance under the split', () => {
    // The split forks playback shape, not Radio's hands-free nature.
    const state = reviewingState(
      split({ separateRadioSettings: true, autoPlayAudio: false }),
    );
    const { result } = renderHook(() => useLearningAudio(state));
    expect(result.current.userAutoPlay).toBe(true);
    act(() => {
      (player.lastProps?.onScheduleComplete as () => void)();
    });
    expect(
      state.status === 'reviewing' && state.handleNext,
    ).toHaveBeenCalledTimes(1);
  });
});
