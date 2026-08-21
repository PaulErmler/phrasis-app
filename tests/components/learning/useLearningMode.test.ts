import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MockInstance } from 'vitest';

/**
 * Characterization tests for the two refactor-critical behaviors of
 * useLearningMode:
 *  (a) sticky query values. A query flipping value → undefined (refetch)
 *      keeps serving the last resolved value while authenticated, and the
 *      stickiness is fully reset on sign-out;
 *  (b) the exiting-mutation prelude shared by handleDelete / handleNext.
 *      One mutation per invocation, isExiting set before the await,
 *      isReviewing cleared in finally, error paths restoring isExiting
 *      (radio's finally clears isExiting unconditionally).
 *
 * convex/react is mocked with string query refs (same trick as
 * tests/hooks/use-card-approvals.test.ts) so useQuery/useMutation dispatch
 * per function reference.
 */
const harness = vi.hoisted(() => {
  const REFS = {
    getCardForReview: 'scheduling.getCardForReview',
    reviewCard: 'scheduling.reviewCard',
    advanceFreePlayCard: 'scheduling.advanceFreePlayCard',
    undoLastReview: 'scheduling.undoLastReview',
    masterCard: 'scheduling.masterCard',
    hideCard: 'scheduling.hideCard',
    deleteCardPermanently: 'scheduling.deleteCardPermanently',
    toggleFavoriteCard: 'scheduling.toggleFavoriteCard',
    flagTranslation: 'scheduling.flagTranslation',
    regenerateCardAudio: 'scheduling.regenerateCardAudio',
    getActiveCourseSettings: 'courses.getActiveCourseSettings',
    getActiveCourse: 'courses.getActiveCourse',
    getUserSettings: 'courses.getUserSettings',
    updatePinnedCardActions: 'courses.updatePinnedCardActions',
    updateCourseSettings: 'courses.updateCourseSettings',
    setCurrentSessionId: 'courses.setCurrentSessionId',
    addCardsFromCollection: 'decks.addCardsFromCollection',
    ensureUpcomingCardsContent: 'decks.ensureUpcomingCardsContent',
    getCollectionProgress: 'decks.getCollectionProgress',
  } as const;

  type MutationMock = ReturnType<typeof vi.fn> & {
    withOptimisticUpdate: (cb: unknown) => MutationMock;
  };

  const queryValues = new Map<string, unknown>();
  const mutations = new Map<string, MutationMock>();
  const auth = { isAuthenticated: true };

  function mutationFor(ref: string): MutationMock {
    let fn = mutations.get(ref);
    if (!fn) {
      fn = vi.fn(() => Promise.resolve()) as unknown as MutationMock;
      fn.withOptimisticUpdate = () => fn!;
      mutations.set(ref, fn);
    }
    return fn;
  }

  return { REFS, queryValues, mutations, auth, mutationFor };
});

vi.mock('convex/react', () => ({
  useConvexAuth: () => ({
    isAuthenticated: harness.auth.isAuthenticated,
    isLoading: false,
  }),
  useQuery: (ref: string, args?: unknown) =>
    args === 'skip' ? undefined : harness.queryValues.get(ref),
  useMutation: (ref: string) => harness.mutationFor(ref),
}));

// Force distinct query/mutation refs (the generated api proxy has no stable
// string identity to dispatch on).
vi.mock('@/convex/_generated/api', () => {
  const { REFS } = harness;
  return {
    api: {
      features: {
        scheduling: {
          getCardForReview: REFS.getCardForReview,
          reviewCard: REFS.reviewCard,
          advanceFreePlayCard: REFS.advanceFreePlayCard,
          undoLastReview: REFS.undoLastReview,
          masterCard: REFS.masterCard,
          hideCard: REFS.hideCard,
          deleteCardPermanently: REFS.deleteCardPermanently,
          toggleFavoriteCard: REFS.toggleFavoriteCard,
          flagTranslation: REFS.flagTranslation,
          regenerateCardAudio: REFS.regenerateCardAudio,
        },
        courses: {
          getActiveCourseSettings: REFS.getActiveCourseSettings,
          getActiveCourse: REFS.getActiveCourse,
          getUserSettings: REFS.getUserSettings,
          updatePinnedCardActions: REFS.updatePinnedCardActions,
          updateCourseSettings: REFS.updateCourseSettings,
          setCurrentSessionId: REFS.setCurrentSessionId,
        },
        decks: {
          addCardsFromCollection: REFS.addCardsFromCollection,
          ensureUpcomingCardsContent: REFS.ensureUpcomingCardsContent,
          getCollectionProgress: REFS.getCollectionProgress,
        },
      },
    },
  };
});

