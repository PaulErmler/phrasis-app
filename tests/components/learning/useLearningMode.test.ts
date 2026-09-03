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
    hasPendingCustomCards: 'decks.hasPendingCustomCards',
  } as const;

  type MutationMock = ReturnType<typeof vi.fn> & {
    withOptimisticUpdate: (cb: unknown) => MutationMock;
    /** The updater the hook registered, kept for the wiring tests. The mock
     *  never applies it on its own. */
    optimisticUpdate?: (localStore: unknown, args: unknown) => void;
  };

  const queryValues = new Map<string, unknown>();
  const mutations = new Map<string, MutationMock>();
  const auth = { isAuthenticated: true };
  // Mutable so the credit-exhaustion tests can drop the balance to 0.
  const quota = { balance: 100, unlimited: false };

  function mutationFor(ref: string): MutationMock {
    let fn = mutations.get(ref);
    if (!fn) {
      fn = vi.fn(() => Promise.resolve()) as unknown as MutationMock;
      fn.withOptimisticUpdate = (cb) => {
        fn!.optimisticUpdate = cb as MutationMock['optimisticUpdate'];
        return fn!;
      };
      mutations.set(ref, fn);
    }
    return fn;
  }

  return { REFS, queryValues, mutations, auth, quota, mutationFor };
});

vi.mock('convex/react', () => ({
  useConvexAuth: () => ({
    isAuthenticated: harness.auth.isAuthenticated,
    isLoading: false,
  }),
  useQuery: (ref: string, args?: unknown) =>
    args === 'skip' ? undefined : harness.queryValues.get(ref),
  // Preloaded handles are string refs here too (see the AppDataProvider mock
  // below). Never `undefined`: mirrors the real hook, which always has at
  // least the SSR-preloaded value.
  usePreloadedQuery: (ref: string) => harness.queryValues.get(ref) ?? null,
  useMutation: (ref: string) => harness.mutationFor(ref),
}));

// The hook reads activeCourse/courseSettings (live values) and the
// getUserSettings preloaded handle from AppDataProvider. Source them from
// the same harness map, with the provider's never-`undefined` contract
// (missing entry → null, as for a user without a course).
vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({
    preloadedSettings: harness.REFS.getUserSettings,
    preloadedCourseSettings: harness.REFS.getActiveCourseSettings,
    preloadedActiveCourse: harness.REFS.getActiveCourse,
    preloadedHomeSummary: 'home.getHomeSummary',
    activeCourse: harness.queryValues.get(harness.REFS.getActiveCourse) ?? null,
    courseSettings:
      harness.queryValues.get(harness.REFS.getActiveCourseSettings) ?? null,
  }),
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
          hasPendingCustomCards: REFS.hasPendingCustomCards,
        },
      },
    },
  };
});

vi.mock('@/components/feature_tracking/useFeatureQuota', () => ({
  useFeatureQuota: () => ({
    balance: harness.quota.balance,
    included: 100,
    used: 100 - harness.quota.balance,
    unlimited: harness.quota.unlimited,
    isAvailable: harness.quota.balance > 0 || harness.quota.unlimited,
    isLoading: false,
  }),
}));

