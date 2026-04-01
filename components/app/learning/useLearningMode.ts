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
import { getUserTimezone } from '@/lib/timezone';
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { ENSURE_CONTENT_REVIEW_INTERVAL } from '@/lib/constants/learning';

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
  handleNext: (ratingOverride?: ReviewRating) => void;
  setSelectedRating: (rating: ReviewRating) => void;
  // Status flags
  isReviewing: boolean;
  isExiting: boolean;
  animationKey: number;
  // Cross-tab audio coordination
  getReviewInitiatedByThisTab: () => boolean;
  resetReviewFlag: () => void;
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

  const lastCardRef = useRef<
    Exclude<typeof cardForReviewQuery, undefined> | undefined
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
  const sentencesQuota = useFeatureQuota(FEATURE_IDS.SENTENCES);

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

  // --------------------------------------------------------------------------
  // Review / master / hide
  // --------------------------------------------------------------------------
  const reviewMode = courseSettings?.reviewMode ?? 'audio';

  const handleReview = useCallback(
    async (rating: ReviewRating, wasDefaultRating: boolean) => {
      if (!cardForReview || isReviewing) return;
      reviewInitiatedByThisTabRef.current = true;
      setCardAnimationKey((k) => k + 1);
      setIsExiting(true);
      setIsReviewing(true);
      try {
        await reviewCardMutation({
          cardId: cardForReview._id,
          rating,
          timeSpentMs: Math.max(0, Date.now() - cardShownAtRef.current),
          timezone: getUserTimezone(),
          ...(reviewMode === 'full' && { forceReviewPhase: true }),
          reviewMode,
          wasDefaultRating,
        });
        setSelectedRating(null);
      } catch (error) {
        console.error('Failed to review card:', error);
        setIsExiting(false);
      } finally {
        setIsReviewing(false);
      }
    },
    [cardForReview, isReviewing, reviewCardMutation, reviewMode],
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

  // --------------------------------------------------------------------------
  // Next
  // --------------------------------------------------------------------------
  const handleNext = useCallback(async (ratingOverride?: ReviewRating) => {
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
    handleReview(rating, rating === defaultRatingForPhase);
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

  const base = { settingsOpen, setSettingsOpen };

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

  // No cards due
  if (cardForReview === null) {
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
    };
  }

  // Reviewing — in full review mode, always use FSRS ratings (skip pre-review)
  const phase = effectivePhase(reviewMode, cardForReview.schedulingPhase as SchedulingPhase);
  const validRatings = getValidRatings(phase);
  const defaultRating = getDefaultRating(phase);
  const activeRating = selectedRating ?? defaultRating;

  // Compute projected next-due interval for each rating
  const cardState: CardSchedulingState = {
    schedulingPhase: phase,
    preReviewCount: cardForReview.preReviewCount,
    dueDate: cardForReview.dueDate,
    fsrsState: cardForReview.fsrsState ?? null,
  };
  const now = Date.now();
  const ratingIntervals: Record<string, string> = {};
  for (const rating of validRatings) {
    try {
      const result = scheduleCard(
        cardState,
        rating,
        cardForReview.initialReviewCount,
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
  const sortedTranslations = [...cardForReview.translations].sort((a, b) => {
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
    cardId: cardForReview._id,
    phase,
    preReviewCount: cardForReview.preReviewCount,
    fsrsState: cardForReview.fsrsState,
    sourceText: cardForReview.sourceText,
    sourceLanguage: cardForReview.sourceLanguage,
    translations: sortedTranslations,
    audioRecordings: cardForReview.audioRecordings,
    isFavorite: cardForReview.isFavorite ?? false,
    isPendingMaster,
    isPendingHide,
    validRatings,
    activeRating,
    ratingIntervals,
    handleMaster,
    handleHide,
    handleFavorite,
    handleNext,
    setSelectedRating,
    isReviewing,
    isExiting,
    animationKey: cardAnimationKey,
    getReviewInitiatedByThisTab,
    resetReviewFlag,
  };
}