vi.mock('@/components/feature_tracking/useFeatureQuota', () => ({
  useFeatureQuota: () => ({
    balance: 100,
    included: 100,
    used: 0,
    unlimited: false,
    isAvailable: true,
    isLoading: false,
  }),
}));

import {
  useLearningMode,
  type LearningState,
} from '@/components/app/learning/useLearningMode';

const { REFS } = harness;

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'card1',
    sourceText: 'Hola',
    sourceLanguage: 'es',
    schedulingPhase: 'review',
    preReviewCount: 0,
    dueDate: Date.now(),
    fsrsState: null,
    initialReviewCount: 5,
    radioPlayCount: 0,
    translations: [],
    audioRecordings: [],
    nextCard: null,
    audioSpeedOverrides: undefined,
    isFavorite: false,
    hasMissingContent: false,
    dailyReviewsToday: 3,
    undoableCount: 2,
    ...overrides,
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    courseId: 'course1',
    activeCollectionId: 'col1',
    currentSessionId: 'session-abc',
    reviewMode: 'audio',
    schedulingMode: 'learnAndReview',
    autoAdvance: true,
    autoAddCards: false,
    studyContentFilter: 'all',
    cardsToAddBatchSize: 10,
    ...overrides,
  };
}

function makeCourse(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'course1',
    baseLanguages: ['en'],
    targetLanguages: ['es'],
    ...overrides,
  };
}

function seedReviewing(
  cardOverrides: Record<string, unknown> = {},
  settingsOverrides: Record<string, unknown> = {},
) {
  harness.queryValues.set(REFS.getCardForReview, makeCard(cardOverrides));
  harness.queryValues.set(
    REFS.getActiveCourseSettings,
    makeSettings(settingsOverrides),
  );
  harness.queryValues.set(REFS.getActiveCourse, makeCourse());
}