import {
  useLearningMode,
  type LearningState,
} from '@/components/app/learning/useLearningMode';
import { MAX_UNSERVED_ADD_RUNS } from '@/lib/constants/learning';

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
    throw new Error(
      `expected status "reviewing", got "${result.current.status}"`,
    );
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
    harness.quota.balance = 100;
    harness.quota.unlimited = false;
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

    // Course settings and the active course now come from AppDataProvider
    // (never `undefined`; the provider owns the always-warm subscription), so
    // only the card query can refetch to `undefined`. `null` settings mean
    // "no course yet" — that must NOT be masked by stickiness.
    it('a provider-null courseSettings reads as noCollection, not a sticky reviewing state', () => {
      const { result, rerender } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('reviewing');

      harness.queryValues.delete(REFS.getActiveCourseSettings);
      rerender();

      expect(result.current.status).toBe('noCollection');
    });

    it('keeps reviewing (with empty language orders) when the provider has no active course', () => {
      const { result, rerender } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('reviewing');

      harness.queryValues.delete(REFS.getActiveCourse);
      rerender();

      const state = reviewing(result);
      expect(state.baseLanguages).toEqual([]);
      expect(state.targetLanguages).toEqual([]);
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error), {
        op: 'deleteCard',
      });
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error), {
        op: 'masterCard',
      });
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error), {
        op: 'hideCard',
      });
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error), {
        op: 'advanceFreePlayCard',
      });
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
        expect.any(Error),
        expect.objectContaining({ op: 'reviewCard' }),
      );
    });
  });

  describe('auto-add stall guard', () => {
    // Regression: with a minute-quantized query `now`, freshly added cards
    // could be invisible to getCardForReview, so the auto-add effect re-fired
    // on every isAddingCards flip and inserted batches forever (130 cards in
    // 18s). The guard latches auto-add off after MAX_UNSERVED_ADD_RUNS
    // consecutive inserting runs with no card served in between.
    function addResult(overrides: Record<string, unknown> = {}) {
      return {
        cardsAdded: 5,
        totalCardsInDeck: 5,
        scanIncomplete: false,
        ...overrides,
      };
    }

    function seedEmptyDeckWithAutoAdd() {
      harness.queryValues.set(REFS.getCardForReview, null);
      harness.queryValues.set(
        REFS.getActiveCourseSettings,
        makeSettings({ autoAddCards: true }),
      );
      harness.queryValues.set(REFS.getActiveCourse, makeCourse());
    }

    it('asks for the full configured batch even with no credits left', async () => {
      // Premade cards spend credits and custom ones don't, and the server
      // splits the batch between them. Clamping the request to the balance
      // here used to shrink the custom half too: an empty balance floored
      // the whole batch at one card per run.
      harness.quota.balance = 0;
      harness.queryValues.set(REFS.hasPendingCustomCards, true);
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      add.mockResolvedValue(addResult({ cardsAdded: 0, quotaLimited: true }));
      seedEmptyDeckWithAutoAdd();

      renderHook(() => useLearningMode());
      await act(async () => {});

      expect(add).toHaveBeenCalledWith({
        collectionId: 'col1',
        batchSize: 10,
      });
    });

    it('keeps promising a load while custom texts can still be added for free', async () => {
      // The requested fallback: out of credits but custom cards left. The
      // run will produce cards, so the seamless loading state is the honest
      // status, not the no-cards-due screen.
      harness.quota.balance = 0;
      harness.queryValues.set(REFS.hasPendingCustomCards, true);
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      add.mockResolvedValue(addResult({ cardsAdded: 0, scanIncomplete: true }));
      seedEmptyDeckWithAutoAdd();

      const { result } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('loading');
    });

    it('falls back to noCardsDue when neither credits nor custom texts are left', async () => {
      harness.quota.balance = 0;
      harness.queryValues.set(REFS.hasPendingCustomCards, false);
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      add.mockResolvedValue(addResult({ cardsAdded: 0, quotaLimited: true }));
      seedEmptyDeckWithAutoAdd();

      const { result } = renderHook(() => useLearningMode());
      expect(result.current.status).toBe('noCardsDue');
    });

    it('latches auto-add off after MAX_UNSERVED_ADD_RUNS inserting runs with no card served', async () => {
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      add.mockImplementation(() => {
        // Failsafe: without the guard this cadence self-perpetuates forever;
        // reject instead of hanging the test so a regression fails fast.
        if (add.mock.calls.length > 10) {
          return Promise.reject(new Error('runaway auto-add'));
        }
        return Promise.resolve(addResult());
      });
      seedEmptyDeckWithAutoAdd();

      const { result } = renderHook(() => useLearningMode());
      // Drain the add -> resolve -> effect-re-fire cadence to quiescence.
      await act(async () => {});
      await act(async () => {});

      expect(add).toHaveBeenCalledTimes(MAX_UNSERVED_ADD_RUNS);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ op: 'autoAddStall' }),
      );
      // Latched: the empty deck shows noCardsDue instead of a loading screen
      // promising an auto-add that will never serve.
      expect(result.current.status).toBe('noCardsDue');
    });

    it('a served card resets the counter, so add-serve cadences never latch', async () => {
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      seedEmptyDeckWithAutoAdd();

      const gates: Array<ReturnType<typeof deferred<unknown>>> = [];
      add.mockImplementation(() => {
        const gate = deferred<unknown>();
        gates.push(gate);
        return gate.promise;
      });

      const { result, rerender } = renderHook(() => useLearningMode());

      // One more inserting run than the latch threshold, each followed by a
      // served card before the next: the counter must keep resetting.
      for (let round = 0; round < MAX_UNSERVED_ADD_RUNS + 1; round++) {
        await act(async () => {});
        expect(add).toHaveBeenCalledTimes(round + 1);

        // The just-added card arrives (query flips to a served card) with
        // more behind it, so the last-card pre-add stays out of this
        // cadence...
        harness.queryValues.set(
          REFS.getCardForReview,
          makeCard({
            _id: `card-${round}`,
            nextCard: { _id: `card-${round}-next` },
          }),
        );
        rerender();
        await act(async () => {
          gates[round].resolve(addResult());
        });
        expect(result.current.status).toBe('reviewing');

        // ...and later the deck runs empty again (not after the last
        // round, which would fire one further in-flight add).
        if (round < MAX_UNSERVED_ADD_RUNS) {
          harness.queryValues.set(REFS.getCardForReview, null);
          rerender();
        }
      }

      expect(add).toHaveBeenCalledTimes(MAX_UNSERVED_ADD_RUNS + 1);
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ op: 'autoAddStall' }),
      );
    });
  });

  describe('optimistic advance wiring', () => {
    // Both advance mutations register `advanceToNextCardOptimistic`; the
    // updater itself is covered in optimisticAdvance.test.ts. Here: it is
    // attached, and with the right "counts as a review" flag.
    function applyUpdater(ref: string) {
      // The server's preview is a bare card result: it carries no nextCard
      // of its own (the fake's default `nextCard: null` would leak through
      // the updater's spread and read as the last-card signal).
      const { nextCard: _omitted, ...preview } = makeCard({ _id: 'card2' });
      const shown = makeCard({ nextCard: preview });
      const writes: unknown[] = [];
      const store = {
        getAllQueries: () => [{ args: {}, value: shown }],
        setQuery: (_ref: unknown, _args: unknown, value: unknown) =>
          writes.push(value),
        getQuery: () => undefined,
      };
      const updater = harness.mutationFor(ref).optimisticUpdate;
      expect(updater).toBeTypeOf('function');
      updater!(store, { cardId: 'card1' });
      return writes[0] as Record<string, unknown>;
    }

    it('reviewCard swaps to the next card and counts a review', () => {
      renderHook(() => useLearningMode());
      const swapped = applyUpdater(REFS.reviewCard);
      expect(swapped).toMatchObject({
        _id: 'card2',
        dailyReviewsToday: 4,
        undoableCount: 3,
      });
      // Unknown until the server answers, never `null` (the last-card signal).
      expect(swapped.nextCard).toBeUndefined();
    });

    it('advanceFreePlayCard swaps to the next card without counting a review', () => {
      seedReviewing({}, { schedulingMode: 'radio' });
      renderHook(() => useLearningMode());
      const swapped = applyUpdater(REFS.advanceFreePlayCard);
      expect(swapped).toMatchObject({
        _id: 'card2',
        dailyReviewsToday: 3,
        undoableCount: 3,
      });
      expect(swapped.nextCard).toBeUndefined();
    });
  });

  /**
   * Since the optimistic advance the next card is on screen (and typed
   * into) while the previous card's review is still in flight. A press
   * made on it in that window used to be dropped silently; now it is
   * replayed once the mutation settles, and only if that card is still
   * the one on screen.
   */
  describe('handleNext: advance queued behind an in-flight review', () => {
    const settled = {
      dailyReviewsToday: 4,
      dailyTimeMsToday: 100,
      dailyNewWordsToday: 0,
      triggerCelebration: false,
    };

    it('replays an advance pressed on the optimistically shown next card', async () => {
      const review = harness.mutationFor(REFS.reviewCard);
      const gate = deferred<Record<string, unknown>>();
      review
        .mockReturnValueOnce(gate.promise)
        .mockResolvedValueOnce({ ...settled, dailyReviewsToday: 5 });

      const { result, rerender } = renderHook(() => useLearningMode());
      await act(async () => {
        void reviewing(result).handleNext();
      });
      expect(review).toHaveBeenCalledTimes(1);

      // The optimistic swap: card2 is on screen while card1 is in flight.
      harness.queryValues.set(
        REFS.getCardForReview,
        makeCard({ _id: 'card2' }),
      );
      rerender();
      await act(async () => {
        void reviewing(result).handleNext();
      });
      expect(review).toHaveBeenCalledTimes(1);

      await act(async () => {
        gate.resolve(settled);
        await gate.promise;
      });

      expect(review).toHaveBeenCalledTimes(2);
      expect(review.mock.calls[1][0]).toMatchObject({ cardId: 'card2' });
    });

    it('still ignores a repeat press on the very card in flight', async () => {
      const review = harness.mutationFor(REFS.reviewCard);
      const gate = deferred<Record<string, unknown>>();
      review.mockReturnValueOnce(gate.promise);

      const { result } = renderHook(() => useLearningMode());
      await act(async () => {
        void reviewing(result).handleNext();
      });
      await act(async () => {
        void reviewing(result).handleNext();
      });
      await act(async () => {
        gate.resolve(settled);
        await gate.promise;
      });
      expect(review).toHaveBeenCalledTimes(1);
    });

    it('drops the queued advance when the previous card comes back (rejected review)', async () => {
      const review = harness.mutationFor(REFS.reviewCard);
      const gate = deferred<Record<string, unknown>>();
      review.mockReturnValueOnce(gate.promise);

      const { result, rerender } = renderHook(() => useLearningMode());
      await act(async () => {
        void reviewing(result).handleNext();
      });
      harness.queryValues.set(
        REFS.getCardForReview,
        makeCard({ _id: 'card2' }),
      );
      rerender();
      await act(async () => {
        void reviewing(result).handleNext();
      });

      // Convex rolls the optimistic swap back on failure: card1 returns.
      harness.queryValues.set(
        REFS.getCardForReview,
        makeCard({ _id: 'card1' }),
      );
      rerender();
      await act(async () => {
        gate.reject(new Error('boom'));
        await gate.promise.catch(() => undefined);
      });
      expect(review).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The next batch is added while the LAST due card is still on screen, so
   * the hand-over after its submit is seamless instead of a loading gap.
   * The trigger is the server's `nextCard === null`; the optimistic advance
   * leaves the preview `undefined`, which must not count.
   */
  describe('auto-add: pre-add on the last card of the queue', () => {
    function addResult(overrides: Record<string, unknown> = {}) {
      return {
        cardsAdded: 3,
        totalCardsInDeck: 8,
        scanIncomplete: false,
        ...overrides,
      };
    }

    it('adds the next batch once while the last due card is shown', async () => {
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      add.mockResolvedValue(addResult());
      seedReviewing({ nextCard: null }, { autoAddCards: true });

      const { result, rerender } = renderHook(() => useLearningMode());
      await act(async () => {});
      // Queued behind the card on screen, so the batch cannot overtake it.
      expect(add).toHaveBeenCalledExactlyOnceWith({
        collectionId: 'col1',
        batchSize: 10,
        afterCardId: 'card1',
      });
      // The card stays on screen, the user is still typing: no second run.
      rerender();
      await act(async () => {});
      expect(add).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('reviewing');

      // The server's next payload carries the added card as the preview.
      harness.queryValues.set(
        REFS.getCardForReview,
        makeCard({ nextCard: { _id: 'card-added' } }),
      );
      rerender();
      await act(async () => {});
      expect(add).toHaveBeenCalledTimes(1);
    });

    it('does not fire on the optimistic advance, whose preview is merely unknown', async () => {
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      add.mockResolvedValue(addResult());
      seedReviewing({ nextCard: undefined }, { autoAddCards: true });

      renderHook(() => useLearningMode());
      await act(async () => {});
      expect(add).not.toHaveBeenCalled();
    });

    it('waits for the regular path behind the difficulty check instead of raising the hold over the card', async () => {
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      add.mockResolvedValue(addResult());
      seedReviewing({ nextCard: null }, { autoAddCards: true });

      const { result } = renderHook(() =>
        useLearningMode({ holdAutoAdd: true }),
      );
      await act(async () => {});
      expect(add).not.toHaveBeenCalled();
      expect(result.current.autoAddHeld).toBe(false);
    });

    it('stays off when auto-add is disabled', async () => {
      const add = harness.mutationFor(REFS.addCardsFromCollection);
      seedReviewing({ nextCard: null }, { autoAddCards: false });
      renderHook(() => useLearningMode());
      await act(async () => {});
      expect(add).not.toHaveBeenCalled();
    });
  });
});
