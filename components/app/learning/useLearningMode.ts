'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import {
  useQuery,
  useMutation,
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
import { DEFAULT_AUTO_ADVANCE } from '@/lib/constants/audioPlayback';
import { useCelebration } from './useCelebration';

/**
 * Pure helper: cryptographically-random session ID with a non-crypto
 * fallback for environments without `crypto.randomUUID`. Module-scope so
 * tests can mock or reuse it without instantiating the hook.
 */
function mintSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}


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
  /** Cards rated since this learning session started — drives the per-session
   *  progress bar so it always starts fresh at 0 on a new session. */
  sessionCardCount: number;
  progressDisplayActive: boolean;
  /** True once the milestone-triggering mutation has resolved; gates the
   * celebration audio + counter animations so they fire against fresh data. */
  progressDisplayReady: boolean;
  dismissProgressDisplay: () => void;
  /** Default `'learnAndReview'` when no active course is loaded yet. */
  schedulingMode: SchedulingMode;
  /** Default `'audio'` when no active course is loaded yet. Used by the
   * celebration UI to gate auto-advance + the auto-advance bar. */
  reviewMode: 'audio' | 'full';
  /** Mirrors `courseSettings.autoAdvance` (default true). The celebration
   * uses it together with `reviewMode === 'audio'` to decide whether to
   * auto-dismiss after a delay and show the auto-advance bar. */
  autoAdvance: boolean;
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
  /** True radio-mode play count for this card (0 when never played in radio).
   *  Feeds the "Only new" Practice-Listening limit, which in radio counts
   *  max(active reviews, radio plays). */
  radioPlayCount: number;
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
  /**
   * Client-only session signal: did the viewer click the flag action on
   * this card during the current session? Drives the "Flagged" pill in
   * the card header — purely local state, never persisted, never leaked
   * to other users viewing the same row.
   */
  flaggedInSession: boolean;
  /**
   * True while a card audio regeneration is still in flight. LearnView uses
   * it to gate auto-advance so the user isn't bounced to the next card
   * before the regenerated audio lands. Flag actions don't contribute —
   * they hide the card immediately, so "staying on the card" doesn't apply.
   */
  hasInflightCardAction: boolean;
  // Pinned card-action surface
  pinnedCardActions: readonly string[];
  // Per-action quota state for CardActionsMenu (Edit / Regenerate audio /
  // Flag). Each entry is `{ balance, unlimited }`. The menu treats
  // `balance === 0 && !unlimited` as depleted (disabled + lock badge) and
  // surfaces a "N left" badge when `balance` is low.
  cardActionQuotas: {
    edit: { balance: number; unlimited: boolean };
    regenerateAudio: { balance: number; unlimited: boolean };
    flag: { balance: number; unlimited: boolean };
  };
  // Handlers
  handleMaster: () => void;
  handleHide: () => void;
  handleFavorite: () => void;
  handleDelete: () => Promise<void>;
  /**
   * Flag the card. Fires the `flagTranslation` mutation, which increments
   * `flagCount` and enqueues a background retranslation for EVERY
   * non-source-language translation on the card at once (base + target).
   * The card itself isn't deleted, animated out, or advanced — the user
   * stays put and can press next when ready.
   */
  handleFlag: () => Promise<void>;
  handleRegenerateAudio: () => Promise<void>;
  handleUpdatePinnedActions: (actions: readonly string[]) => Promise<void>;
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

// ============================================================================
// Hook
// ============================================================================

