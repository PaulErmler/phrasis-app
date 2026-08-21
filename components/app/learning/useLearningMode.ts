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
  type ReviewAccuracyPayload,
} from './types';
import type { SchedulingMode } from '@/convex/types';
import { getUserTimezone } from '@/lib/timezone';
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import {
  ENSURE_CONTENT_MAX_RETRIES,
  ENSURE_CONTENT_RETRY_MS,
  ENSURE_CONTENT_REVIEW_INTERVAL,
  PROGRESS_DISPLAY_INTERVAL,
} from '@/lib/constants/learning';
import { DEFAULT_AUTO_ADVANCE } from '@/lib/constants/audioPlayback';
import { collectionRemaining } from '@/convex/lib/collections';
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

/**
 * Sticky "last resolved query value": while authenticated, a query that
 * transiently flips back to `undefined` (refetch) keeps serving its last
 * resolved value. Sign-out fully resets the stickiness so no stale value
 * can flash back after re-auth while the queries are still loading.
 */
function useStickyQueryValue<T>(
  value: T | undefined,
  isAuthenticated: boolean,
): T | undefined {
  const lastRef = useRef<T | undefined>(undefined);
  const receivedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      receivedRef.current = false;
      lastRef.current = undefined;
      return;
    }
    if (value !== undefined) {
      receivedRef.current = true;
      lastRef.current = value;
    }
  }, [isAuthenticated, value]);

  return value !== undefined
    ? value
    : isAuthenticated && receivedRef.current
      ? lastRef.current
      : undefined;
}

// ============================================================================
// Discriminated union return type
// ============================================================================

interface BaseState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  // Progress display. Orthogonal to status. A milestone hit on the very last
  // card flips `progressDisplayActive` to true while `status` flips to
  // `noCardsDue` on the next render; LearningMode renders the celebration
  // first regardless of underlying status, so the user always gets the reward
  // before the "no cards due" screen takes over.
  sessionId: string;
  dailyReviewsToday: number;
  dailyTimeMsToday: number;
  dailyNewWordsToday: number;
  /** Cards rated since this learning session started. Drives the per-session
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
  /**
   * Push the accuracy-derived rating suggestion in from the writing card.
   * Lives on the base state (not the reviewing state) so the effect that sets
   * it doesn't have to re-run as the status union changes shape. `null` means
   * "no opinion" and falls through to the phase default.
   */
  setAutoRating: (rating: ReviewRating | null) => void;
  /**
   * True while auto-add wants to fire but is parked behind the caller's
   * `holdAutoAdd` gate (the one-time difficulty check). The host uses it to
   * open the difficulty dialog exactly when new cards are about to be added
   * Not on session start.
   */
  autoAddHeld: boolean;
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
  /** True Free Study play count for this card (0 when never played there).
   *  The writing face's analogue of radioPlayCount: free play advances neither
   *  preReviewCount nor the FSRS reps, so this is what retires the
   *  "show translation on new sentences" copy-typing assist in Free Study. */
  freeStudyPlayCount: number;
  /** FSRS good/easy ratings collected by this card (0 for pre-field cards).
   *  Feeds the "until rated good" Practice-Listening strategy. */
  goodReviewCount: number;
  /** Source-collection shorthand ("A1.2"), origin bucket, and CEFR tier
   * (pill color key) for the optional card-origin pill. Null when the
   * collection can't be resolved. */
  collectionLabel: string | null;
  collectionOrigin: 'premade' | 'custom' | 'chat' | null;
  collectionCefrTier: string | null;
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
   * the card header. Purely local state, never persisted, never leaked
   * to other users viewing the same row.
   */
  flaggedInSession: boolean;
  /**
   * True while a card audio regeneration is still in flight. LearnView uses
   * it to gate auto-advance so the user isn't bounced to the next card
   * before the regenerated audio lands. Flag actions don't contribute.
   * They hide the card immediately, so "staying on the card" doesn't apply.
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
   * The card itself isn't deleted, animated out, or advanced. The user
   * stays put and can press next when ready.
   */
  handleFlag: () => Promise<void>;
  handleRegenerateAudio: () => Promise<void>;
  handleUpdatePinnedActions: (actions: readonly string[]) => Promise<void>;
  handleNext: (
    ratingOverride?: ReviewRating,
    accuracy?: ReviewAccuracyPayload,
  ) => void;
  setSelectedRating: (rating: ReviewRating | null) => void;
  /** Undo the most recent review (server-side; works across devices). The
   * restored card arrives via the reactive card query. Resolves true when a
   * review was actually undone (false on an empty stack or error). */
  handleUndo: () => Promise<boolean>;
  /** False when the undo stack is empty (or holds only entries from another
   * study mode/filter), the undo button greys out. */
  canUndo: boolean;
  // Status flags
  isReviewing: boolean;
  isUndoing: boolean;
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

