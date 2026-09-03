import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

/**
 * The card VIEW and the audio HOOK have to agree about which copy of the
 * playback settings the current session reads. They used to derive it
 * separately, and when Radio grew its own copies only the hook was updated —
 * so `highlightWordsRadio` was written by the settings sheet, stored, and then
 * never read, while the speed badge kept showing Learn & Review's speed over
 * audio playing at Radio's.
 *
 * These pin the view side: `LearningMode` resolves `highlightWords` and
 * `languagePlaybackSpeeds` through `resolveSettingsMode` for BOTH card
 * components, so it can never resolve a different mode than the blob playing
 * over it.
 */

const cardProps = vi.hoisted(() => ({
  audio: null as Record<string, unknown> | null,
  writing: null as Record<string, unknown> | null,
}));

vi.mock('@/components/app/learning', () => ({
  LearningCardContent: (props: Record<string, unknown>) => {
    cardProps.audio = props;
    return null;
  },
  FullReviewCardContent: (props: Record<string, unknown>) => {
    cardProps.writing = props;
    return null;
  },
  LearningControls: () => null,
  NoCollectionState: () => null,
  NoCardsDueState: () => null,
  ProgressDisplay: () => null,
  SessionProgressBar: () => null,
}));

vi.mock('convex/react', () => ({
  useMutation: () =>
    Object.assign(vi.fn(), { withOptimisticUpdate: () => vi.fn() }),
  useQuery: () => undefined,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock('@/hooks/use-update-course-settings', () => ({
  useUpdateCourseSettings: () => vi.fn(),
}));
vi.mock('@/hooks/use-now-minute', () => ({ useNowMinute: () => 0 }));
vi.mock('@/components/app/learning/LearningChatLayout', () => ({
  useLearningChatToggle: () => ({ openChat: vi.fn() }),
}));
vi.mock('@/components/app/LearningModeSettings', () => ({
  LearningModeSettings: () => null,
}));
vi.mock('@/components/autumn/paywall-dialog', () => ({ default: () => null }));
vi.mock('@/components/app/learning/EditCardDialog', () => ({
  EditCardDialog: () => null,
}));
vi.mock('@/components/app/learning/useCardActions', () => ({
  CardActionConfirmDialogs: () => null,
}));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children }: { children?: React.ReactNode }) =>
          children ?? null,
    },
  ),
}));

import { LearningMode } from '@/components/app/LearningMode';
import type { LearningState } from '@/components/app/learning/useLearningMode';
import type { AudioPlayerState } from '@/hooks/use-audio-player';

type Settings = Record<string, unknown>;

/** All three copies differ, so whichever one the view picks is unambiguous. */
const SPLIT: Settings = {
  courseId: 'course_1',
  highlightWords: true,
  highlightWordsFull: false,
  highlightWordsRadio: false,
  languagePlaybackSpeeds: { es: 1 },
  languagePlaybackSpeedsFull: { es: 3 },
  languagePlaybackSpeedsRadio: { es: 2 },
};

