'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import {
  usePreloadedQuery,
  useQuery,
  useMutation,
  Preloaded,
  useConvexAuth,
} from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import {
  getValidRatings,
  getDefaultRating,
  formatInterval,
  scheduleCard,
  type ReviewRating,
  type SchedulingPhase,
  type CardSchedulingState,
} from '@/lib/scheduling';
import {
  DEFAULT_BATCH_SIZE,
  type CardTranslation,
  type CardAudioRecording,
  type CourseSettings,
} from './types';
import type { SchedulingMode } from '@/convex/types';
import { getUserTimezone } from '@/lib/timezone';
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import {
  ENSURE_CONTENT_REVIEW_INTERVAL,
  PROGRESS_DISPLAY_INTERVAL,
} from '@/lib/constants/learning';
import { tokenizeText } from '@/lib/wordTokenize';

function effectivePhase(
  reviewMode: string,
  rawPhase: SchedulingPhase,
): SchedulingPhase {
  return reviewMode === 'full' ? 'review' : rawPhase;
}

// ============================================================================
// Discriminated union return type
// ============================================================================

interface BaseState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  // Progress display — orthogonal to status. A milestone hit on the very last
  // card flips `progressDisplayActive` to true while `status` flips to
  // `noCardsDue` on the next render; LearningMode renders the celebration
  // first regardless of underlying status, so the user always gets the reward
  // before the "no cards due" screen takes over.
  sessionId: string;
  dailyReviewsToday: number;
  dailyTimeMsToday: number;
  dailyNewWordsToday: number;
  practicedWordsThisSession: number;
  progressDisplayActive: boolean;
  /** True once the milestone-triggering mutation has resolved; gates the
   * celebration audio + counter animations so they fire against fresh data. */
  progressDisplayReady: boolean;
  dismissProgressDisplay: () => void;
  /** Default `'learnAndReview'` when no active course is loaded yet. */
  schedulingMode: SchedulingMode;
}

interface LoadingState extends BaseState {
  status: 'loading';
}

interface NoCollectionState extends BaseState {
  status: 'noCollection';
  courseSettings: CourseSettings | null;
  baseLanguages: string[];
  targetLanguages: string[];
}

interface NoCardsDueState extends BaseState {
  status: 'noCardsDue';
  courseSettings: CourseSettings;
  baseLanguages: string[];
  targetLanguages: string[];
  handleAddCards: () => void;
  isAddingCards: boolean;
  batchSize: number;
  sentencesRemaining: number | null;
  remainingInCollection: number | null;
  handleSchedulingModeChange: (mode: SchedulingMode) => void;
}

export interface NextCardPreview {
  cardId: Id<'cards'>;
  audioRecordings: CardAudioRecording[];
}

interface ReviewingState extends BaseState {
  status: 'reviewing';
  courseSettings: CourseSettings;
  baseLanguages: string[];
  targetLanguages: string[];
  // Card data
  cardId: Id<'cards'>;
  phase: SchedulingPhase;
  preReviewCount: number;
  fsrsState: { reps: number } | null;
  sourceText: string;
  sourceLanguage: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  /** The next due card, populated when one exists. Used by the audio player
   * to pre-merge upcoming audio so playback starts instantly on card advance. */
  nextCard: NextCardPreview | null;
  audioSpeedOverrides: Record<string, number> | undefined;
  // Rating data
  validRatings: ReviewRating[];
  activeRating: ReviewRating;
  ratingIntervals: Record<string, string>;
  // Card flags
  isFavorite: boolean;
  isPendingMaster: boolean;
  isPendingHide: boolean;
  // Handlers
  handleMaster: () => void;
  handleHide: () => void;
  handleFavorite: () => void;
  handleDelete: () => Promise<void>;
  handleNext: (ratingOverride?: ReviewRating, accuracy?: number) => void;
  setSelectedRating: (rating: ReviewRating) => void;
  // Status flags
  isReviewing: boolean;
  isExiting: boolean;
  animationKey: number;
  // Cross-tab audio coordination
  getReviewInitiatedByThisTab: () => boolean;
  resetReviewFlag: () => void;
  // Scheduling mode
  handleSchedulingModeChange: (mode: SchedulingMode) => void;
}