// TODO: This hook is ~900 lines and three concerns are tangled inside it:
//   1. Card-scheduling state machine (loading / noCardsDue / addingCards /
//      reviewing + the FSRS mutations).
//   2. Session counters (dailyReviewsToday, sessionCardCount, sessionId
//      lifecycle) — partially extracted via `mintSessionId` at module
//      scope; the rest remains coupled to `handleNext` / `handleReview`.
//   3. Celebration / progress-display — extracted to `useCelebration` in
//      this PR; still triggered from inside `handleReview`.
// A full split into `useSessionCounters` / `useCardScheduling` /
// `useCelebration` is its own PR with proper QA: the milestone-trigger
// math, optimistic-flip ordering, and `dailyReviewsToday` hydration timing
// all need to be preserved bit-for-bit. Don't attempt incrementally —
// either land the full refactor with end-to-end coverage in one go, or
// leave the current shape alone.
export interface UseLearningModeOptions {
  /** Seed the session id instead of minting fresh — used by onboarding
   *  to keep the same session across a mid-lesson reload so
   *  `getNewWordsForCelebration` returns the same hero number. */
  initialSessionId?: string;
  /** Seed the in-session card counter — used by onboarding so the
   *  X/N progress bar resumes at the right value after a reload. */
  initialSessionCardCount?: number;
  /** Override the auto-add batch size, taking precedence over the
   *  per-course `cardsToAddBatchSize`. Used by the onboarding wrapper to
   *  add fewer cards at once during the first lesson WITHOUT mutating
   *  the persisted setting — the user resumes the regular default the
   *  moment they leave onboarding. */
  batchSizeOverride?: number;
}

