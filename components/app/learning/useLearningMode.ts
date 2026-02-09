"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  getValidRatings,
  getDefaultRating,
  formatInterval,
  scheduleCard,
  type ReviewRating,
  type SchedulingPhase,
  type CardSchedulingState,
} from "@/lib/scheduling";
import {
  DEFAULT_BATCH_SIZE,
  type CardTranslation,
  type CardAudioRecording,
  type CourseSettings,
} from "./types";

// ============================================================================
// Discriminated union return type
// ============================================================================

interface BaseState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

interface LoadingState extends BaseState {
  status: "loading";
}

interface NoCollectionState extends BaseState {
  status: "noCollection";
  courseSettings: CourseSettings | null;
}

interface NoCardsDueState extends BaseState {
  status: "noCardsDue";
  courseSettings: CourseSettings;
  handleAddCards: () => void;
  isAddingCards: boolean;
  batchSize: number;
}

interface ReviewingState extends BaseState {
  status: "reviewing";
  courseSettings: CourseSettings;
  // Card data
  cardId: Id<"cards">;
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
  handleAutoPlay: () => void;
  handleNext: () => void;
  setSelectedRating: (rating: ReviewRating) => void;
  // Status flags
  isAutoPlaying: boolean;
  isReviewing: boolean;
}

export type LearningState =
  | LoadingState
  | NoCollectionState
  | NoCardsDueState
  | ReviewingState;

// ============================================================================
// Hook
// ============================================================================

export function useLearningMode(): LearningState {
  const t = useTranslations("LearningMode");

  const cardForReview = useQuery(api.features.scheduling.getCardForReview);
  const courseSettings = useQuery(api.features.courses.getActiveCourseSettings);
  const activeCourse = useQuery(api.features.courses.getActiveCourse);

  const reviewCardMutation = useMutation(api.features.scheduling.reviewCard);
  const masterCardMutation = useMutation(api.features.scheduling.masterCard);
  const hideCardMutation = useMutation(api.features.scheduling.hideCard);
  const addCardsMutation = useMutation(api.features.decks.addCardsFromCollection);
  const ensureContentMutation = useMutation(api.features.decks.ensureCardContent);

  const [isReviewing, setIsReviewing] = useState(false);
  const [isAddingCards, setIsAddingCards] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [selectedRating, setSelectedRating] = useState<ReviewRating | null>(null);

  // Track cards we've already ensured content for
  const ensuredCardsRef = useRef<Set<string>>(new Set());

  // Ensure content exists for the current card
  useEffect(() => {
    if (!cardForReview) return;
    const hasMissing =
      cardForReview.translations.some((t) => !t.text) ||
      cardForReview.audioRecordings.some((a) => !a.url);

    if (hasMissing && !ensuredCardsRef.current.has(cardForReview.textId)) {
      ensuredCardsRef.current.add(cardForReview.textId);
      ensureContentMutation({ textId: cardForReview.textId as Id<"texts"> }).catch((err) => {
        console.error("Failed to ensure card content:", err);
        ensuredCardsRef.current.delete(cardForReview.textId);
      });
    }
  }, [cardForReview, ensureContentMutation]);

  const handleAddCards = useCallback(async () => {
    if (!courseSettings?.activeCollectionId || isAddingCards) return;
    setIsAddingCards(true);
    try {
      await addCardsMutation({
        collectionId: courseSettings.activeCollectionId,
        batchSize: courseSettings.cardsToAddBatchSize ?? DEFAULT_BATCH_SIZE,
      });
    } catch (error) {
      console.error("Failed to add cards:", error);
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

  const handleReview = useCallback(
    async (rating: ReviewRating) => {
      if (!cardForReview || isReviewing) return;
      setIsReviewing(true);
      try {
        await reviewCardMutation({
          cardId: cardForReview._id,
          rating,
        });
        setSelectedRating(null);
      } catch (error) {
        console.error("Failed to review card:", error);
      } finally {
        setIsReviewing(false);
      }
    },
    [cardForReview, isReviewing, reviewCardMutation]
  );

  const handleMaster = useCallback(async () => {
    if (!cardForReview) return;
    try {
      await masterCardMutation({ cardId: cardForReview._id });
    } catch (error) {
      console.error("Failed to master card:", error);
    }
  }, [cardForReview, masterCardMutation]);

  const handleHide = useCallback(async () => {
    if (!cardForReview) return;
    try {
      await hideCardMutation({ cardId: cardForReview._id });
    } catch (error) {
      console.error("Failed to hide card:", error);
    }
  }, [cardForReview, hideCardMutation]);

  // Auto-play: sequentially play all audio for the card
  const handleAutoPlay = useCallback(async () => {
    if (!cardForReview || isAutoPlaying) return;
    setIsAutoPlaying(true);

    const allAudioUrls = cardForReview.audioRecordings
      .filter((a) => a.url)
      .map((a) => a.url!);

    for (const url of allAudioUrls) {
      try {
        const audio = new Audio(url);
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject();
          audio.play().catch(reject);
        });
      } catch {
        // Skip failed audio
      }
    }

    setIsAutoPlaying(false);
  }, [cardForReview, isAutoPlaying]);

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
  if (cardForReview === undefined || courseSettings === undefined || activeCourse === undefined) {
    return { ...base, status: "loading" };
  }

  // No collection selected
  if (!courseSettings?.activeCollectionId) {
    return { ...base, status: "noCollection", courseSettings };
  }

  // No cards due
  if (cardForReview === null) {
    return {
      ...base,
      status: "noCardsDue",
      courseSettings,
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
      const result = scheduleCard(cardState, rating, cardForReview.initialReviewCount, now);
      const diff = result.dueDate - now;
      ratingIntervals[rating] = diff <= 0 ? t("nextReviewNow") : formatInterval(diff);
    } catch {
      ratingIntervals[rating] = "—";
    }
  }

  return {
    ...base,
    status: "reviewing",
    courseSettings,
    cardId: cardForReview._id,
    phase,
    preReviewCount: cardForReview.preReviewCount,
    sourceText: cardForReview.sourceText,
    translations: cardForReview.translations,
    audioRecordings: cardForReview.audioRecordings,
    validRatings,
    activeRating,
    ratingIntervals,
    handleMaster,
    handleHide,
    handleAutoPlay,
    handleNext,
    setSelectedRating,
    isAutoPlaying,
    isReviewing,
  };
}
