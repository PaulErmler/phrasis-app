'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { usePreloadedQuery, useMutation, Preloaded } from 'convex/react';
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
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';

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
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  // Rating data
  validRatings: ReviewRating[];
  activeRating: ReviewRating;
  ratingIntervals: Record<string, string>;
  // Handlers
  handleMaster: () => void;
  handleHide: () => void;
  handleNext: () => void;
  setSelectedRating: (rating: ReviewRating) => void;
  // Status flags
  isReviewing: boolean;
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
  card: Preloaded<typeof api.features.scheduling.getCardForReview>;
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

  const cardForReview = usePreloadedQuery(preloaded.card);
  const courseSettings = usePreloadedQuery(preloaded.courseSettings);
  const activeCourse = usePreloadedQuery(preloaded.activeCourse);

  const reviewCardMutation = useMutation(api.features.scheduling.reviewCard);
  const masterCardMutation = useMutation(api.features.scheduling.masterCard);
  const hideCardMutation = useMutation(api.features.scheduling.hideCard);
  const addCardsMutation = useMutation(
    api.features.decks.addCardsFromCollection,
  );
  const ensureContentMutation = useMutation(
    api.features.decks.ensureCardContent,
  );

  const [isReviewing, setIsReviewing] = useState(false);
  const [isAddingCards, setIsAddingCards] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRating, setSelectedRating] = useState<ReviewRating | null>(
    null,
  );

  // Track cards we've already ensured content for
  const ensuredCardsRef = useRef<Set<string>>(new Set());

  // Cross-tab coordination: only the tab that initiated the review should auto-play
  const reviewInitiatedByThisTabRef = useRef(true); // true initially so first card auto-plays

  const getReviewInitiatedByThisTab = useCallback(
    () => reviewInitiatedByThisTabRef.current,
    [],
  );

  const resetReviewFlag = useCallback(() => {
    reviewInitiatedByThisTabRef.current = false;
  }, []);

  // --------------------------------------------------------------------------
  // Ensure content exists for the current card
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!cardForReview) return;
    const hasMissing =
      cardForReview.translations.some((t) => !t.text) ||
      cardForReview.audioRecordings.some((a) => !a.url);

    if (hasMissing && !ensuredCardsRef.current.has(cardForReview.textId)) {
      ensuredCardsRef.current.add(cardForReview.textId);
      ensureContentMutation({
        textId: cardForReview.textId as Id<'texts'>,
      }).catch((err) => {
        console.error('Failed to ensure card content:', err);
        ensuredCardsRef.current.delete(cardForReview.textId);
      });
    }
  }, [cardForReview, ensureContentMutation]);

  // --------------------------------------------------------------------------
  // Add cards
  // --------------------------------------------------------------------------
  const handleAddCards = useCallback(async () => {
    if (!courseSettings?.activeCollectionId || isAddingCards) return;
    setIsAddingCards(true);
    try {
      await addCardsMutation({
        collectionId: courseSettings.activeCollectionId,
        batchSize: courseSettings.cardsToAddBatchSize ?? DEFAULT_BATCH_SIZE,
      });
    } catch (error) {
      console.error('Failed to add cards:', error);
    } finally {
      setIsAddingCards(false);
    }
  }, [courseSettings, isAddingCards, addCardsMutation]);

  // Auto-add cards when enabled and no cards due
  useEffect(() => {
    if (
      cardForReview === null &&
      courseSettings?.autoAddCards &&
      courseSettings?.activeCollectionId &&
      !isAddingCards
    ) {
      handleAddCards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardForReview, courseSettings?.autoAddCards]);

  // Reset selectedRating when card changes
  useEffect(() => {
    setSelectedRating(null);
  }, [cardForReview?._id]);

  // --------------------------------------------------------------------------
  // Review / master / hide
  // --------------------------------------------------------------------------
  const handleReview = useCallback(
    async (rating: ReviewRating) => {
      if (!cardForReview || isReviewing) return;
      reviewInitiatedByThisTabRef.current = true;
      setIsReviewing(true);
      try {
        await reviewCardMutation({
          cardId: cardForReview._id,
          rating,
        });
        setSelectedRating(null);
      } catch (error) {
        console.error('Failed to review card:', error);
      } finally {
        setIsReviewing(false);
      }
    },
    [cardForReview, isReviewing, reviewCardMutation],
  );

  const handleMaster = useCallback(async () => {
    if (!cardForReview) return;
    reviewInitiatedByThisTabRef.current = true;
    try {
      await masterCardMutation({ cardId: cardForReview._id });
    } catch (error) {
      console.error('Failed to master card:', error);
    }
  }, [cardForReview, masterCardMutation]);

  const handleHide = useCallback(async () => {
    if (!cardForReview) return;
    reviewInitiatedByThisTabRef.current = true;
    try {
      await hideCardMutation({ cardId: cardForReview._id });
    } catch (error) {
      console.error('Failed to hide card:', error);
    }
  }, [cardForReview, hideCardMutation]);

  // --------------------------------------------------------------------------
  // Next
  // --------------------------------------------------------------------------
  const handleNext = useCallback(() => {
    if (!cardForReview) return;
    const phase = cardForReview.schedulingPhase as SchedulingPhase;
    const rating = selectedRating ?? getDefaultRating(phase);
    handleReview(rating);
  }, [cardForReview, selectedRating, handleReview]);

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
    };
  }

  // Reviewing
  const phase = cardForReview.schedulingPhase as SchedulingPhase;
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
    sourceText: cardForReview.sourceText,
    translations: sortedTranslations,
    audioRecordings: cardForReview.audioRecordings,
    validRatings,
    activeRating,
    ratingIntervals,
    handleMaster,
    handleHide,
    handleNext,
    setSelectedRating,
    isReviewing,
    getReviewInitiatedByThisTab,
    resetReviewFlag,
  };
}
