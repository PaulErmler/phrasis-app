import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Ordinary review (Learn & Review, listening face) with auto-advance. The
 * value `onScheduleComplete` returns tells the player whether it may start the
 * prefetched next card's audio before the server has served that card. The
 * one advance that must NOT run ahead is the review about to hit the
 * milestone celebration, which mutes autoplay for the next card.
 */
const player = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock('@/hooks/use-audio-player', () => ({
  useAudioPlayer: (props: Record<string, unknown>) => {
    player.lastProps = props;
    return { play: vi.fn(), pause: vi.fn() };
  },
}));

import { useLearningAudio } from '@/components/app/learning/useLearningAudio';
import type { ScheduleCompleteResult } from '@/hooks/use-audio-player';
import type { LearningState } from '@/components/app/learning/useLearningMode';
import { PROGRESS_DISPLAY_INTERVAL } from '@/lib/constants/learning';

type Settings = Record<string, unknown>;

function reviewingState(
  courseSettings: Settings,
  dailyReviewsToday = 0,
): LearningState {
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
    dailyReviewsToday,
    getReviewInitiatedByThisTab: () => false,
    handleNext: vi.fn(),
    resetReviewFlag: vi.fn(),
    setSettingsOpen: vi.fn(),
  } as unknown as LearningState;
}

const review = (extra: Settings = {}): Settings => ({
  schedulingMode: 'learnAndReview',
  reviewMode: 'audio',
  autoAdvance: true,
  ...extra,
});

function fireScheduleComplete(state: LearningState): ScheduleCompleteResult {
  renderHook(() => useLearningAudio(state));
  let ahead: ScheduleCompleteResult = 'hold';
  act(() => {
    ahead = (player.lastProps?.onScheduleComplete as () => ScheduleCompleteResult)();
  });
  return ahead;
}

const handleNextOf = (state: LearningState) =>
  state.status === 'reviewing' ? state.handleNext : null;

beforeEach(() => {
  player.lastProps = null;
});

describe('useLearningAudio: auto-advance in review', () => {
  it('advances and lets the audio run ahead with auto-advance on', () => {
    const state = reviewingState(review(), 3);
    expect(fireScheduleComplete(state)).toBe('advance');
    expect(handleNextOf(state)).toHaveBeenCalledTimes(1);
  });

  it('does nothing with auto-advance off', () => {
    const state = reviewingState(review({ autoAdvance: false }));
    expect(fireScheduleComplete(state)).toBe('hold');
    expect(handleNextOf(state)).not.toHaveBeenCalled();
  });

  it('advances but holds the audio back on the review that hits the milestone', () => {
    const state = reviewingState(review(), PROGRESS_DISPLAY_INTERVAL - 1);
    expect(fireScheduleComplete(state)).toBe('hold');
    expect(handleNextOf(state)).toHaveBeenCalledTimes(1);
  });

  it('runs ahead on the milestone review when the progress display is off', () => {
    const state = reviewingState(
      review({ progressDisplayEnabled: false }),
      PROGRESS_DISPLAY_INTERVAL - 1,
    );
    expect(fireScheduleComplete(state)).toBe('advance');
  });

  it('does not advance while a card action is in flight', () => {
    const state = reviewingState(review());
    renderHook(() => useLearningAudio(state, { disableAutoAdvance: true }));
    let ahead: ScheduleCompleteResult | undefined;
    act(() => {
      ahead = (player.lastProps?.onScheduleComplete as () => ScheduleCompleteResult)();
    });
    expect(ahead).toBe('hold');
    expect(handleNextOf(state)).not.toHaveBeenCalled();
  });

  it("plays the chime instead of holding when the milestone lands while the page is hidden", () => {
    // Screen locked: the celebration screen is skipped (useLearningMode
    // never flips progressDisplayActive while hidden), so the player must
    // keep going and play the success sound itself.
    const state = reviewingState(review(), PROGRESS_DISPLAY_INTERVAL - 1);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      expect(fireScheduleComplete(state)).toBe('chime');
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    expect(
      state.status === 'reviewing' && state.handleNext,
    ).toHaveBeenCalledTimes(1);
  });
});