function renderLearningMode(courseSettings: Settings) {
  const state = {
    status: 'reviewing',
    courseSettings,
    cardId: 'card1',
    sourceText: 'hola',
    translations: [],
    audioRecordings: [],
    baseLanguages: ['en'],
    targetLanguages: ['es'],
    reviewMode: courseSettings.reviewMode ?? 'audio',
    phase: 'review',
    fsrsState: null,
    preReviewCount: 0,
    radioPlayCount: 0,
    freeStudyPlayCount: 0,
    goodReviewCount: 0,
    audioSpeedOverrides: undefined,
    settingsOpen: false,
    isExiting: false,
    isReviewing: false,
    isUndoing: false,
    isFavorite: false,
    isPendingHide: false,
    isPendingMaster: false,
    isAddingCards: false,
    canUndo: false,
    flaggedInSession: false,
    activeRating: null,
    validRatings: [],
    ratingIntervals: {},
    pinnedCardActions: [],
    cardActionQuotas: {},
    cardActions: { requestDelete: vi.fn(), requestFlag: vi.fn() },
    batchSize: 10,
    animationKey: 1,
    sessionId: 'session_1',
    sentencesRemaining: 1,
    remainingInCollection: 1,
    dailyReviewsToday: 0,
    dailyNewWordsToday: 0,
    dailyTimeMsToday: 0,
    progressDisplayActive: false,
    progressDisplayReady: false,
    dismissProgressDisplay: vi.fn(),
    handleNext: vi.fn(),
    handleUndo: vi.fn(),
    handleMaster: vi.fn(),
    handleHide: vi.fn(),
    handleFavorite: vi.fn(),
    handleAddCards: vi.fn(),
    handleRegenerateAudio: vi.fn(),
    handleUpdatePinnedActions: vi.fn(),
    setSelectedRating: vi.fn(),
    setAutoRating: vi.fn(),
    setSettingsOpen: vi.fn(),
  } as unknown as LearningState;

  const audio = {
    audioRef: { current: null },
    clock: null,
    durationSec: 0,
    isMerging: false,
    isPlaying: false,
    languageCues: [],
    speedByLanguage: {},
    revealedLanguages: new Set<string>(),
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    preload: vi.fn(),
    seekTo: vi.fn(),
    resetRevealed: vi.fn(),
  } as unknown as AudioPlayerState;

  render(
    <LearningMode
      state={state}
      audio={audio}
      onGoHome={vi.fn()}
      onNavigateToChat={vi.fn()}
      onNavigateToAddCustomCards={vi.fn()}
    />,
  );
}

beforeEach(() => {
  cardProps.audio = null;
  cardProps.writing = null;
});

describe('LearningMode: the card view resolves the session settings mode', () => {
  it('reads the shared values in ordinary Shadowing review', () => {
    renderLearningMode({ ...SPLIT, reviewMode: 'audio' });
    expect(cardProps.audio?.highlightEnabled).toBe(true);
    expect(cardProps.audio?.languagePlaybackSpeeds).toEqual({ es: 1 });
  });

  it('reads the shared values in Radio while the split is off', () => {
    renderLearningMode({
      ...SPLIT,
      reviewMode: 'audio',
      schedulingMode: 'radio',
    });
    expect(cardProps.audio?.highlightEnabled).toBe(true);
    expect(cardProps.audio?.languagePlaybackSpeeds).toEqual({ es: 1 });
  });

  it('reads the *Radio copies in Radio once the split is on', () => {
    // The regression: these used to read the unsuffixed fields, so the Radio
    // copies the settings sheet wrote never reached the card.
    renderLearningMode({
      ...SPLIT,
      reviewMode: 'audio',
      schedulingMode: 'radio',
      separateRadioSettings: true,
    });
    expect(cardProps.audio?.highlightEnabled).toBe(false);
    expect(cardProps.audio?.languagePlaybackSpeeds).toEqual({ es: 2 });
  });

  it('keeps the writing copies in Free Study, never the Radio ones', () => {
    // Free play while typing is Free Study, not Radio.
    renderLearningMode({
      ...SPLIT,
      reviewMode: 'full',
      schedulingMode: 'radio',
      separateRadioSettings: true,
    });
    expect(cardProps.writing?.highlightEnabled).toBe(false);
    expect(cardProps.writing?.languagePlaybackSpeeds).toEqual({ es: 3 });
  });

  it('leaves Learn & Review untouched while the split is on', () => {
    renderLearningMode({
      ...SPLIT,
      reviewMode: 'audio',
      schedulingMode: 'learnAndReview',
      separateRadioSettings: true,
    });
    expect(cardProps.audio?.highlightEnabled).toBe(true);
    expect(cardProps.audio?.languagePlaybackSpeeds).toEqual({ es: 1 });
  });
});
