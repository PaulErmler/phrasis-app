"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { usePreloadedQuery, useMutation, Preloaded } from "convex/react";
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
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET,
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
} from "@/lib/constants/audioPlayback";
import { resolveLanguageOrder } from "@/lib/utils/languageOrder";

// ============================================================================
// Helpers
// ============================================================================

/** Wait for a given number of milliseconds. Rejects if the AbortSignal fires. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Preload a single audio URL and resolve with the ready HTMLAudioElement. */
function preloadAudio(url: string): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.addEventListener("canplaythrough", () => resolve(audio), {
      once: true,
    });
    audio.addEventListener(
      "error",
      () => reject(new Error(`Failed to load audio: ${url}`)),
      { once: true },
    );
    audio.load();
  });
}

/** Play an HTMLAudioElement from the start and resolve when it ends. */
function playAudio(
  audio: HTMLAudioElement,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const onAbort = () => {
      audio.pause();
      audio.currentTime = 0;
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    audio.onended = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    audio.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Audio playback error"));
    };
    audio.currentTime = 0;
    audio.play().catch((err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

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
  baseLanguages: string[];
  targetLanguages: string[];
}

interface NoCardsDueState extends BaseState {
  status: "noCardsDue";
  courseSettings: CourseSettings;
  baseLanguages: string[];
  targetLanguages: string[];
  handleAddCards: () => void;
  isAddingCards: boolean;
  batchSize: number;
}

interface ReviewingState extends BaseState {
  status: "reviewing";
  courseSettings: CourseSettings;
  baseLanguages: string[];
  targetLanguages: string[];
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
  handleStopAutoPlay: () => void;
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

export interface PreloadedLearningData {
  card: Preloaded<typeof api.features.scheduling.getCardForReview>;
  courseSettings: Preloaded<typeof api.features.courses.getActiveCourseSettings>;
  activeCourse: Preloaded<typeof api.features.courses.getActiveCourse>;
}

// ============================================================================
// Hook
// ============================================================================

export function useLearningMode(preloaded: PreloadedLearningData): LearningState {
  const t = useTranslations("LearningMode");

  const cardForReview = usePreloadedQuery(preloaded.card);
  const courseSettings = usePreloadedQuery(preloaded.courseSettings);
  const activeCourse = usePreloadedQuery(preloaded.activeCourse);

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

  // AbortController for cancelling in-progress playback
  const playbackAbortRef = useRef<AbortController | null>(null);

  // Track the card id we last triggered auto-play for (to avoid re-triggering)
  const autoPlayedCardRef = useRef<string | null>(null);

  // --------------------------------------------------------------------------
  // Resolve audio-playback settings with defaults
  // --------------------------------------------------------------------------
  const resolveSettings = useCallback(() => {
    const autoPlay = courseSettings?.autoPlayAudio ?? DEFAULT_AUTO_PLAY;
    const autoAdvance = courseSettings?.autoAdvance ?? DEFAULT_AUTO_ADVANCE;
    const reps = courseSettings?.languageRepetitions ?? {};
    const repPauses = courseSettings?.languageRepetitionPauses ?? {};
    const pauseB2B = courseSettings?.pauseBaseToBase ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
    const pauseB2T = courseSettings?.pauseBaseToTarget ?? DEFAULT_PAUSE_BASE_TO_TARGET;
    const pauseT2T = courseSettings?.pauseTargetToTarget ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
    const pauseBeforeAdvance = courseSettings?.pauseBeforeAutoAdvance ?? DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE;

    const orderedBase = resolveLanguageOrder(
      courseSettings?.baseLanguageOrder,
      activeCourse?.baseLanguages ?? [],
    );
    const orderedTarget = resolveLanguageOrder(
      courseSettings?.targetLanguageOrder,
      activeCourse?.targetLanguages ?? [],
    );

    return { autoPlay, autoAdvance, reps, repPauses, pauseB2B, pauseB2T, pauseT2T, pauseBeforeAdvance, orderedBase, orderedTarget };
  }, [courseSettings, activeCourse]);

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
      ensureContentMutation({ textId: cardForReview.textId as Id<"texts"> }).catch((err) => {
        console.error("Failed to ensure card content:", err);
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

  // --------------------------------------------------------------------------
  // Review / master / hide
  // --------------------------------------------------------------------------
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
    [cardForReview, isReviewing, reviewCardMutation],
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

  // --------------------------------------------------------------------------
  // Next
  // --------------------------------------------------------------------------
  const handleNext = useCallback(() => {
    if (!cardForReview) return;
    const phase = cardForReview.schedulingPhase as SchedulingPhase;
    const rating = selectedRating ?? getDefaultRating(phase);
    handleReview(rating);
  }, [cardForReview, selectedRating, handleReview]);

  // --------------------------------------------------------------------------
  // Stop auto-play — abort in-progress playback
  // --------------------------------------------------------------------------
  const handleStopAutoPlay = useCallback(() => {
    playbackAbortRef.current?.abort();
    playbackAbortRef.current = null;
    setIsAutoPlaying(false);
  }, []);

  // Stop any ongoing playback while the settings sheet is open.
  useEffect(() => {
    if (settingsOpen) {
      handleStopAutoPlay();
    }
  }, [settingsOpen, handleStopAutoPlay]);

  // Cancel playback when card changes or component unmounts
  useEffect(() => {
    return () => {
      playbackAbortRef.current?.abort();
    };
  }, [cardForReview?._id]);

  // --------------------------------------------------------------------------
  // Auto-play: build sequence from settings, preload, play with pauses
  // --------------------------------------------------------------------------
  const handleAutoPlay = useCallback(async () => {
    if (!cardForReview || !activeCourse || isAutoPlaying || settingsOpen) return;

    // Abort any previous playback
    playbackAbortRef.current?.abort();
    const controller = new AbortController();
    playbackAbortRef.current = controller;
    const { signal } = controller;

    setIsAutoPlaying(true);

    const { autoAdvance, reps, repPauses, pauseB2B, pauseB2T, pauseT2T, pauseBeforeAdvance, orderedBase, orderedTarget } = resolveSettings();

    /** Get the per-language repetition pause, falling back to the global default. */
    const getRepPause = (lang: string) =>
      repPauses[lang] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;

    // Build ordered list of (language, url, isBase) entries
    type AudioEntry = { language: string; url: string; isBase: boolean };
    const baseEntries: AudioEntry[] = [];
    const targetEntries: AudioEntry[] = [];

    for (const lang of orderedBase) {
      const repetitions = reps[lang] ?? DEFAULT_REPETITIONS_BASE;
      if (repetitions <= 0) continue; // skip languages with 0 plays
      const rec = cardForReview.audioRecordings.find((a) => a.language === lang);
      if (rec?.url) baseEntries.push({ language: lang, url: rec.url, isBase: true });
    }
    for (const lang of orderedTarget) {
      const repetitions = reps[lang] ?? DEFAULT_REPETITIONS_TARGET;
      if (repetitions <= 0) continue; // skip languages with 0 plays
      const rec = cardForReview.audioRecordings.find((a) => a.language === lang);
      if (rec?.url) targetEntries.push({ language: lang, url: rec.url, isBase: false });
    }

    const allEntries = [...baseEntries, ...targetEntries];
    if (allEntries.length === 0) {
      playbackAbortRef.current = null;
      setIsAutoPlaying(false);
      return;
    }

    try {
      // Preload all audio
      const preloaded = new Map<string, HTMLAudioElement>();
      await Promise.all(
        allEntries.map(async (entry) => {
          if (!preloaded.has(entry.url)) {
            try {
              const audio = await preloadAudio(entry.url);
              preloaded.set(entry.url, audio);
            } catch {
              // skip entries that fail to preload
            }
          }
        }),
      );

      if (signal.aborted) return;

      // Play base languages
      for (let bi = 0; bi < baseEntries.length; bi++) {
        const entry = baseEntries[bi];
        const audio = preloaded.get(entry.url);
        if (!audio) continue;

        const repetitions = reps[entry.language] ?? DEFAULT_REPETITIONS_BASE;
        const repPause = getRepPause(entry.language);
        for (let r = 0; r < repetitions; r++) {
          await playAudio(audio, signal);
          // Pause between repetitions (not after the last repetition)
          if (r < repetitions - 1) {
            await wait(repPause * 1000, signal);
          }
        }

        // Pause between base languages (not after the last base language)
        if (bi < baseEntries.length - 1) {
          await wait(pauseB2B * 1000, signal);
        }
      }

      // Pause between base and target sections
      if (baseEntries.length > 0 && targetEntries.length > 0) {
        await wait(pauseB2T * 1000, signal);
      }

      // Play target languages
      for (let ti = 0; ti < targetEntries.length; ti++) {
        const entry = targetEntries[ti];
        const audio = preloaded.get(entry.url);
        if (!audio) continue;

        const repetitions = reps[entry.language] ?? DEFAULT_REPETITIONS_TARGET;
        const repPause = getRepPause(entry.language);
        for (let r = 0; r < repetitions; r++) {
          await playAudio(audio, signal);
          // Pause between repetitions (not after the last repetition)
          if (r < repetitions - 1) {
            await wait(repPause * 1000, signal);
          }
        }

        // Pause between target languages (not after the last target language)
        if (ti < targetEntries.length - 1) {
          await wait(pauseT2T * 1000, signal);
        }
      }

      // Auto-advance to next card if enabled (with pause before advancing)
      if (autoAdvance && !signal.aborted) {
        await wait(pauseBeforeAdvance * 1000, signal);
        if (!signal.aborted) {
          handleNext();
        }
      }
    } catch (err) {
      // AbortError is expected when playback is cancelled
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("Auto-play error:", err);
      }
    } finally {
      if (playbackAbortRef.current === controller) {
        playbackAbortRef.current = null;
      }
      setIsAutoPlaying(false);
    }
  }, [cardForReview, activeCourse, isAutoPlaying, settingsOpen, resolveSettings, handleNext]);

  // --------------------------------------------------------------------------
  // Auto-play on card change (when autoPlay setting is enabled)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!cardForReview || !activeCourse || !courseSettings || settingsOpen) return;

    const cardId = cardForReview._id;
    const autoPlay = courseSettings.autoPlayAudio ?? DEFAULT_AUTO_PLAY;
    const allAudioReady = cardForReview.audioRecordings.every((a) => a.url);

    // Only auto-trigger once per card, and only when all audio URLs are available
    if (autoPlay && allAudioReady && autoPlayedCardRef.current !== cardId) {
      autoPlayedCardRef.current = cardId;
      // Small delay to let the card render before starting audio
      const timer = setTimeout(() => {
        handleAutoPlay();
      }, 300);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardForReview?._id, cardForReview?.audioRecordings, courseSettings?.autoPlayAudio, settingsOpen]);

  // ============================================================================
  // Return discriminated states
  // ============================================================================

  const base = { settingsOpen, setSettingsOpen };

  // Loading
  if (cardForReview === undefined || courseSettings === undefined || activeCourse === undefined) {
    return { ...base, status: "loading" };
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
    return { ...base, status: "noCollection", courseSettings, baseLanguages, targetLanguages };
  }

  // No cards due
  if (cardForReview === null) {
    return {
      ...base,
      status: "noCardsDue",
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
      const result = scheduleCard(cardState, rating, cardForReview.initialReviewCount, now);
      const diff = result.dueDate - now;
      ratingIntervals[rating] = diff <= 0 ? t("nextReviewNow") : formatInterval(diff);
    } catch {
      ratingIntervals[rating] = "—";
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
    status: "reviewing",
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
    handleAutoPlay,
    handleStopAutoPlay,
    handleNext,
    setSelectedRating,
    isAutoPlaying,
    isReviewing,
  };
}