// Scope note: three concerns remain coupled inside this hook.
//   1. Card-scheduling state machine (loading / noCollection / noCardsDue /
//      reviewing, the isAddingCards flag, and the FSRS mutations).
//   2. Session counters (dailyReviewsToday, sessionCardCount, sessionId
//      lifecycle; `mintSessionId` lives at module scope): coupled to
//      `handleNext` / `handleReview`.
//   3. Celebration triggering: the display state lives in
//      `useCelebration`, but it is still driven from inside `handleReview`.
// Any future split must preserve bit-for-bit: the milestone-trigger math,
// the optimistic-flip ordering (predict before awaiting the mutation, roll
// back if the server disagrees), and the `dailyReviewsToday` hydration
// timing. Don't split incrementally. Land a full refactor with
// end-to-end coverage in one go, or leave the current shape alone.
export function useLearningMode(
  options: {
    /**
     * While true, the auto-add effect parks instead of adding cards (and
     * reports via `autoAddHeld`). Used by the one-time difficulty check:
     * the user confirms/changes their level BEFORE the first new cards are
     * pulled from a collection.
     */
    holdAutoAdd?: boolean;
  } = {},
): LearningState {
  const { holdAutoAdd = false } = options;
  const t = useTranslations('LearningMode');
  const { isAuthenticated } = useConvexAuth();

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

  const cardForReview = useStickyQueryValue(cardForReviewQuery, isAuthenticated);
  const courseSettings = useStickyQueryValue(courseSettingsQuery, isAuthenticated);
  const activeCourse = useStickyQueryValue(activeCourseQuery, isAuthenticated);

  // Card-specific stickiness on top of the sticky values above: also filters
  // out `null` (deck empty) so the auto-add gap can keep showing the
  // just-reviewed card, and resets on collection change.
  const lastReviewingCardRef = useRef<
    NonNullable<typeof cardForReviewQuery> | undefined
  >(undefined);

  useEffect(() => {
    if (!isAuthenticated) {
      lastReviewingCardRef.current = undefined;
      return;
    }
    if (cardForReviewQuery != null) {
      lastReviewingCardRef.current = cardForReviewQuery;
    }
  }, [isAuthenticated, cardForReviewQuery]);

  useEffect(() => {
    lastReviewingCardRef.current = undefined;
  }, [courseSettingsQuery?.activeCollectionId]);

  // Undo-button state rides on the getCardForReview payload. One
  // subscription that invalidates once per review, instead of a parallel
  // `getUndoableReviewCount` subscription. When the deck empties mid-session
  // the query goes null while the UI may keep showing the just-reviewed card
  // (the auto-add fallback on `lastReviewingCardRef` below); that ref's
  // payload predates the review that emptied the queue, so +1 keeps undo
  // available in that window. Only positivity matters (`canUndo`).
  const undoableReviewCount =
    cardForReview != null
      ? cardForReview.undoableCount
      : lastReviewingCardRef.current
        ? lastReviewingCardRef.current.undoableCount + 1
        : 0;

  const reviewCardMutation = useMutation(api.features.scheduling.reviewCard);
  const advanceFreePlayCardMutation = useMutation(
    api.features.scheduling.advanceFreePlayCard,
  );
  const undoLastReviewMutation = useMutation(
    api.features.scheduling.undoLastReview,
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
  // Accuracy-derived suggestion, pushed in from the writing card. It sits
  // BELOW `selectedRating` in every resolution below, so a manual tap or
  // number key always wins, and it is reset in lockstep with `selectedRating`
  // If the two ever drifted, the previous card's suggestion would show up
  // highlighted on the next card.
  const [autoRatingState, setAutoRating] = useState<ReviewRating | null>(null);
  const [isPendingMaster, setIsPendingMaster] = useState(false);
  const [isPendingHide, setIsPendingHide] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [cardAnimationKey, setCardAnimationKey] = useState(0);

  // Client-only session record of cards the viewer has flagged this session.
  // Drives the "Flagged" pill in the card header. Set on click, cleared on
  // full reload. Explicitly NOT persisted server-side, so it doesn't leak
  // the flag to other users viewing the same row. Set is keyed by cardId
  // so the pill survives next/previous navigation within the session if
  // the user happens to return to a flagged card.
  const [flaggedCardIds, setFlaggedCardIds] = useState<Set<Id<'cards'>>>(
    () => new Set(),
  );

  // Whole-card audio regenerate state. Mirrors the flag flow but tracks all
  // course languages at once. `regenerateCardAudio` deletes audio for every
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
  // Session id is the "between celebrations" bucket. `getNewWordsForCelebration`
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
  // dropped the sessionId field, orphaning that row from its session bucket.
  const [localSessionId] = useState(() => mintSessionId());

  // The server-backed id; falls back to `localSessionId` until the seed
  // mutation's optimistic update lands, so the fallback is never empty.
  const sessionId = courseSettingsQuery?.currentSessionId ?? localSessionId;

  // Track which course we've already seeded so a course switch (or a brand-new
  // user's first course) gets one, and only one. Mint + persist call.
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
  // The seed payload is `localSessionId`. The same id the first review
  // already used as its fallback, so client-side and server-side agree on
  // a single value from the very first review onward.
  useEffect(() => {
    if (!courseSettingsQuery) return;
    const { courseId, currentSessionId } = courseSettingsQuery;
    if (currentSessionId) {
      // Already seeded. Record it so we don't re-seed for this course.
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

  // Rotation handler passed to `useCelebration`. Fires when the user dismisses
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
  // Per-session card counter. Reset on course change so a switched course
  // starts a fresh "session" UI.
  const [sessionCardCount, setSessionCardCount] = useState(0);
  const sessionCardCountCourseRef = useRef<string | null>(null);
  const activeCourseIdForSession = activeCourseQuery?._id ?? null;
  if (sessionCardCountCourseRef.current !== activeCourseIdForSession) {
    sessionCardCountCourseRef.current = activeCourseIdForSession;
    setSessionCardCount(0);
  }

  // ─── Celebration / progress display ───────────────────────────────────
  // Sessions reset on dismissal: the next celebration shows only words
  // discovered since this point, not the cumulative total. The new id
  // takes effect from the next review's mutation onward. The celebration
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
  // updates. Covers initial hydration AND remote changes (another tab or
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
  const ensureRetriesRef = useRef(0);
  const hasEnsuredForEmptyDeckRef = useRef(false);

  useEffect(() => {
    if (!cardForReview) return;

    if (prevCardIdForEnsureRef.current !== cardForReview._id) {
      if (prevCardIdForEnsureRef.current !== null) {
        reviewsSinceEnsureRef.current++;
      }
      prevCardIdForEnsureRef.current = cardForReview._id;
      ensureRetriesRef.current = 0;
    }

    const missingContent = cardForReview.hasMissingContent;
    const shouldEnsure =
      missingContent ||
      reviewsSinceEnsureRef.current >= ENSURE_CONTENT_REVIEW_INTERVAL;
    if (!shouldEnsure) return;

    // While the displayed card stays missing content, keep re-firing the
    // ensure on a cooldown (bounded per card) instead of trying exactly
    // once. One attempt was not enough: the mutation can fail silently
    // (OCC, a throw mid-sweep) or no-op against a claim held by a job that
    // died, and this effect's deps don't change while the card is stuck, so
    // without the timer the user would sit on the spinner until they
    // advance. When the audio lands, `hasMissingContent` flips and the
    // cleanup below cancels the pending retry.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      if (cancelled) return;
      if (ensureInFlightRef.current) {
        // An ensure fired for the previous card is still in flight. Check
        // back after the cooldown instead of dropping this card's turn.
        // Deferrals don't count against the retry budget; only mutations
        // actually fired below do.
        if (missingContent) {
          retryTimer = setTimeout(attempt, ENSURE_CONTENT_RETRY_MS);
        }
        return;
      }
      reviewsSinceEnsureRef.current = 0;
      ensureInFlightRef.current = true;
      ensureUpcomingContentMutation()
        .catch((err) => {
          console.error('Failed to ensure upcoming cards content:', err);
        })
        .finally(() => {
          ensureInFlightRef.current = false;
          if (cancelled || !missingContent) return;
          if (ensureRetriesRef.current >= ENSURE_CONTENT_MAX_RETRIES) return;
          ensureRetriesRef.current++;
          retryTimer = setTimeout(attempt, ENSURE_CONTENT_RETRY_MS);
        });
    };
    attempt();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
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

    // Same retry-on-failure shape as the per-card ensure above: a failed
    // pre-warm should not latch `hasEnsuredForEmptyDeckRef` for the session,
    // or the next "Add cards" click pulls texts with nothing scheduled.
    let cancelled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      if (cancelled || ensureInFlightRef.current) return;
      hasEnsuredForEmptyDeckRef.current = true;
      ensureInFlightRef.current = true;
      ensureUpcomingContentMutation()
        .catch((err) => {
          console.error('Failed to ensure upcoming cards content:', err);
          if (cancelled || attempts >= ENSURE_CONTENT_MAX_RETRIES) return;
          attempts++;
          hasEnsuredForEmptyDeckRef.current = false;
          retryTimer = setTimeout(attempt, ENSURE_CONTENT_RETRY_MS);
        })
        .finally(() => {
          ensureInFlightRef.current = false;
        });
    };
    attempt();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [cardForReview, courseSettings?.activeCollectionId, ensureUpcomingContentMutation]);

  // --------------------------------------------------------------------------
  // Add cards
  // --------------------------------------------------------------------------
  // Collection a completed add run proved drained (0 cards, scan not capped,
  // not merely out of quota), or whose last run threw. Read by the auto-add
  // effect and the noCardsDue/loading status computation so neither re-fires
  // a doomed mutation in a loop nor strands the user on the loading screen.
  // Cleared by any run that adds cards; the manual Add button is not gated by
  // it, so it doubles as the recovery path after a failure.
  const autoAddExhaustedForRef = useRef<string | null>(null);
  // Quota-empty is deliberately NOT the exhausted latch: the collection still
  // has addable texts, so it must un-stick when the balance refills (below)
  // instead of staying dead until remount. It still needs to stop the effect,
  // though. A graceful `quotaLimited` result doesn't latch exhausted, and
  // without this the effect would re-fire the no-op mutation on every
  // isAddingCards flip.
  const autoAddQuotaEmptyRef = useRef(false);

  const handleAddCards = useCallback(async () => {
    if (!courseSettings?.activeCollectionId || isAddingCards) return;
    const collectionId = courseSettings.activeCollectionId;
    const configuredBatch =
      courseSettings.cardsToAddBatchSize ?? DEFAULT_BATCH_SIZE;
    const effectiveBatch = sentencesQuota.unlimited
      ? configuredBatch
      : Math.min(configuredBatch, Math.max(1, sentencesQuota.balance));
    setIsAddingCards(true);
    try {
      const args = { collectionId, batchSize: effectiveBatch };
      let result = await addCardsMutation(args);
      // A 0-card result with scanIncomplete means the scan burned its
      // per-call read budget on an ignored/direct-added streak; the frontier
      // already advanced, so re-calling continues past it. Bounded retries.
      // Mirrors the collection dialog's handleAddCards.
      let attempts = 1;
      while (result.cardsAdded === 0 && result.scanIncomplete && attempts < 5) {
        result = await addCardsMutation(args);
        attempts++;
      }
      if (result.cardsAdded > 0) {
        autoAddExhaustedForRef.current = null;
        autoAddQuotaEmptyRef.current = false;
      } else if (result.quotaLimited) {
        autoAddQuotaEmptyRef.current = true;
      } else if (!result.scanIncomplete) {
        // Proven drained (not just capped, not out of quota). Remembering it
        // here is what lets the auto-add effect safely depend on
        // isAddingCards without looping.
        autoAddExhaustedForRef.current = collectionId.toString();
      }
    } catch (error) {
      console.error('Failed to add cards:', error);
      // Latch failures too: the effect re-fires when isAddingCards flips
      // back, so a persistent rejection (e.g. QUOTA_NOT_SYNCED before the
      // quota doc exists) would otherwise retry the mutation in a tight
      // loop. The noCardsDue screen's manual Add button bypasses the latch
      // and clears it on the next successful run.
      autoAddExhaustedForRef.current = collectionId.toString();
    } finally {
      setIsAddingCards(false);
    }
  }, [courseSettings, isAddingCards, addCardsMutation, sentencesQuota]);

  // Un-stick the quota latch the moment the reactive balance shows headroom
  // again. Runs before the auto-add effect below (definition order), so the
  // same commit that delivers the refill also resumes auto-add.
  useEffect(() => {
    if (sentencesQuota.unlimited || sentencesQuota.balance > 0) {
      autoAddQuotaEmptyRef.current = false;
    }
  }, [sentencesQuota.unlimited, sentencesQuota.balance]);

  // Auto-add cards when enabled and no cards due. isAddingCards and
  // activeCollectionId are deliberate deps: a run that adds 0 cards while
  // auto-advance moves the active collection (ignore-completed level), or one
  // that merely hit the scan cap, must re-evaluate when the run finishes,
  // otherwise the user is stranded on the loading screen. The exhausted-ref
  // guard (set on drained and on error) and the quota latch (set on
  // quota-empty, cleared on refill) are what keep this from looping on a
  // drained collection, a persistently failing mutation, or an empty balance.
  const [autoAddHeld, setAutoAddHeld] = useState(false);
  useEffect(() => {
    // Auto-add default is `true`, only opt out when explicitly false.
    const autoAddEnabled = courseSettings?.autoAddCards !== false;
    const activeCollectionId = courseSettings?.activeCollectionId;
    const wantsAutoAdd =
      cardForReview === null &&
      autoAddEnabled &&
      !!activeCollectionId &&
      courseSettings?.studyContentFilter !== 'custom' &&
      !isAddingCards &&
      !settingsOpen &&
      !autoAddQuotaEmptyRef.current &&
      autoAddExhaustedForRef.current !== activeCollectionId.toString();
    // Parked behind the difficulty check: surface the intent (opens the
    // dialog) and try again when the hold releases. This effect re-runs on
    // `holdAutoAdd` changes.
    setAutoAddHeld(wantsAutoAdd && holdAutoAdd);
    if (wantsAutoAdd && !holdAutoAdd) {
      handleAddCards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cardForReview,
    courseSettings?.autoAddCards,
    courseSettings?.activeCollectionId,
    courseSettings?.studyContentFilter,
    isAddingCards,
    settingsOpen,
    holdAutoAdd,
    sentencesQuota.unlimited,
    sentencesQuota.balance,
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
    setAutoRating(null);
    setIsPendingMaster(false);
    setIsPendingHide(false);
    setIsExiting(false);
    cardShownAtRef.current = Date.now();
  }, [cardForReview?._id]);

  // Recovery: when a forward review resolves and the SAME card document comes
  // back (e.g. "again" on a one-card deck), the id-keyed reset effect above
  // never fires and isExiting would stay true forever, leaving the card pane
  // blank. Clear it whenever a real card is present and no mutation is in
  // flight. The auto-add gap (cardForReview === null) intentionally stays
  // blank. See the comment above.
  useEffect(() => {
    if (isExiting && !isReviewing && !isUndoing && cardForReview?._id != null) {
      setIsExiting(false);
    }
  }, [isExiting, isReviewing, isUndoing, cardForReview?._id]);

  // --------------------------------------------------------------------------
  // Review / master / hide
  // --------------------------------------------------------------------------
  const reviewMode = courseSettings?.reviewMode ?? 'audio';

  // Opt-out: undefined (pre-migration rows or unset) defaults to enabled.
  const progressDisplayEnabled = courseSettings?.progressDisplayEnabled ?? true;

  // Synchronous in-flight latch. The handlers' `isReviewing` checks read React
  // state, which a second call in the same tick still sees as `false` (the
  // setter hasn't re-rendered yet), so a double-click would fire the mutation
  // twice. A ref flips immediately and closes that window.
  const exitMutationInFlightRef = useRef(false);

  // Shared shape for mutations that animate the card out (master / hide /
  // delete / radio advance): mark this tab as review initiator, bump the
  // animation key, flip `isExiting` before the await, and clear `isReviewing`
  // in finally. On rejection `isExiting` is restored so the card comes back,
  // unless `alwaysClearExiting` is set, in which case the finally clears it
  // unconditionally instead. (`handleReview` keeps its own copy of the
  // prelude: its milestone prediction / rollback logic doesn't fit here.)
  const runExitingMutation = useCallback(
    async (
      run: () => Promise<unknown>,
      errorMessage: string,
      options?: { alwaysClearExiting?: boolean },
    ) => {
      if (exitMutationInFlightRef.current) return;
      exitMutationInFlightRef.current = true;
      reviewInitiatedByThisTabRef.current = true;
      setCardAnimationKey((k) => k + 1);
      setIsExiting(true);
      setIsReviewing(true);
      try {
        await run();
      } catch (error) {
        console.error(errorMessage, error);
        if (!options?.alwaysClearExiting) {
          setIsExiting(false);
        }
      } finally {
        exitMutationInFlightRef.current = false;
        setIsReviewing(false);
        if (options?.alwaysClearExiting) {
          setIsExiting(false);
        }
      }
    },
    [],
  );

  const handleReview = useCallback(
    async (
      rating: ReviewRating,
      wasDefaultRating: boolean,
      accuracy?: ReviewAccuracyPayload,
    ) => {
      if (!cardForReview || isReviewing) return;
      // Same synchronous latch as `runExitingMutation`, without it a
      // same-tick double submit would record the review twice.
      if (exitMutationInFlightRef.current) return;
      exitMutationInFlightRef.current = true;
      reviewInitiatedByThisTabRef.current = true;
      setCardAnimationKey((k) => k + 1);
      setIsExiting(true);
      setIsReviewing(true);

      // Predict the milestone *before* awaiting the mutation so we can flip
      // `progressDisplayActive=true` synchronously, by the time the next
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
          ...(accuracy != null && {
            accuracy: accuracy.primary / 100,
            accuracyStrict: accuracy.strict / 100,
            accuracyLenient: accuracy.lenient / 100,
          }),
        });
        setDailyReviewsToday(result.dailyReviewsToday);
        setDailyTimeMsToday(result.dailyTimeMsToday);
        setDailyNewWordsToday(result.dailyNewWordsToday);
        setSessionCardCount((n) => n + 1);

        if (result.triggerCelebration) {
          setProgressDisplayActive(true);
          // Mutation has resolved. Daily totals are fresh and userWords for
          // this review are committed, so the celebration's queries will
          // return post-mutation data on their next refetch. Now safe to
          // mount CelebrationContent and start audio + animations.
          setProgressDisplayReady(true);
        } else {
          // Server says no celebration. Roll back the optimistic flip.
          setProgressDisplayActive(false);
          setProgressDisplayReady(false);
        }
        setSelectedRating(null);
        setAutoRating(null);
      } catch (error) {
        console.error('Failed to review card:', error);
        if (predictedMilestone) {
          setProgressDisplayActive(false);
          setProgressDisplayReady(false);
        }
        setIsExiting(false);
      } finally {
        exitMutationInFlightRef.current = false;
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

  // Undo the last review: the mutation restores the card's pre-review state
  // server-side and the restored card arrives via the reactive
  // `getCardForReview` subscription, same flow as advancing, just backwards.
  const handleUndo = useCallback(async (): Promise<boolean> => {
    if (isReviewing || isUndoing) return false;
    setIsUndoing(true);
    reviewInitiatedByThisTabRef.current = true;
    try {
      const result = await undoLastReviewMutation({
        timezone: getUserTimezone(),
      });
      if (result.status === 'undone') {
        setDailyReviewsToday(result.dailyReviewsToday);
        setDailyTimeMsToday(result.dailyTimeMsToday);
        setDailyNewWordsToday(result.dailyNewWordsToday);
        setSessionCardCount((n) => Math.max(0, n - 1));
        // The card-change effect keyed on `cardForReview?._id` won't fire when
        // the restored card is the same document as the one on screen (e.g.
        // after an "again" rating on a small deck), so reset the per-card
        // state here explicitly.
        setSelectedRating(null);
        setAutoRating(null);
        setIsExiting(false);
        cardShownAtRef.current = Date.now();
        setCardAnimationKey((k) => k + 1);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to undo review:', error);
      return false;
    } finally {
      setIsUndoing(false);
    }
  }, [isReviewing, isUndoing, undoLastReviewMutation]);

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
  // otherwise leaves the card alone, no deletion, no exit animation, no
  // automatic advance. The user stays on the card and can press next when
  // they're ready; the new translation may arrive in-place as it lands.
  const handleFlag = useCallback(async () => {
    if (!cardForReview || isReviewing) return;
    const flaggedCardId = cardForReview._id;
    // Fire-and-forget. Mark the card as session-flagged ONLY when the
    // mutation reports it didn't trigger ANY retranslation, i.e. all
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
    // Only patch when we're still on the same card + still pending.
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
    await runExitingMutation(
      () => deleteCardMutation({ cardId: cardForReview._id }),
      'Failed to delete card:',
    );
  }, [cardForReview, isReviewing, deleteCardMutation, runExitingMutation]);

  // --------------------------------------------------------------------------
  // Scheduling mode
  // --------------------------------------------------------------------------
  const settingsCourseId = courseSettings?.courseId;
  const handleSchedulingModeChange = useCallback(
    (mode: SchedulingMode) => {
      if (!settingsCourseId) return;
      void updateCourseSettingsMutation({
        courseId: settingsCourseId,
        schedulingMode: mode,
      }).catch((error) => {
        console.error('Failed to update scheduling mode:', error);
      });
    },
    [settingsCourseId, updateCourseSettingsMutation],
  );

  // --------------------------------------------------------------------------
  // Next
  // --------------------------------------------------------------------------
  const schedulingMode: SchedulingMode =
    courseSettings?.schedulingMode ?? 'learnAndReview';
  // Free play bypasses FSRS in both its faces: no rating, no scheduling write,
  // no celebration. Which rotation it advances, and whether it runs hands-free,
  // follow from `reviewMode` (see `freePlayFace` in convex/types.ts and
  // `isHandsFree` in useLearningAudio), the server resolves the face itself.
  const isFreePlay = schedulingMode === 'radio';

  const handleNext = useCallback(async (
    ratingOverride?: ReviewRating,
    accuracy?: ReviewAccuracyPayload,
  ) => {
    if (!cardForReview || isReviewing) return;
    if (isPendingMaster) {
      await runExitingMutation(
        () => masterCardMutation({ cardId: cardForReview._id }),
        'Failed to master card:',
      );
      return;
    }
    if (isPendingHide) {
      await runExitingMutation(
        () => hideCardMutation({ cardId: cardForReview._id }),
        'Failed to hide card:',
      );
      return;
    }
    if (isFreePlay) {
      // Free play bypasses FSRS entirely: no rating, no scheduling write, no
      // celebration. Just bump the active face's play counter so the
      // next-lowest counter rises to the front of the queue. The mutation
      // reads the face off course settings, so it can never advance a
      // different rotation than the one being served.
      // `alwaysClearExiting`: the shared reset effect only fires when
      // `cardForReview._id` changes, so on a same-id re-render (single-card
      // decks) it would otherwise leave the card pane blank.
      await runExitingMutation(
        () =>
          advanceFreePlayCardMutation({
            cardId: cardForReview._id,
            timezone: getUserTimezone(),
            timeSpentMs: Math.max(0, Date.now() - cardShownAtRef.current),
          }),
        'Failed to advance free-play card:',
        { alwaysClearExiting: true },
      );
      return;
    }
    const phase = effectivePhase(reviewMode, cardForReview.schedulingPhase as SchedulingPhase);
    const defaultRatingForPhase = getDefaultRating(phase);
    const rating =
      ratingOverride ?? selectedRating ?? autoRatingState ?? defaultRatingForPhase;
    // `wasDefaultRating` deliberately still means "the review landed on the
    // phase default", NOT "the user accepted what was offered". Redefining it
    // would change its meaning for audio and pre-review mode too, and it has
    // no reader today (dailyStats.defaultRatingUsed / defaultRatingChanged are
    // written and reversed but never queried). If auto-rate acceptance ever
    // needs measuring, add an explicit `ratingSource` arg rather than
    // reinterpreting these counters.
    handleReview(rating, rating === defaultRatingForPhase, accuracy);
  }, [
    cardForReview,
    isReviewing,
    isPendingMaster,
    isPendingHide,
    isFreePlay,
    selectedRating,
    autoRatingState,
    reviewMode,
    handleReview,
    runExitingMutation,
    masterCardMutation,
    hideCardMutation,
    advanceFreePlayCardMutation,
  ]);

  // ============================================================================
  // Return discriminated states
  // ============================================================================

  // Cross-cutting fields shared by every state, including the progress
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
    setAutoRating,
    autoAddHeld,
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

  // No cards due, or a transient gap between cards while auto-add runs.
  let displayCard: NonNullable<typeof cardForReview> | undefined =
    cardForReview ?? undefined;
  if (cardForReview === null) {
    const activeEntry = collectionProgress?.find(
      (c) => c.collectionId === courseSettings.activeCollectionId,
    );
    // Ignored texts are excluded from auto-add, with them counted, auto-add
    // would look like it "will run" on a collection whose only unadded texts
    // are ignored, and the user would sit on the loading screen instead of
    // the noCardsDue screen.
    const remainingInCollection = activeEntry
      ? collectionRemaining(activeEntry.totalTexts, activeEntry)
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
      (remainingInCollection === null || remainingInCollection > 0) &&
      // A completed run proved this collection drained. The effect won't
      // re-fire for it, so don't promise a load that will never happen.
      autoAddExhaustedForRef.current !==
        courseSettings.activeCollectionId?.toString();

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
          courseSettings.cardsToAddBatchSize ?? DEFAULT_BATCH_SIZE,
        sentencesRemaining: sentencesQuota.unlimited ? null : sentencesQuota.balance,
        remainingInCollection,
        handleSchedulingModeChange,
      };
    }
  }

  if (!displayCard) {
    return { ...base, status: 'loading' };
  }

  // Reviewing, in full review mode, always use FSRS ratings (skip pre-review).
  // In free play (radio / free study), skip rating UI entirely (no FSRS, no
  // rating buttons, LearningControls falls back to a plain Next button).
  const phase = effectivePhase(reviewMode, displayCard.schedulingPhase as SchedulingPhase);
  const validRatings = isFreePlay ? [] : getValidRatings(phase);
  const defaultRating = getDefaultRating(phase);
  // Manual choice first, then the accuracy suggestion, then the phase default.
  const activeRating = selectedRating ?? autoRatingState ?? defaultRating;

  // Compute projected next-due interval for each rating
  const ratingIntervals: Record<string, string> = {};
  if (!isFreePlay) {
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
    freeStudyPlayCount: displayCard.freeStudyPlayCount ?? 0,
    goodReviewCount: displayCard.goodReviewCount ?? 0,
    collectionLabel: displayCard.collectionLabel,
    collectionOrigin: displayCard.collectionOrigin,
    collectionCefrTier: displayCard.collectionCefrTier,
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
    handleUndo,
    canUndo: undoableReviewCount > 0,
    isReviewing,
    isUndoing,
    isExiting,
    animationKey: cardAnimationKey,
    getReviewInitiatedByThisTab,
    resetReviewFlag,
    handleSchedulingModeChange,
  };
}