export function useLearningMode(options: UseLearningModeOptions = {}): LearningState {
  const t = useTranslations('LearningMode');
  const { isAuthenticated } = useConvexAuth();
  const { initialSessionId, initialSessionCardCount, batchSizeOverride } = options;

  // `timezone` lets this query also return today's active review count, which
  // drives the in-learn progress bar. Reusing this subscription means the bar
  // updates live on remote changes (e.g. reviews done on another device) and
  // we don't need a parallel `getTodayReviewCount` subscription.
  const cardForReviewQuery = useQuery(
    api.features.scheduling.getCardForReview,
    isAuthenticated ? { timezone: getUserTimezone() } : 'skip',
  );
  // Direct queries (was previously fed via SSR-preloaded data through
  // AppDataProvider). The downstream logic already treats both as nullable,
  // so the loading flash on first render is handled by the hook's existing
  // `loading` status branch.
  const courseSettingsQuery = useQuery(api.features.courses.getActiveCourseSettings, {});
  const activeCourseQuery = useQuery(api.features.courses.getActiveCourse, {});

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
  const advanceRadioCardMutation = useMutation(
    api.features.scheduling.advanceRadioCard,
  );

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
  const flagTranslationMutation = useMutation(
    api.features.scheduling.flagTranslation,
  );
  const regenerateCardAudioMutation = useMutation(
    api.features.scheduling.regenerateCardAudio,
  );
  const userSettingsQuery = useQuery(
    api.features.courses.getUserSettings,
    isAuthenticated ? {} : 'skip',
  );
  const updatePinnedCardActionsMutation = useMutation(
    api.features.courses.updatePinnedCardActions,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getUserSettings,
      {},
    );
    if (current != null) {
      localStore.setQuery(
        api.features.courses.getUserSettings,
        {},
        { ...current, pinnedCardActions: [...args.actions] },
      );
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
  // Per-action quotas surfaced on the card. Drives the disabled + badge
  // state in CardActionsMenu so the user can see they're capped before
  // clicking (vs. learning about it from a USAGE_LIMIT error after the
  // fact).
  const cardEditsQuota = useFeatureQuota(FEATURE_IDS.CARD_EDITS);
  const audioRegenerationsQuota = useFeatureQuota(
    FEATURE_IDS.AUDIO_REGENERATIONS,
  );
  const translationFlagsQuota = useFeatureQuota(FEATURE_IDS.TRANSLATION_FLAGS);

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

  // Client-only session record of cards the viewer has flagged this session.
  // Drives the "Flagged" pill in the card header. Set on click, cleared on
  // full reload — explicitly NOT persisted server-side, so it doesn't leak
  // the flag to other users viewing the same row. Set is keyed by cardId
  // so the pill survives next/previous navigation within the session if
  // the user happens to return to a flagged card.
  const [flaggedCardIds, setFlaggedCardIds] = useState<Set<Id<'cards'>>>(
    () => new Set(),
  );

  // Whole-card audio regenerate state. Mirrors the flag flow but tracks all
  // course languages at once — `regenerateCardAudio` deletes audio for every
  // language and re-enqueues TTS, so completion = every initially-present
  // audio has been seen deleted then re-emitted. Languages that already had
  // no audio at regen-time only need their URL to come back.
  const [regenerateAudioStatus, setRegenerateAudioStatus] = useState<
    | {
        state: 'pending' | 'resolved';
        // Card this regenerate was triggered on. Same rationale as the
        // flag map: drop the status the moment we leave that card so
        // detection can't fire stale across cards.
        cardId: Id<'cards'>;
        startedAt: number;
        perLang: Map<
          string,
          { urlAtStart: string | null; deletedSeen: boolean; resolved: boolean }
        >;
      }
    | null
  >(null);

  // ----- Progress display (every PROGRESS_DISPLAY_INTERVAL reviews per day) -----
  // ─── Session counters + session-id lifecycle ──────────────────────────
  // Session id is the "between celebrations" bucket — `getNewWordsForCelebration`
  // filters userWords by it so each milestone shows only words discovered since
  // the previous celebration was dismissed. Source of truth lives server-side
  // on `courseSettings.currentSessionId` so the bucket survives a reload AND
  // syncs across devices. Client mints + persists via `setCurrentSessionId`:
  //   - once on first mount when the row has no id yet,
  //   - and on every celebration dismiss (rotation).
  // The mutation uses an optimistic update so the new id is visible to the
  // next reviewCard mutation without waiting for the server round-trip.
  const setCurrentSessionIdMutation = useMutation(
    api.features.courses.setCurrentSessionId,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getActiveCourseSettings,
      {},
    );
    if (current == null || current.courseId !== args.courseId) return;
    localStore.setQuery(api.features.courses.getActiveCourseSettings, {}, {
      ...current,
      currentSessionId: args.sessionId,
    });
  });

  // Locally-minted id, stable from the very first render so any review that
  // fires before the server seed lands still carries a real sessionId. Used
  // both as the read fallback below and as the seed payload in the effect.
  // Without this, the first render computed `sessionId = ''`, the empty
  // string flowed into `trackNewWords`, and `wordTracking.ts` silently
  // dropped the sessionId field — orphaning that row from its session bucket.
  const [localSessionId] = useState(() => initialSessionId ?? mintSessionId());

  // The server-backed id; falls back to `localSessionId` until the seed
  // mutation's optimistic update lands, so the fallback is never empty.
  const sessionId = courseSettingsQuery?.currentSessionId ?? localSessionId;

  // Track which course we've already seeded so a course switch (or a brand-new
  // user's first course) gets one — and only one — mint + persist call.
  const seededCourseIdRef = useRef<string | null>(null);

  // Capture mutation in a ref so the dismiss callback identity stays stable
  // (useMutation returns a stable function, but ref-readers in callbacks make
  // future refactors safer).
  const sessionContextRef = useRef<{
    courseId: Id<'courses'> | null;
    setSessionId: typeof setCurrentSessionIdMutation;
  }>({ courseId: null, setSessionId: setCurrentSessionIdMutation });
  sessionContextRef.current = {
    courseId: courseSettingsQuery?.courseId ?? null,
    setSessionId: setCurrentSessionIdMutation,
  };

  // Seed the server id when courseSettings loads with no `currentSessionId`.
  // The seed payload is `localSessionId` — the same id the first review
  // already used as its fallback — so client-side and server-side agree on
  // a single value from the very first review onward.
  useEffect(() => {
    if (!courseSettingsQuery) return;
    const { courseId, currentSessionId } = courseSettingsQuery;
    if (currentSessionId) {
      // Already seeded — record it so we don't re-seed for this course.
      seededCourseIdRef.current = courseId;
      return;
    }
    if (seededCourseIdRef.current === courseId) return;
    seededCourseIdRef.current = courseId;
    setCurrentSessionIdMutation({ courseId, sessionId: localSessionId });
  }, [
    courseSettingsQuery,
    localSessionId,
    setCurrentSessionIdMutation,
  ]);

  // Rotation handler passed to `useCelebration` — fires when the user dismisses
  // a celebration. Mints + persists a fresh id; the optimistic update means
  // the next reviewCard sees the new id before the server round-trip completes.
  const resetSessionLocalState = useCallback(() => {
    const ctx = sessionContextRef.current;
    if (!ctx.courseId) return;
    const newId = mintSessionId();
    ctx.setSessionId({ courseId: ctx.courseId, sessionId: newId });
  }, []);

  const [dailyReviewsToday, setDailyReviewsToday] = useState(0);
  const [dailyTimeMsToday, setDailyTimeMsToday] = useState(0);
  const [dailyNewWordsToday, setDailyNewWordsToday] = useState(0);
  // Per-session card counter — onboarding's 10-card lesson progress bar.
  // Reset on course change so a switched course starts a fresh "session" UI.
  const [sessionCardCount, setSessionCardCount] = useState(initialSessionCardCount ?? 0);
  const sessionCardCountCourseRef = useRef<string | null>(null);
  const activeCourseIdForSession = activeCourseQuery?._id ?? null;
  if (sessionCardCountCourseRef.current !== activeCourseIdForSession) {
    sessionCardCountCourseRef.current = activeCourseIdForSession;
    setSessionCardCount(initialSessionCardCount ?? 0);
  }

  // ─── Celebration / progress display ───────────────────────────────────
  // Sessions reset on dismissal: the next celebration shows only words
  // discovered since this point, not the cumulative total. The new id
  // takes effect from the next review's mutation onward — the celebration
  // we just dismissed already finished its queries against the old id.
  const celebration = useCelebration(resetSessionLocalState);
  const {
    active: progressDisplayActive,
    ready: progressDisplayReady,
    setActive: setProgressDisplayActive,
    setReady: setProgressDisplayReady,
    dismiss: dismissProgressDisplay,
  } = celebration;

  // Mirror today's active review count from `getCardForReview` whenever it
  // updates — covers initial hydration AND remote changes (another tab or
  // device reviewing the same course). The reviewCard mutation also writes
  // to local state in its finally block; both paths converge on the same
  // value so the bar stays correct without double-counting.
  useEffect(() => {
    if (cardForReviewQuery == null) return;
    setDailyReviewsToday(cardForReviewQuery.dailyReviewsToday);
  }, [cardForReviewQuery?.dailyReviewsToday]);

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
  const hasEnsuredForEmptyDeckRef = useRef(false);

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

  // When the deck has no due cards, the per-card effect above never fires,
  // so the next "Add cards" click would pull texts whose content prep has not
  // been scheduled. Pre-warm the active collection's upcoming texts here so
  // TTS / translation is in flight by the time the user clicks Add.
  useEffect(() => {
    if (cardForReview !== null) return;
    if (cardForReview === undefined) return; // query still loading
    if (!courseSettings?.activeCollectionId) return;
    if (hasEnsuredForEmptyDeckRef.current) return;
    if (ensureInFlightRef.current) return;

    hasEnsuredForEmptyDeckRef.current = true;
    ensureInFlightRef.current = true;
    ensureUpcomingContentMutation()
      .catch((err) => {
        console.error('Failed to ensure upcoming cards content:', err);
      })
      .finally(() => {
        ensureInFlightRef.current = false;
      });
  }, [cardForReview, courseSettings?.activeCollectionId, ensureUpcomingContentMutation]);

  // --------------------------------------------------------------------------
  // Add cards
  // --------------------------------------------------------------------------
  const handleAddCards = useCallback(async () => {
    if (!courseSettings?.activeCollectionId || isAddingCards) return;
    const configuredBatch =
      batchSizeOverride ??
      courseSettings.cardsToAddBatchSize ??
      DEFAULT_BATCH_SIZE;
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
  }, [courseSettings, isAddingCards, addCardsMutation, sentencesQuota, batchSizeOverride]);

  // Auto-add cards when enabled and no cards due
  useEffect(() => {
    // Auto-add default is `true` — only opt out when explicitly false.
    const autoAddEnabled = courseSettings?.autoAddCards !== false;
    if (
      cardForReview === null &&
      autoAddEnabled &&
      courseSettings?.activeCollectionId &&
      courseSettings?.studyContentFilter !== 'custom' &&
      !isAddingCards &&
      !settingsOpen
    ) {
      handleAddCards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cardForReview,
    courseSettings?.autoAddCards,
    courseSettings?.studyContentFilter,
    settingsOpen,
  ]);

  // Reset selectedRating, pending master/hide state, exit flag, and card timer when card changes.
  // Skip reset while cardForReview is transiently null during the auto-add gap. During that
  // window, displayCard falls back to lastReviewingCardRef (the just-reviewed card); if we
  // cleared isExiting here, AnimatePresence would re-mount a motion.div showing the previous
  // card, producing a visible "flash back" until the next card arrives. Keeping isExiting=true
  // leaves the card pane blank until cardForReview becomes a real id (the next card), at which
  // point this effect fires cleanly with fresh state.
  useEffect(() => {
    if (cardForReview?._id == null) return;
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
          sessionId,
          ...(accuracy != null && { accuracy: accuracy / 100 }),
        });
        setDailyReviewsToday(result.dailyReviewsToday);
        setDailyTimeMsToday(result.dailyTimeMsToday);
        setDailyNewWordsToday(result.dailyNewWordsToday);
        setSessionCardCount((n) => n + 1);

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
      sessionId,
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

  // Flag-only. Fires the retranslation mutation in the background and
  // otherwise leaves the card alone — no deletion, no exit animation, no
  // automatic advance. The user stays on the card and can press next when
  // they're ready; the new translation may arrive in-place as it lands.
  const handleFlag = useCallback(async () => {
    if (!cardForReview || isReviewing) return;
    const flaggedCardId = cardForReview._id;
    // Fire-and-forget. Mark the card as session-flagged ONLY when the
    // mutation reports it didn't trigger ANY retranslation — i.e. all
    // non-source languages were either over-cap or claim-contested. When
    // a retranslation IS in flight, the server-driven `retranslating`
    // pill handles the signal, and once it lands we want NO pill (don't
    // lingeringly tag a card as "Flagged" after the system fixed it).
    flagTranslationMutation({
      cardId: cardForReview._id,
    })
      .then((result) => {
        if (result && result.retranslated === false) {
          setFlaggedCardIds((prev) => {
            if (prev.has(flaggedCardId)) return prev;
            const next = new Set(prev);
            next.add(flaggedCardId);
            return next;
          });
        }
      })
      .catch((error) => {
        console.error('Failed to flag translation:', error);
      });
  }, [cardForReview, isReviewing, flagTranslationMutation]);

  const handleRegenerateAudio = useCallback(async () => {
    if (!cardForReview) return;
    // Snapshot every language's audio URL so the detection effect can
    // distinguish "already on the new audio row" from "still on the old one".
    const perLang = new Map<
      string,
      { urlAtStart: string | null; deletedSeen: boolean; resolved: boolean }
    >();
    for (const ar of cardForReview.audioRecordings) {
      perLang.set(ar.language, {
        urlAtStart: ar.url ?? null,
        deletedSeen: false,
        resolved: false,
      });
    }
    setRegenerateAudioStatus({
      state: 'pending',
      cardId: cardForReview._id,
      startedAt: Date.now(),
      perLang,
    });
    try {
      await regenerateCardAudioMutation({
        cardId: cardForReview._id,
        timezone: getUserTimezone(),
      });
    } catch (error) {
      // Roll back so the pending gate releases auto-advance immediately.
      setRegenerateAudioStatus(null);
      console.error('Failed to regenerate audio:', error);
    }
  }, [cardForReview, regenerateCardAudioMutation]);

  // Resolve regenerate-audio when every snapshotted language has been
  // observed deleted-then-restored (or, for languages that started empty,
  // simply restored to a non-null URL).
  //
  // Stale-card cleanup happens here (not in a separate effect) for the same
  // reason as the flag detector: a dedicated wipe effect would race this one
  // and the new card's audio could trip "restored" before the wipe lands.
  useEffect(() => {
    if (!cardForReview || !regenerateAudioStatus) return;
    if (regenerateAudioStatus.cardId !== cardForReview._id) {
      setRegenerateAudioStatus(null);
      return;
    }
    if (regenerateAudioStatus.state !== 'pending') return;
    let didChange = false;
    const nextPerLang = new Map(regenerateAudioStatus.perLang);
    for (const [lang, entry] of regenerateAudioStatus.perLang) {
      if (entry.resolved) continue;
      const ar = cardForReview.audioRecordings.find(
        (a) => a.language === lang,
      );
      const currentUrl = ar?.url ?? null;
      let updated = entry;
      if (!updated.deletedSeen && currentUrl == null) {
        updated = { ...updated, deletedSeen: true };
      }
      // Convex storage IDs are unique per upload, so a regenerated audio row
      // always exposes a different URL than the one we snapshotted.
      const restored =
        currentUrl != null &&
        (entry.urlAtStart == null
          ? true
          : updated.deletedSeen || currentUrl !== entry.urlAtStart);
      if (restored) {
        updated = { ...updated, resolved: true };
      }
      if (updated !== entry) {
        nextPerLang.set(lang, updated);
        didChange = true;
      }
    }
    if (!didChange) return;
    const allResolved = [...nextPerLang.values()].every((e) => e.resolved);
    // Functional setter so a stale closure can't clobber a concurrent update
    // — only patch when we're still on the same card + still pending.
    setRegenerateAudioStatus((prev) =>
      prev && prev.cardId === cardForReview._id && prev.state === 'pending'
        ? { ...prev, perLang: nextPerLang, state: allResolved ? 'resolved' : 'pending' }
        : prev,
    );
  }, [cardForReview, regenerateAudioStatus]);

  // Auto-clear the regenerate state shortly after it resolves so the
  // auto-advance gate releases and any future regenerate starts clean.
  useEffect(() => {
    if (!regenerateAudioStatus || regenerateAudioStatus.state !== 'resolved') {
      return;
    }
    const timer = setTimeout(() => {
      setRegenerateAudioStatus((prev) =>
        prev?.state === 'resolved' ? null : prev,
      );
    }, 2500);
    return () => clearTimeout(timer);
  }, [regenerateAudioStatus]);

  // Same 60s ultimate safety net as the flag flow.
  useEffect(() => {
    if (!regenerateAudioStatus || regenerateAudioStatus.state !== 'pending') {
      return;
    }
    const MAX_PENDING_MS = 60_000;
    const elapsed = Date.now() - regenerateAudioStatus.startedAt;
    const remaining = Math.max(0, MAX_PENDING_MS - elapsed);
    const timer = setTimeout(() => {
      setRegenerateAudioStatus((prev) => {
        if (!prev || prev.state !== 'pending') return prev;
        return { ...prev, state: 'resolved' };
      });
    }, remaining);
    return () => clearTimeout(timer);
  }, [regenerateAudioStatus]);

  const handleUpdatePinnedActions = useCallback(
    async (actions: readonly string[]) => {
      try {
        await updatePinnedCardActionsMutation({ actions: [...actions] });
      } catch (error) {
        console.error('Failed to update pinned card actions:', error);
      }
    },
    [updatePinnedCardActionsMutation],
  );

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
  const schedulingMode: SchedulingMode =
    courseSettings?.schedulingMode ?? 'learnAndReview';
  const isRadio = schedulingMode === 'radio';

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
    if (isRadio) {
      // Radio mode bypasses FSRS entirely: no rating, no stats, no
      // celebration. Just bump the play counter so the next-lowest counter
      // rises to the front of the queue.
      reviewInitiatedByThisTabRef.current = true;
      setCardAnimationKey((k) => k + 1);
      setIsExiting(true);
      setIsReviewing(true);
      try {
        await advanceRadioCardMutation({
          cardId: cardForReview._id,
          timezone: getUserTimezone(),
          timeSpentMs: Math.max(0, Date.now() - cardShownAtRef.current),
        });
      } catch (error) {
        console.error('Failed to advance radio card:', error);
      } finally {
        setIsReviewing(false);
        // Always clear `isExiting` in radio. The shared reset effect only
        // fires when `cardForReview._id` changes, so on a same-id re-render
        // (single-card decks) it would otherwise leave the card pane blank.
        setIsExiting(false);
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
    isRadio,
    selectedRating,
    reviewMode,
    handleReview,
    masterCardMutation,
    hideCardMutation,
    advanceRadioCardMutation,
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
    sessionId,
    dailyReviewsToday,
    dailyTimeMsToday,
    dailyNewWordsToday,
    sessionCardCount,
    progressDisplayActive,
    progressDisplayReady,
    dismissProgressDisplay,
    schedulingMode,
    reviewMode: (courseSettings?.reviewMode ?? 'audio') as 'audio' | 'full',
    autoAdvance: courseSettings?.autoAdvance ?? DEFAULT_AUTO_ADVANCE,
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
    // Auto-add defaults to true; only opt out when explicitly false.
    const autoAddEnabled = courseSettings.autoAddCards !== false;
    const autoAddWillRun =
      autoAddEnabled &&
      !settingsOpen &&
      courseSettings.studyContentFilter !== 'custom' &&
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
        batchSize:
          batchSizeOverride ??
          courseSettings.cardsToAddBatchSize ??
          DEFAULT_BATCH_SIZE,
        sentencesRemaining: sentencesQuota.unlimited ? null : sentencesQuota.balance,
        remainingInCollection,
        handleSchedulingModeChange,
      };
    }
  }

  if (!displayCard) {
    return { ...base, status: 'loading' };
  }

  // Reviewing — in full review mode, always use FSRS ratings (skip pre-review).
  // In radio mode, skip rating UI entirely (no FSRS, no rating buttons).
  const phase = effectivePhase(reviewMode, displayCard.schedulingPhase as SchedulingPhase);
  const validRatings = isRadio ? [] : getValidRatings(phase);
  const defaultRating = getDefaultRating(phase);
  const activeRating = selectedRating ?? defaultRating;

  // Compute projected next-due interval for each rating
  const ratingIntervals: Record<string, string> = {};
  if (!isRadio) {
    const cardState: CardSchedulingState = {
      schedulingPhase: phase,
      preReviewCount: displayCard.preReviewCount,
      dueDate: displayCard.dueDate,
      fsrsState: displayCard.fsrsState ?? null,
    };
    const now = Date.now();
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
    radioPlayCount: displayCard.radioPlayCount ?? 0,
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
    flaggedInSession: flaggedCardIds.has(displayCard._id),
    hasInflightCardAction: regenerateAudioStatus?.state === 'pending',
    pinnedCardActions: userSettingsQuery?.pinnedCardActions ?? [],
    cardActionQuotas: {
      edit: {
        balance: cardEditsQuota.balance,
        unlimited: cardEditsQuota.unlimited,
      },
      regenerateAudio: {
        balance: audioRegenerationsQuota.balance,
        unlimited: audioRegenerationsQuota.unlimited,
      },
      flag: {
        balance: translationFlagsQuota.balance,
        unlimited: translationFlagsQuota.unlimited,
      },
    },
    validRatings,
    activeRating,
    ratingIntervals,
    handleMaster,
    handleHide,
    handleFavorite,
    handleDelete,
    handleFlag,
    handleRegenerateAudio,
    handleUpdatePinnedActions,
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