export type LearningState =
  | LoadingState
  | NoCollectionState
  | NoCardsDueState
  | ReviewingState;

export interface PreloadedLearningData {
  courseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  activeCourse: Preloaded<typeof api.features.courses.getActiveCourse>;
}

// ============================================================================
// Hook
// ============================================================================

export function useLearningMode(
  preloaded: PreloadedLearningData,
): LearningState {
  const t = useTranslations('LearningMode');
  const { isAuthenticated } = useConvexAuth();

  const cardForReviewQuery = useQuery(api.features.scheduling.getCardForReview, {});
  const courseSettingsQuery = usePreloadedQuery(preloaded.courseSettings);
  const activeCourseQuery = usePreloadedQuery(preloaded.activeCourse);

  // Hydrate today's review count on mount so the in-session progress bar
  // reflects real progress rather than starting at 0 each page load. After
  // the first reviewCard mutation we use its return value (no extra query).
  const todayCountQuery = useQuery(
    api.features.stats.getTodayReviewCount,
    isAuthenticated ? { timezone: getUserTimezone() } : 'skip',
  );

  const lastCardRef = useRef<
    Exclude<typeof cardForReviewQuery, undefined> | undefined
  >(undefined);
  const lastReviewingCardRef = useRef<
    NonNullable<typeof cardForReviewQuery> | undefined
  >(undefined);
  const receivedCardRef = useRef(false);
  const lastCourseSettingsRef = useRef<
    Exclude<typeof courseSettingsQuery, undefined> | undefined
  >(undefined);
  const receivedCourseSettingsRef = useRef(false);
  const lastActiveCourseRef = useRef<
    Exclude<typeof activeCourseQuery, undefined> | undefined
  >(undefined);
  const receivedActiveCourseRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      receivedCardRef.current = false;
      lastCardRef.current = undefined;
      lastReviewingCardRef.current = undefined;
      receivedCourseSettingsRef.current = false;
      lastCourseSettingsRef.current = undefined;
      receivedActiveCourseRef.current = false;
      lastActiveCourseRef.current = undefined;
      return;
    }
    if (cardForReviewQuery !== undefined) {
      receivedCardRef.current = true;
      lastCardRef.current = cardForReviewQuery;
    }
    if (cardForReviewQuery != null) {
      lastReviewingCardRef.current = cardForReviewQuery;
    }
    if (courseSettingsQuery !== undefined) {
      receivedCourseSettingsRef.current = true;
      lastCourseSettingsRef.current = courseSettingsQuery;
    }
    if (activeCourseQuery !== undefined) {
      receivedActiveCourseRef.current = true;
      lastActiveCourseRef.current = activeCourseQuery;
    }
  }, [
    isAuthenticated,
    cardForReviewQuery,
    courseSettingsQuery,
    activeCourseQuery,
  ]);

  useEffect(() => {
    lastReviewingCardRef.current = undefined;
  }, [courseSettingsQuery?.activeCollectionId]);

  const cardForReview =
    cardForReviewQuery !== undefined
      ? cardForReviewQuery
      : isAuthenticated && receivedCardRef.current
        ? lastCardRef.current
        : undefined;

  const courseSettings =
    courseSettingsQuery !== undefined
      ? courseSettingsQuery
      : isAuthenticated && receivedCourseSettingsRef.current
        ? lastCourseSettingsRef.current
        : undefined;

  const activeCourse =
    activeCourseQuery !== undefined
      ? activeCourseQuery
      : isAuthenticated && receivedActiveCourseRef.current
        ? lastActiveCourseRef.current
        : undefined;

  const reviewCardMutation = useMutation(api.features.scheduling.reviewCard);

  const masterCardMutation = useMutation(api.features.scheduling.masterCard);
  const hideCardMutation = useMutation(api.features.scheduling.hideCard);
  const deleteCardMutation = useMutation(
    api.features.scheduling.deleteCardPermanently,
  );

  const toggleFavoriteCardMutation = useMutation(
    api.features.scheduling.toggleFavoriteCard,
  ).withOptimisticUpdate((localStore) => {
    const current = localStore.getQuery(
      api.features.scheduling.getCardForReview,
      {},
    );
    if (current != null) {
      localStore.setQuery(api.features.scheduling.getCardForReview, {}, {
        ...current,
        isFavorite: !(current.isFavorite ?? false),
      });
    }
  });
  const addCardsMutation = useMutation(
    api.features.decks.addCardsFromCollection,
  );
  const ensureUpcomingContentMutation = useMutation(
    api.features.decks.ensureUpcomingCardsContent,
  );
  const updateCourseSettingsMutation = useMutation(
    api.features.courses.updateCourseSettings,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getActiveCourseSettings,
      {},
    );
    if (current !== undefined && current !== null) {
      const { courseId, ...updates } = args;
      localStore.setQuery(
        api.features.courses.getActiveCourseSettings,
        {},
        { ...current, ...updates },
      );
    }
  });
  const sentencesQuota = useFeatureQuota(FEATURE_IDS.SENTENCES);

  const collectionProgress = useQuery(api.features.decks.getCollectionProgress, {});

  const [isReviewing, setIsReviewing] = useState(false);
  const [isAddingCards, setIsAddingCards] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRating, setSelectedRating] = useState<ReviewRating | null>(
    null,
  );
  const [isPendingMaster, setIsPendingMaster] = useState(false);
  const [isPendingHide, setIsPendingHide] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [cardAnimationKey, setCardAnimationKey] = useState(0);

  // ----- Progress display (every PROGRESS_DISPLAY_INTERVAL reviews per day) -----
  const sessionIdRef = useRef<string>('');
  const sessionCourseIdRef = useRef<string | null>(null);
  // Unique normalized tokens encountered since the last session reset. Used
  // by the fallback hero metric. Grows for the lifetime of one session — at
  // ~10–20 unique words per card and a 20-card session, ~200–400 entries
  // before reset, so memory stays trivially bounded.
  const practicedWordsRef = useRef<Set<string>>(new Set());
  // Card-id dedupe so we don't re-tokenize the same card when scheduling
  // bounces a card back. Reset alongside `practicedWordsRef`.
  const tokenizedCardsRef = useRef<Set<string>>(new Set());
  const [practicedWordsThisSession, setPracticedWordsThisSession] = useState(0);

  function mintSessionId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  // Mint a fresh id and clear the per-session tracking sets. Used both on
  // course change AND after every milestone dismissal — each celebration
  // shows only words discovered since the previous one.
  function resetSessionLocalState() {
    sessionIdRef.current = mintSessionId();
    practicedWordsRef.current = new Set();
    tokenizedCardsRef.current = new Set();
  }

  const activeCourseIdForSession = activeCourseQuery?._id ?? null;
  const [dailyReviewsToday, setDailyReviewsToday] = useState(0);
  const [dailyTimeMsToday, setDailyTimeMsToday] = useState(0);
  const [dailyNewWordsToday, setDailyNewWordsToday] = useState(0);
  if (
    !sessionIdRef.current ||
    sessionCourseIdRef.current !== activeCourseIdForSession
  ) {
    resetSessionLocalState();
    sessionCourseIdRef.current = activeCourseIdForSession;
    // Setting state during render is the React-recommended pattern for
    // derived state when a "prop" (here: active course id) changes. Setters
    // are no-ops if the value is unchanged, so this only re-renders when
    // there's actually a course switch to clean up after.
    setPracticedWordsThisSession(0);
  }
  // Two flags for the celebration:
  //  - `active`  flips optimistically *before* the mutation awaits, so the
  //              audio hook treats `disableAutoPlay=true` and the next card
  //              never gets a chance to start playing. The shell holds an
  //              empty placeholder during this window.
  //  - `ready`   flips *after* the mutation resolves and the server has
  //              confirmed the milestone via `triggerCelebration`. Audio +
  //              counter animations gate on this so they always start
  //              against fresh post-mutation data.
  const [progressDisplayActive, setProgressDisplayActive] = useState(false);
  const [progressDisplayReady, setProgressDisplayReady] = useState(false);
  const hasHydratedDailyCountRef = useRef(false);
  useEffect(() => {
    if (hasHydratedDailyCountRef.current) return;
    if (todayCountQuery === undefined) return;
    hasHydratedDailyCountRef.current = true;
    setDailyReviewsToday(todayCountQuery);
  }, [todayCountQuery]);

  const dismissProgressDisplay = useCallback(() => {
    setProgressDisplayActive(false);
    setProgressDisplayReady(false);
    // Sessions reset on dismissal: the next celebration shows only words
    // discovered since this point, not the cumulative total. The new id
    // takes effect from the next review's mutation onward — the celebration
    // we just dismissed already finished its queries against the old id.
    resetSessionLocalState();
    setPracticedWordsThisSession(0);
  }, []);

  // Track when the current card was first shown (for time-spent stats)
  const cardShownAtRef = useRef<number>(Date.now());

  // Cross-tab coordination: only the tab that initiated the review should auto-play
  const reviewInitiatedByThisTabRef = useRef(true); // true initially so first card auto-plays

  const getReviewInitiatedByThisTab = useCallback(
    () => reviewInitiatedByThisTabRef.current,
    [],
  );

  const resetReviewFlag = useCallback(() => {
    reviewInitiatedByThisTabRef.current = false;
  }, []);

  const prevCardIdForEnsureRef = useRef<string | null>(null);
  const reviewsSinceEnsureRef = useRef(ENSURE_CONTENT_REVIEW_INTERVAL);
  const ensureInFlightRef = useRef(false);

  useEffect(() => {
    if (!cardForReview || ensureInFlightRef.current) return;

    if (prevCardIdForEnsureRef.current === cardForReview._id) return;

    if (prevCardIdForEnsureRef.current !== null) {
      reviewsSinceEnsureRef.current++;
    }
    prevCardIdForEnsureRef.current = cardForReview._id;

    const shouldEnsure =
      cardForReview.hasMissingContent ||
      reviewsSinceEnsureRef.current >= ENSURE_CONTENT_REVIEW_INTERVAL;
    if (!shouldEnsure) return;

    reviewsSinceEnsureRef.current = 0;
    ensureInFlightRef.current = true;
    ensureUpcomingContentMutation()
      .catch((err) => {
        console.error('Failed to ensure upcoming cards content:', err);
      })
      .finally(() => {
        ensureInFlightRef.current = false;
      });
  }, [cardForReview?._id, cardForReview?.hasMissingContent, ensureUpcomingContentMutation]);

  // --------------------------------------------------------------------------
  // Add cards
  // --------------------------------------------------------------------------
  const handleAddCards = useCallback(async () => {
    if (!courseSettings?.activeCollectionId || isAddingCards) return;
    const configuredBatch = courseSettings.cardsToAddBatchSize ?? DEFAULT_BATCH_SIZE;
    const effectiveBatch = sentencesQuota.unlimited
      ? configuredBatch
      : Math.min(configuredBatch, Math.max(1, sentencesQuota.balance));
    setIsAddingCards(true);
    try {
      await addCardsMutation({
        collectionId: courseSettings.activeCollectionId,
        batchSize: effectiveBatch,
      });
    } catch (error) {
      console.error('Failed to add cards:', error);
    } finally {
      setIsAddingCards(false);
    }
  }, [courseSettings, isAddingCards, addCardsMutation, sentencesQuota]);

  // Auto-add cards when enabled and no cards due
  useEffect(() => {
    if (
      cardForReview === null &&
      courseSettings?.autoAddCards &&
      courseSettings?.activeCollectionId &&
      !isAddingCards &&
      !settingsOpen
    ) {
      handleAddCards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardForReview, courseSettings?.autoAddCards, settingsOpen]);

  // Reset selectedRating, pending master/hide state, exit flag, and card timer when card changes
  useEffect(() => {
    setSelectedRating(null);
    setIsPendingMaster(false);
    setIsPendingHide(false);
    setIsExiting(false);
    cardShownAtRef.current = Date.now();
  }, [cardForReview?._id]);

  // Tokenize each card's languages once per session so we can count unique
  // words practiced. Used as the fallback hero metric on the progress display
  // when no new words were encountered.
  useEffect(() => {
    if (!cardForReview) return;
    const cardKey = String(cardForReview._id);
    if (tokenizedCardsRef.current.has(cardKey)) return;
    tokenizedCardsRef.current.add(cardKey);

    const set = practicedWordsRef.current;
    const before = set.size;
    const sourceLang = cardForReview.sourceLanguage;
    if (sourceLang) {
      for (const t of tokenizeText(cardForReview.sourceText, sourceLang)) {
        set.add(`${sourceLang}:${t.normalized}`);
      }
    }
    for (const tr of cardForReview.translations) {
      for (const t of tokenizeText(tr.text, tr.language)) {
        set.add(`${tr.language}:${t.normalized}`);
      }
    }
    if (set.size !== before) setPracticedWordsThisSession(set.size);
  }, [cardForReview]);

  // --------------------------------------------------------------------------
  // Review / master / hide
  // --------------------------------------------------------------------------
  const reviewMode = courseSettings?.reviewMode ?? 'audio';

  // Opt-out: undefined (pre-migration rows or unset) defaults to enabled.
  const progressDisplayEnabled = courseSettings?.progressDisplayEnabled ?? true;

  const handleReview = useCallback(
    async (rating: ReviewRating, wasDefaultRating: boolean, accuracy?: number) => {
      if (!cardForReview || isReviewing) return;
      reviewInitiatedByThisTabRef.current = true;
      setCardAnimationKey((k) => k + 1);
      setIsExiting(true);
      setIsReviewing(true);

      // Predict the milestone *before* awaiting the mutation so we can flip
      // `progressDisplayActive=true` synchronously — by the time the next
      // card's data lands via Convex reactivity, `disableAutoPlay` is already
      // true and the audio for the next card never starts. This is best-effort
      // (the local count can be stale across tabs); the server's
      // `triggerCelebration` is the authoritative verdict.
      const predictedCount = dailyReviewsToday + 1;
      const predictedMilestone =
        progressDisplayEnabled &&
        predictedCount > 0 &&
        predictedCount % PROGRESS_DISPLAY_INTERVAL === 0;
      if (predictedMilestone) {
        setProgressDisplayActive(true);
      }

      try {
        const result = await reviewCardMutation({
          cardId: cardForReview._id,
          rating,
          timeSpentMs: Math.max(0, Date.now() - cardShownAtRef.current),
          timezone: getUserTimezone(),
          ...(reviewMode === 'full' && { forceReviewPhase: true }),
          reviewMode,
          wasDefaultRating,
          sessionId: sessionIdRef.current,
          ...(accuracy != null && { accuracy: accuracy / 100 }),
        });
        setDailyReviewsToday(result.dailyReviewsToday);
        setDailyTimeMsToday(result.dailyTimeMsToday);
        setDailyNewWordsToday(result.dailyNewWordsToday);

        if (result.triggerCelebration) {
          setProgressDisplayActive(true);
          // Mutation has resolved — daily totals are fresh and userWords for
          // this review are committed, so the celebration's queries will
          // return post-mutation data on their next refetch. Now safe to
          // mount CelebrationContent and start audio + animations.
          setProgressDisplayReady(true);
        } else {
          // Server says no celebration — roll back the optimistic flip.
          setProgressDisplayActive(false);
          setProgressDisplayReady(false);
        }
        setSelectedRating(null);
      } catch (error) {
        console.error('Failed to review card:', error);
        if (predictedMilestone) {
          setProgressDisplayActive(false);
          setProgressDisplayReady(false);
        }
        setIsExiting(false);
      } finally {
        setIsReviewing(false);
      }
    },
    [
      cardForReview,
      isReviewing,
      reviewCardMutation,
      reviewMode,
      progressDisplayEnabled,
      dailyReviewsToday,
    ],
  );

  const handleMaster = useCallback(() => {
    setIsPendingMaster((prev) => !prev);
    setIsPendingHide(false);
  }, []);

  const handleHide = useCallback(() => {
    setIsPendingHide((prev) => !prev);
    setIsPendingMaster(false);
  }, []);

  const handleFavorite = useCallback(async () => {
    if (!cardForReview) return;
    try {
      await toggleFavoriteCardMutation({ cardId: cardForReview._id });
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  }, [cardForReview, toggleFavoriteCardMutation]);

  const handleDelete = useCallback(async () => {
    if (!cardForReview || isReviewing) return;
    reviewInitiatedByThisTabRef.current = true;
    setCardAnimationKey((k) => k + 1);
    setIsExiting(true);
    setIsReviewing(true);
    try {
      await deleteCardMutation({ cardId: cardForReview._id });
    } catch (error) {
      console.error('Failed to delete card:', error);
      setIsExiting(false);
    } finally {
      setIsReviewing(false);
    }
  }, [cardForReview, isReviewing, deleteCardMutation]);

  // --------------------------------------------------------------------------
  // Scheduling mode
  // --------------------------------------------------------------------------
  const handleSchedulingModeChange = useCallback(
    (mode: SchedulingMode) => {
      if (!courseSettings?.courseId) return;
      void updateCourseSettingsMutation({
        courseId: courseSettings.courseId,
        schedulingMode: mode,
      }).catch((error) => {
        console.error('Failed to update scheduling mode:', error);
      });
    },
    [courseSettings?.courseId, updateCourseSettingsMutation],
  );

  // --------------------------------------------------------------------------
  // Next
  // --------------------------------------------------------------------------
  const handleNext = useCallback(async (ratingOverride?: ReviewRating, accuracy?: number) => {
    if (!cardForReview || isReviewing) return;
    if (isPendingMaster) {
      reviewInitiatedByThisTabRef.current = true;
      setCardAnimationKey((k) => k + 1);
      setIsExiting(true);
      setIsReviewing(true);
      try {
        await masterCardMutation({ cardId: cardForReview._id });
      } catch (error) {
        console.error('Failed to master card:', error);
        setIsExiting(false);
      } finally {
        setIsReviewing(false);
      }
      return;
    }
    if (isPendingHide) {
      reviewInitiatedByThisTabRef.current = true;
      setCardAnimationKey((k) => k + 1);
      setIsExiting(true);
      setIsReviewing(true);
      try {
        await hideCardMutation({ cardId: cardForReview._id });
      } catch (error) {
        console.error('Failed to hide card:', error);
        setIsExiting(false);
      } finally {
        setIsReviewing(false);
      }
      return;
    }
    const phase = effectivePhase(reviewMode, cardForReview.schedulingPhase as SchedulingPhase);
    const defaultRatingForPhase = getDefaultRating(phase);
    const rating = ratingOverride ?? selectedRating ?? defaultRatingForPhase;
    handleReview(rating, rating === defaultRatingForPhase, accuracy);
  }, [
    cardForReview,
    isReviewing,
    isPendingMaster,
    isPendingHide,
    selectedRating,
    reviewMode,
    handleReview,
    masterCardMutation,
    hideCardMutation,
  ]);

  // ============================================================================
  // Return discriminated states
  // ============================================================================

  // Cross-cutting fields shared by every state — including the progress
  // display (so a milestone hit on the last card survives the transition to
  // `noCardsDue`) and `schedulingMode` (used by the celebration UI).
  const base = {
    settingsOpen,
    setSettingsOpen,
    sessionId: sessionIdRef.current,
    dailyReviewsToday,
    dailyTimeMsToday,
    dailyNewWordsToday,
    practicedWordsThisSession,
    progressDisplayActive,
    progressDisplayReady,
    dismissProgressDisplay,
    schedulingMode: (courseSettings?.schedulingMode ?? 'learnAndReview') as SchedulingMode,
  };

  // Loading
  if (
    cardForReview === undefined ||
    courseSettings === undefined ||
    activeCourse === undefined
  ) {
    return { ...base, status: 'loading' };
  }

  const baseLanguages = resolveLanguageOrder(
    courseSettings?.baseLanguageOrder,
    activeCourse?.baseLanguages ?? [],
  );
  const targetLanguages = resolveLanguageOrder(
    courseSettings?.targetLanguageOrder,
    activeCourse?.targetLanguages ?? [],
  );

  // No collection selected
  if (!courseSettings?.activeCollectionId) {
    return {
      ...base,
      status: 'noCollection',
      courseSettings,
      baseLanguages,
      targetLanguages,
    };
  }

  // No cards due — or a transient gap between cards while auto-add runs.
  let displayCard: NonNullable<typeof cardForReview> | undefined =
    cardForReview ?? undefined;
  if (cardForReview === null) {
    const activeEntry = collectionProgress?.find(
      (c) => c.collectionId === courseSettings.activeCollectionId,
    );
    const remainingInCollection = activeEntry
      ? Math.max(0, activeEntry.totalTexts - activeEntry.cardsAdded)
      : null;

    // When auto-add is enabled and will actually add cards, suppress the
    // noCardsDue screen so the transition to the next batch is seamless.
    const autoAddWillRun =
      !!courseSettings.autoAddCards &&
      !settingsOpen &&
      (sentencesQuota.unlimited || sentencesQuota.balance > 0) &&
      (remainingInCollection === null || remainingInCollection > 0);

    if (autoAddWillRun && lastReviewingCardRef.current) {
      // Keep the previously shown card on screen until the next card arrives,
      // to avoid a brief flash of the loading UI between cards.
      displayCard = lastReviewingCardRef.current;
    } else if (autoAddWillRun) {
      return { ...base, status: 'loading' };
    } else {
      return {
        ...base,
        status: 'noCardsDue',
        courseSettings,
        baseLanguages,
        targetLanguages,
        handleAddCards,
        isAddingCards,
        batchSize: courseSettings.cardsToAddBatchSize ?? DEFAULT_BATCH_SIZE,
        sentencesRemaining: sentencesQuota.unlimited ? null : sentencesQuota.balance,
        remainingInCollection,
        handleSchedulingModeChange,
      };
    }
  }

  if (!displayCard) {
    return { ...base, status: 'loading' };
  }

  // Reviewing — in full review mode, always use FSRS ratings (skip pre-review)
  const phase = effectivePhase(reviewMode, displayCard.schedulingPhase as SchedulingPhase);
  const validRatings = getValidRatings(phase);
  const defaultRating = getDefaultRating(phase);
  const activeRating = selectedRating ?? defaultRating;

  // Compute projected next-due interval for each rating
  const cardState: CardSchedulingState = {
    schedulingPhase: phase,
    preReviewCount: displayCard.preReviewCount,
    dueDate: displayCard.dueDate,
    fsrsState: displayCard.fsrsState ?? null,
  };
  const now = Date.now();
  const ratingIntervals: Record<string, string> = {};
  for (const rating of validRatings) {
    try {
      const result = scheduleCard(
        cardState,
        rating,
        displayCard.initialReviewCount,
        now,
      );
      const diff = result.dueDate - now;
      ratingIntervals[rating] =
        diff <= 0 ? t('nextReviewNow') : formatInterval(diff);
    } catch {
      ratingIntervals[rating] = '—';
    }
  }

  // Sort translations according to the persisted language order so the
  // flashcard displays languages in the same order as the settings timeline.
  const sortedTranslations = [...displayCard.translations].sort((a, b) => {
    const groupA = a.isBaseLanguage ? 0 : 1;
    const groupB = b.isBaseLanguage ? 0 : 1;
    if (groupA !== groupB) return groupA - groupB;

    const orderArr = a.isBaseLanguage ? baseLanguages : targetLanguages;
    const idxA = orderArr.indexOf(a.language);
    const idxB = orderArr.indexOf(b.language);
    const safeIdxA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
    const safeIdxB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
    if (safeIdxA !== safeIdxB) return safeIdxA - safeIdxB;
    return a.language.localeCompare(b.language);
  });

  return {
    ...base,
    status: 'reviewing',
    courseSettings,
    baseLanguages,
    targetLanguages,
    cardId: displayCard._id,
    phase,
    preReviewCount: displayCard.preReviewCount,
    fsrsState: displayCard.fsrsState,
    sourceText: displayCard.sourceText,
    sourceLanguage: displayCard.sourceLanguage,
    translations: sortedTranslations,
    audioRecordings: displayCard.audioRecordings,
    nextCard: displayCard.nextCard
      ? {
        cardId: displayCard.nextCard._id,
        audioRecordings: displayCard.nextCard.audioRecordings,
      }
      : null,
    audioSpeedOverrides: displayCard.audioSpeedOverrides,
    isFavorite: displayCard.isFavorite ?? false,
    isPendingMaster,
    isPendingHide,
    validRatings,
    activeRating,
    ratingIntervals,
    handleMaster,
    handleHide,
    handleFavorite,
    handleDelete,
    handleNext,
    setSelectedRating,
    isReviewing,
    isExiting,
    animationKey: cardAnimationKey,
    getReviewInitiatedByThisTab,
    resetReviewFlag,
    handleSchedulingModeChange,
  };
}
