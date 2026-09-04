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

function fireScheduleComplete(state: LearningState): boolean {
  renderHook(() => useLearningAudio(state));
  let ahead = false;
  act(() => {
    ahead = (player.lastProps?.onScheduleComplete as () => boolean)();
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
    expect(fireScheduleComplete(state)).toBe(true);
    expect(handleNextOf(state)).toHaveBeenCalledTimes(1);
  });

  it('does nothing with auto-advance off', () => {
    const state = reviewingState(review({ autoAdvance: false }));
    expect(fireScheduleComplete(state)).toBe(false);
    expect(handleNextOf(state)).not.toHaveBeenCalled();
  });

  it('advances but holds the audio back on the review that hits the milestone', () => {
    const state = reviewingState(review(), PROGRESS_DISPLAY_INTERVAL - 1);
    expect(fireScheduleComplete(state)).toBe(false);
    expect(handleNextOf(state)).toHaveBeenCalledTimes(1);
  });

  it('runs ahead on the milestone review when the progress display is off', () => {
    const state = reviewingState(
      review({ progressDisplayEnabled: false }),
      PROGRESS_DISPLAY_INTERVAL - 1,
    );
    expect(fireScheduleComplete(state)).toBe(true);
  });

  it('does not advance while a card action is in flight', () => {
    const state = reviewingState(review());
    renderHook(() => useLearningAudio(state, { disableAutoAdvance: true }));
    let ahead = true;
    act(() => {
      ahead = (player.lastProps?.onScheduleComplete as () => boolean)();
    });
    expect(ahead).toBe(false);
    expect(handleNextOf(state)).not.toHaveBeenCalled();
  });
});