function reviewing(result: { current: LearningState }) {
  if (result.current.status !== 'reviewing') {
    throw new Error(`expected status "reviewing", got "${result.current.status}"`);
  }
  return result.current;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useLearningMode', () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    harness.queryValues.clear();
    harness.mutations.clear();
    harness.auth.isAuthenticated = true;
    seedReviewing();
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('scheduling phase exposure', () => {
    it('full mode forces the effective phase to review (FSRS ratings)', () => {
      seedReviewing(
        { schedulingPhase: 'preReview', preReviewCount: 0 },
        { reviewMode: 'full' },
      );
      const { result } = renderHook(() => useLearningMode());
      expect(reviewing(result).phase).toBe('review');
    });

    it('audio mode keeps the stored phase', () => {
      seedReviewing({ schedulingPhase: 'preReview', preReviewCount: 0 });
      const { result } = renderHook(() => useLearningMode());
      expect(reviewing(result).phase).toBe('preReview');
    });
  });

  describe('sticky query values', () => {
    it('keeps serving the last card while getCardForReview refetches (undefined)', () => {
      const { result, rerender } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('reviewing');

      harness.queryValues.delete(REFS.getCardForReview);
      rerender();

      const state = reviewing(result);
      expect(state.cardId).toBe('card1');
      expect(state.sourceText).toBe('Hola');
    });

    it('keeps serving the last course settings while getActiveCourseSettings refetches', () => {
      const { result, rerender } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('reviewing');

      harness.queryValues.delete(REFS.getActiveCourseSettings);
      rerender();

      const state = reviewing(result);
      expect(state.courseSettings.courseId).toBe('course1');
      expect(state.reviewMode).toBe('audio');
    });

    it('keeps serving the last active course while getActiveCourse refetches', () => {
      const { result, rerender } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('reviewing');

      harness.queryValues.delete(REFS.getActiveCourse);
      rerender();

      const state = reviewing(result);
      expect(state.baseLanguages).toEqual(['en']);
      expect(state.targetLanguages).toEqual(['es']);
    });

    it('stays reviewing when all three queries refetch at once', () => {
      const { result, rerender } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('reviewing');

      harness.queryValues.delete(REFS.getCardForReview);
      harness.queryValues.delete(REFS.getActiveCourseSettings);
      harness.queryValues.delete(REFS.getActiveCourse);
      rerender();

      expect(reviewing(result).cardId).toBe('card1');
    });

    it('resets sticky values on sign-out and does not revive them on re-auth', () => {
      const { result, rerender } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('reviewing');

      harness.auth.isAuthenticated = false;
      harness.queryValues.delete(REFS.getCardForReview);
      harness.queryValues.delete(REFS.getActiveCourseSettings);
      harness.queryValues.delete(REFS.getActiveCourse);
      rerender();
      expect(result.current.status).toBe('loading');

      // Re-auth with the queries still loading: refs were cleared, so no
      // stale card flashes back.
      harness.auth.isAuthenticated = true;
      rerender();
      expect(result.current.status).toBe('loading');

      seedReviewing();
      rerender();
      expect(result.current.status).toBe('reviewing');
    });
  });

  describe('handleDelete prelude', () => {
    it('fires deleteCardPermanently once, holds isExiting in flight, clears isReviewing on settle', async () => {
      const del = harness.mutationFor(REFS.deleteCardPermanently);
      const gate = deferred();
      del.mockReturnValueOnce(gate.promise);

      const { result } = renderHook(() => useLearningMode());
      expect(reviewing(result).isExiting).toBe(false);

      await act(async () => {
        void reviewing(result).handleDelete();
      });

      expect(del).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledWith({ cardId: 'card1' });
      expect(reviewing(result).isExiting).toBe(true);
      expect(reviewing(result).isReviewing).toBe(true);

      await act(async () => {
        gate.resolve();
        await gate.promise;
      });

      expect(reviewing(result).isReviewing).toBe(false);
      // Same card doc still present + idle → the recovery effect clears
      // isExiting (current behavior for same-id round-trips).
      expect(reviewing(result).isExiting).toBe(false);
    });

    it('ignores re-invocation while the mutation is in flight', async () => {
      const del = harness.mutationFor(REFS.deleteCardPermanently);
      const gate = deferred();
      del.mockReturnValueOnce(gate.promise);

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        void reviewing(result).handleDelete();
      });
      await act(async () => {
        void reviewing(result).handleDelete();
      });
      expect(del).toHaveBeenCalledTimes(1);

      await act(async () => {
        gate.resolve();
        await gate.promise;
      });
    });

    it('restores isExiting=false and clears isReviewing when the mutation rejects', async () => {
      const del = harness.mutationFor(REFS.deleteCardPermanently);
      del.mockRejectedValueOnce(new Error('boom'));

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        await reviewing(result).handleDelete();
      });

      expect(del).toHaveBeenCalledTimes(1);
      expect(reviewing(result).isExiting).toBe(false);
      expect(reviewing(result).isReviewing).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to delete card:',
        expect.any(Error),
      );
    });

    it('fires once when invoked twice in the same tick (the isReviewing state guard has not flushed yet, so a synchronous latch carries it)', async () => {
      const del = harness.mutationFor(REFS.deleteCardPermanently);

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        const state = reviewing(result);
        void state.handleDelete();
        void state.handleDelete();
      });

      expect(del).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleNext: master/hide branches', () => {
    it('pending master: fires masterCard once, never reviewCard, holds isExiting in flight', async () => {
      const master = harness.mutationFor(REFS.masterCard);
      const review = harness.mutationFor(REFS.reviewCard);
      const gate = deferred();
      master.mockReturnValueOnce(gate.promise);

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        reviewing(result).handleMaster();
      });
      expect(reviewing(result).isPendingMaster).toBe(true);

      await act(async () => {
        void reviewing(result).handleNext();
      });

      expect(master).toHaveBeenCalledTimes(1);
      expect(master).toHaveBeenCalledWith({ cardId: 'card1' });
      expect(review).not.toHaveBeenCalled();
      expect(reviewing(result).isExiting).toBe(true);
      expect(reviewing(result).isReviewing).toBe(true);

      await act(async () => {
        gate.resolve();
        await gate.promise;
      });
      expect(reviewing(result).isReviewing).toBe(false);
    });

    it('pending master: restores isExiting=false when masterCard rejects', async () => {
      const master = harness.mutationFor(REFS.masterCard);
      master.mockRejectedValueOnce(new Error('boom'));

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        reviewing(result).handleMaster();
      });
      await act(async () => {
        await reviewing(result).handleNext();
      });

      expect(master).toHaveBeenCalledTimes(1);
      expect(reviewing(result).isExiting).toBe(false);
      expect(reviewing(result).isReviewing).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to master card:',
        expect.any(Error),
      );
    });

    it('pending hide: fires hideCard once and restores isExiting on rejection', async () => {
      const hide = harness.mutationFor(REFS.hideCard);
      const gate = deferred();
      hide.mockReturnValueOnce(gate.promise);

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        reviewing(result).handleHide();
      });
      expect(reviewing(result).isPendingHide).toBe(true);

      await act(async () => {
        void reviewing(result).handleNext();
      });
      expect(hide).toHaveBeenCalledTimes(1);
      expect(hide).toHaveBeenCalledWith({ cardId: 'card1' });
      expect(reviewing(result).isExiting).toBe(true);
      expect(reviewing(result).isReviewing).toBe(true);

      await act(async () => {
        gate.reject(new Error('boom'));
        await gate.promise.catch(() => undefined);
      });

      expect(reviewing(result).isExiting).toBe(false);
      expect(reviewing(result).isReviewing).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to hide card:',
        expect.any(Error),
      );
    });
  });

  describe('handleNext: free-play branch', () => {
    it('fires advanceFreePlayCard once and always clears isExiting on success', async () => {
      seedReviewing({}, { schedulingMode: 'radio' });
      const radio = harness.mutationFor(REFS.advanceFreePlayCard);
      const review = harness.mutationFor(REFS.reviewCard);
      const gate = deferred();
      radio.mockReturnValueOnce(gate.promise);

      const { result } = renderHook(() => useLearningMode());
      expect(reviewing(result).validRatings).toEqual([]);

      await act(async () => {
        void reviewing(result).handleNext();
      });

      expect(radio).toHaveBeenCalledTimes(1);
      const args = radio.mock.calls[0][0] as Record<string, unknown>;
      expect(args.cardId).toBe('card1');
      expect(typeof args.timezone).toBe('string');
      expect(typeof args.timeSpentMs).toBe('number');
      expect(review).not.toHaveBeenCalled();
      expect(reviewing(result).isExiting).toBe(true);
      expect(reviewing(result).isReviewing).toBe(true);

      await act(async () => {
        gate.resolve();
        await gate.promise;
      });

      // Free play's finally clears isExiting unconditionally (same-id decks
      // would otherwise stay blank).
      expect(reviewing(result).isExiting).toBe(false);
      expect(reviewing(result).isReviewing).toBe(false);
    });

    it('clears isExiting and isReviewing even when advanceFreePlayCard rejects', async () => {
      seedReviewing({}, { schedulingMode: 'radio' });
      const radio = harness.mutationFor(REFS.advanceFreePlayCard);
      radio.mockRejectedValueOnce(new Error('boom'));

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        await reviewing(result).handleNext();
      });

      expect(radio).toHaveBeenCalledTimes(1);
      expect(reviewing(result).isExiting).toBe(false);
      expect(reviewing(result).isReviewing).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to advance free-play card:',
        expect.any(Error),
      );
    });

    // Free play is one mode; the server resolves which rotation to advance
    // from `reviewMode`, so the client fires the same mutation in both faces
    // and never rates.
    it.each(['audio', 'full'] as const)(
      'routes free play to advanceFreePlayCard in %s review mode, with no ratings and no reviewCard call',
      async (reviewMode) => {
        seedReviewing({}, { schedulingMode: 'radio', reviewMode });
        const freePlay = harness.mutationFor(REFS.advanceFreePlayCard);
        const review = harness.mutationFor(REFS.reviewCard);

        const { result } = renderHook(() => useLearningMode());
        expect(reviewing(result).validRatings).toEqual([]);

        await act(async () => {
          await reviewing(result).handleNext();
        });

        expect(freePlay).toHaveBeenCalledTimes(1);
        const args = freePlay.mock.calls[0][0] as Record<string, unknown>;
        expect(args.cardId).toBe('card1');
        expect(typeof args.timezone).toBe('string');
        expect(typeof args.timeSpentMs).toBe('number');
        // No face argument. The server reads it off course settings.
        expect(args).not.toHaveProperty('mode');
        expect(review).not.toHaveBeenCalled();
        expect(reviewing(result).isExiting).toBe(false);
        expect(reviewing(result).isReviewing).toBe(false);
      },
    );
  });

  describe('handleNext: review branch', () => {
    it('fires reviewCard once with the phase-default rating and updates daily counters', async () => {
      const review = harness.mutationFor(REFS.reviewCard);
      const gate = deferred<Record<string, unknown>>();
      review.mockReturnValueOnce(gate.promise);

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        void reviewing(result).handleNext();
      });

      expect(review).toHaveBeenCalledTimes(1);
      const args = review.mock.calls[0][0] as Record<string, unknown>;
      expect(args).toMatchObject({
        cardId: 'card1',
        rating: 'good',
        reviewMode: 'audio',
        wasDefaultRating: true,
        sessionId: 'session-abc',
      });
      expect(args).not.toHaveProperty('forceReviewPhase');
      expect(args).not.toHaveProperty('accuracy');
      expect(typeof args.timezone).toBe('string');
      expect(typeof args.timeSpentMs).toBe('number');
      expect(reviewing(result).isExiting).toBe(true);
      expect(reviewing(result).isReviewing).toBe(true);

      await act(async () => {
        void reviewing(result).handleNext();
      });
      expect(review).toHaveBeenCalledTimes(1);

      await act(async () => {
        gate.resolve({
          dailyReviewsToday: 7,
          dailyTimeMsToday: 1000,
          dailyNewWordsToday: 2,
          triggerCelebration: false,
        });
        await gate.promise;
      });

      expect(reviewing(result).isReviewing).toBe(false);
      expect(result.current.dailyReviewsToday).toBe(7);
      expect(result.current.dailyTimeMsToday).toBe(1000);
      expect(result.current.dailyNewWordsToday).toBe(2);
      expect(result.current.sessionCardCount).toBe(1);
    });

    it('restores isExiting=false when reviewCard rejects', async () => {
      const review = harness.mutationFor(REFS.reviewCard);
      review.mockRejectedValueOnce(new Error('boom'));

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        await reviewing(result).handleNext();
      });

      expect(review).toHaveBeenCalledTimes(1);
      expect(reviewing(result).isExiting).toBe(false);
      expect(reviewing(result).isReviewing).toBe(false);
      expect(result.current.sessionCardCount).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to review card:',
        expect.any(Error),
      );
    });
  });
});
