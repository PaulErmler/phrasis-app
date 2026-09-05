import { viewOfCard } from '../db/translationReads';
import { v, ConvexError, type Infer } from 'convex/values';
import { MutationCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import {
  scheduleCard,
  getValidRatings,
  type CardSchedulingState,
  type ScheduleResult,
  type SchedulingPhase,
  type StudyDay,
} from '../../lib/scheduling';
import { pickUniqueDueSlot } from '../lib/dueSlots';
import {
  reviewRatingValidator,
  reviewModeValidator,
  type SchedulingTrack,
  type ReviewRating,
  type ReviewMode,
  type FsrsState,
} from '../types';
import {
  maybeScheduleWritingSeed,
  writingSeedPatch,
} from '../migrations/seedWritingTrack';
import { buildCardSearchableText } from '../lib/cardContent';
import { patchCard, getCardOriginBucket } from '../db/stats/cardAggregates';
import { insertReviewHistory } from '../db/reviewHistory';
import { logReview } from '../db/reviewLogs';
import { reviewTimeApplyPatch } from '../lib/reviewTimeStats';
import { getDailyStats } from '../db/stats/dailyStats';
import { PROGRESS_DISPLAY_INTERVAL } from '../../lib/constants/learning';

/**
 * Implementation phases of `reviewCard` (registered in
 * convex/features/scheduling.ts — the function reference stays
 * `api.features.scheduling.reviewCard`). The mutation handler reads as the
 * orchestration of the named steps below: writing baseline → phase/args
 * validation → FSRS transition → searchable-text refresh → stats → card
 * patch → history row → undo log → celebration verdict.
 */

/** Args of the `reviewCard` mutation. Declared here so the handler's helper
 * phases and the registration in scheduling.ts share one source of truth. */
const vReviewCardArgs = v.object({
  cardId: v.id('cards'),
  rating: reviewRatingValidator,
  timeSpentMs: v.optional(v.number()),
  timezone: v.string(),
  forceReviewPhase: v.optional(v.boolean()),
  reviewMode: v.optional(reviewModeValidator),
  accuracy: v.optional(v.number()),
  // Same review scored both ways, so stats keep both series regardless of
  // the learner's `ignorePunctuation` setting. Only recorded when both are
  // present. See recordReviewStats.
  accuracyStrict: v.optional(v.number()),
  accuracyLenient: v.optional(v.number()),
  wasDefaultRating: v.optional(v.boolean()),
  sessionId: v.optional(v.string()),
});
export const reviewCardArgsFields = vReviewCardArgs.fields;
export type ReviewCardArgs = Infer<typeof vReviewCardArgs>;

/**
 * The state a writing-track review schedules FROM, with the lazy seed
 * resolved (see `resolveWritingBaseline`). For shared-track reviews the
 * fields are the card's raw writing fields (unused downstream).
 */
export type WritingBaseline = {
  /** True when this is a writing-track review of a card the enable-time
   * backfill hasn't seeded yet. */
  writingUnseeded: boolean;
  /** Due date the writing schedule starts from (callers fall back to
   * `card.dueDate` when unset). */
  writingDueDate: number | undefined;
  priorFsrsState: FsrsState | undefined;
  priorGraduated: boolean;
  priorGoodCount: number;
};

/**
 * Resolve the baseline a writing-track review schedules from, seeding it
 * lazily for cards the enable-time backfill hasn't reached.
 */
export async function resolveWritingBaseline(
  ctx: MutationCtx,
  card: Doc<'cards'>,
  reviewSettings: Doc<'courseSettings'> | null,
  track: SchedulingTrack,
): Promise<WritingBaseline> {
  // Lazy seed: a writing-track review of a card the enable-time backfill
  // hasn't reached yet (or one created while the split was off) starts from
  // a copy of the shared schedule. Exactly what the backfill would have
  // written. The undo snapshot still records the true prior (unset)
  // writing fields, so undoing returns the card to its unseeded state.
  const writingUnseeded =
    track === 'writing' && card.writingDueDate === undefined;
  // An unseeded card reaching a writing review means the enable-time sweep
  // hasn't finished (or died mid-chain), re-kick it. Debounced inside the
  // helper, and the sweep fast-skips already-seeded cards, so this is cheap
  // and only fires during the (normally short) backfill window.
  if (writingUnseeded && reviewSettings) {
    await maybeScheduleWritingSeed(ctx, reviewSettings);
  }
  // The baseline this review schedules FROM: for an unseeded card, exactly
  // the patch the backfill sweep would have written. The same helper, so
  // the two seeding paths share one formula and cannot diverge.
  const writingBaseline = writingUnseeded ? writingSeedPatch(card) : card;
  return {
    writingUnseeded,
    writingDueDate: writingBaseline.writingDueDate,
    priorFsrsState: writingBaseline.writingFsrsState,
    priorGraduated: writingBaseline.writingIsGraduated ?? false,
    priorGoodCount: writingBaseline.writingGoodReviewCount ?? 0,
  };
}

/**
 * Resolve which scheduling phase this review runs in and validate the
 * rating/accuracy args against it. Throws ConvexError on invalid input.
 */
export function resolveValidatedPhase(
  card: Doc<'cards'>,
  track: SchedulingTrack,
  args: Pick<
    ReviewCardArgs,
    | 'forceReviewPhase'
    | 'rating'
    | 'accuracy'
    | 'accuracyStrict'
    | 'accuracyLenient'
  >,
): SchedulingPhase {
  // When forceReviewPhase is true (full review mode), treat the card as
  // being in the 'review' phase so FSRS ratings are accepted directly.
  // The writing track has no pre-review phase at all.
  const phase =
    args.forceReviewPhase || track === 'writing'
      ? ('review' as const)
      : card.schedulingPhase;
  const validRatings = getValidRatings(phase);
  if (!validRatings.includes(args.rating)) {
    throw new ConvexError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid rating "${args.rating}" for ${phase} phase. Valid ratings: ${validRatings.join(', ')}`,
    });
  }

  const assertAccuracy = (value: number | undefined, name: string) => {
    if (value != null && (value < 0 || value > 1 || !Number.isFinite(value))) {
      throw new ConvexError({
        code: 'INVALID_ARGUMENT',
        message: `Invalid ${name} value, must be between 0 and 1`,
      });
    }
  };
  assertAccuracy(args.accuracy, 'accuracy');
  assertAccuracy(args.accuracyStrict, 'accuracyStrict');
  assertAccuracy(args.accuracyLenient, 'accuracyLenient');

  return phase;
}

/** Output of `applyFsrsTransition`: the state the review was scheduled FROM
 * (`cardState`, lazy-seed resolved on the writing track), the scheduler's
 * verdict, and the due date every downstream phase persists (the verdict's
 * own `dueDate` spread into its unique slot when it was snapped to a study
 * day). */
export type ReviewTransition = {
  cardState: CardSchedulingState;
  result: ScheduleResult;
  dueDate: number;
};

/**
 * Run the shared FSRS scheduling algorithm over the reviewed track's current
 * state and resolve the due date the card is persisted with.
 *
 * Day-scale results come back from `scheduleCard` as a study-day start
 * (`snappedToStudyDay`) and get a unique random slot inside that day's
 * window here (`pickUniqueDueSlot`). Minute-scale steps keep FSRS's exact
 * instant. Nothing is jittered any more: reviews within a deck are
 * sequential and ms-resolved, and the index breaks any residual tie on
 * `_creationTime`, so the served order is deterministic either way.
 */
export async function applyFsrsTransition(
  ctx: MutationCtx,
  params: {
    card: Doc<'cards'>;
    track: SchedulingTrack;
    writing: WritingBaseline;
    phase: SchedulingPhase;
    rating: ReviewRating;
    initialReviewCount: number;
    now: number;
    studyDay: StudyDay | undefined;
  },
): Promise<ReviewTransition> {
  const {
    card,
    track,
    writing,
    phase,
    rating,
    initialReviewCount,
    now,
    studyDay,
  } = params;

  // Build current scheduling state from the reviewed track
  const cardState: CardSchedulingState =
    track === 'writing'
      ? {
          schedulingPhase: 'review',
          preReviewCount: 0,
          dueDate: writing.writingDueDate ?? card.dueDate,
          fsrsState: writing.priorFsrsState ?? null,
        }
      : {
          schedulingPhase: phase,
          preReviewCount: card.preReviewCount,
          dueDate: card.dueDate,
          fsrsState: card.fsrsState ?? null,
        };

  // Run the shared scheduling algorithm
  const result = scheduleCard(
    cardState,
    rating,
    initialReviewCount,
    now,
    undefined,
    studyDay,
  );

  // A snapped result whose day window turns out to have no free slot (16
  // probes, practically unreachable) keeps FSRS's exact instant rather than
  // failing the review.
  const dueDate = result.snappedToStudyDay
    ? ((await pickUniqueDueSlot(ctx, card.deckId, track, result.dueDate)) ??
      result.fsrsState?.due ??
      result.dueDate)
    : result.dueDate;

  return { cardState, result, dueDate };
}

/**
 * Decide whether the card's cached `searchableText` is stale, and fetch the
 * text doc at most once for the two consumers that may need it: the
 * searchable-text rebuild here and word tracking inside `recordReviewStats`
 * (which receives the returned `text`).
 */
export async function resolveSearchableTextRefresh(
  ctx: MutationCtx,
  card: Doc<'cards'>,
  course: Doc<'courses'>,
): Promise<{
  text: Doc<'texts'> | null;
  searchableTextPatch:
    | { searchableText: string; searchableTextLanguages: string[] }
    | undefined;
}> {
  // Rebuild searchableText only when the card's cached languages don't match
  // the current course languages (new language added, or card predates this field) or translation were generated after card was added.
  const courseLanguages = [...course.baseLanguages, ...course.targetLanguages];
  const courseLanguageSet = new Set(courseLanguages);
  const cached = card.searchableTextLanguages;
  const searchableTextIsStale =
    cached === undefined ||
    cached.length !== courseLanguages.length ||
    cached.some((l) => !courseLanguageSet.has(l));

  // Determine whether word tracking will need the text doc (saves us
  // re-fetching it inside recordReviewStats).
  const trackedSet = new Set(card.wordsTrackedLanguages ?? []);
  const allCourseLanguagesUnique = [...new Set(courseLanguages)];
  const hasUntrackedLanguages = allCourseLanguagesUnique.some(
    (l) => !trackedSet.has(l),
  );

  // Fetch the text exactly once if either branch needs it.
  const text =
    searchableTextIsStale || hasUntrackedLanguages
      ? await ctx.db.get(card.textId)
      : null;

  let searchableTextPatch:
    | { searchableText: string; searchableTextLanguages: string[] }
    | undefined;
  if (searchableTextIsStale && text) {
    searchableTextPatch = await buildCardSearchableText(
      ctx,
      card.textId,
      courseLanguages,
      { text, view: viewOfCard(card) },
    );
  }

  return { text, searchableTextPatch };
}

/**
 * Persist the review's outcome on the card via the aggregate-aware
 * `patchCard`. Only the reviewed track's scheduling fields are written;
 * under separateModeTracking the other track's schedule is untouched.
 */
export async function applyReviewPatchToCard(
  ctx: MutationCtx,
  params: {
    card: Doc<'cards'>;
    track: SchedulingTrack;
    rating: ReviewRating;
    reviewMode: ReviewMode | undefined;
    timeSpentMs: number | undefined;
    transition: ReviewTransition;
    writing: WritingBaseline;
    searchableTextPatch:
      | { searchableText: string; searchableTextLanguages: string[] }
      | undefined;
    newWordsTrackedLanguages: string[] | undefined;
  },
): Promise<void> {
  const {
    card,
    track,
    rating,
    reviewMode,
    timeSpentMs,
    writing,
    searchableTextPatch,
    newWordsTrackedLanguages,
  } = params;
  const { result, dueDate } = params.transition;

  // Flip isGraduated once the card reaches FSRS Review state (one-way flag)
  const isGraduatedPatch =
    !(card.isGraduated ?? false) &&
    result.fsrsState &&
    result.fsrsState.state >= 2
      ? { isGraduated: true as const }
      : {};

  // Patch the card (via aggregate-aware helper). We pass `card` as oldDoc so
  // patchCard can skip both the pre- and post-patch reads. Only the reviewed
  // track's scheduling fields are written, under separateModeTracking the
  // other track's schedule is untouched.
  // Per-mode review counter. Keyed by what the user actually did
  // (args.reviewMode), independent of the track the review wrote, so it
  // counts correctly with the split on or off. Same 'audio' default as
  // statsReversal.reviewModeForStats; decremented symmetrically on undo.
  const prevModeCounts = card.reviewCountByMode ?? { audio: 0, full: 0 };
  const reviewModeKey = reviewMode ?? 'audio';
  const nonSchedulingPatch = {
    ...searchableTextPatch,
    ...(newWordsTrackedLanguages
      ? { wordsTrackedLanguages: newWordsTrackedLanguages }
      : {}),
    reviewCountByMode: {
      ...prevModeCounts,
      [reviewModeKey]: prevModeCounts[reviewModeKey] + 1,
    },
    // Per-card running time-per-review average for this mode. Reversed on
    // undo from the history row's raw sample (reviewTimeUndoPatch).
    ...reviewTimeApplyPatch(card, reviewModeKey, timeSpentMs),
  };
  if (track === 'writing') {
    await patchCard(
      ctx,
      card._id,
      {
        writingDueDate: dueDate,
        writingLastReviewedAt: Date.now(),
        // `lastReviewedAt` is the track-agnostic activity timestamp (the
        // Library sorts and displays it; even free-play stamps it), so a
        // writing review updates it too. Like free play, undo does not
        // restore it, prevWriting snapshots only the writing schedule.
        lastReviewedAt: Date.now(),
        // Writing-track counterpart of goodReviewCount. On a lazy seed the
        // copied baseline is persisted even for non-good ratings, so the
        // review is indistinguishable from backfill-then-review.
        ...(rating === 'good' || rating === 'easy'
          ? { writingGoodReviewCount: writing.priorGoodCount + 1 }
          : writing.writingUnseeded && card.goodReviewCount !== undefined
            ? { writingGoodReviewCount: writing.priorGoodCount }
            : {}),
        ...(result.fsrsState && { writingFsrsState: result.fsrsState }),
        // Always write the flag (never leave it undefined): the learn_new
        // writing index matches on eq(writingIsGraduated, false), which an
        // undefined field would silently fall out of. One-way like
        // isGraduated.
        writingIsGraduated:
          writing.priorGraduated ||
          (result.fsrsState !== null && result.fsrsState.state >= 2),
        ...nonSchedulingPatch,
      },
      card,
    );
  } else {
    await patchCard(
      ctx,
      card._id,
      {
        schedulingPhase: result.schedulingPhase,
        preReviewCount: result.preReviewCount,
        dueDate,
        lastReviewedAt: Date.now(),
        // Only FSRS good/easy count (never pre-review "understood"), drives
        // the "until rated good" Practice-Listening strategy.
        ...(rating === 'good' || rating === 'easy'
          ? { goodReviewCount: (card.goodReviewCount ?? 0) + 1 }
          : {}),
        ...(result.fsrsState && { fsrsState: result.fsrsState }),
        ...isGraduatedPatch,
        ...nonSchedulingPatch,
      },
      card,
    );
  }
}

/**
 * Append the permanent per-review history row (append-only, unlike the
 * capped undo stack). Snapshots the scheduling transition on the reviewed
 * track: prev* is the state the review was scheduled FROM — on the
 * lazy-seed path that's the copied shared baseline (`cardState`), which
 * is what retrospective schedule reconstruction needs; the card's raw
 * pre-review fields stay in the undo snapshot (`logReviewForUndo`).
 */
export async function recordReviewHistoryRow(
  ctx: MutationCtx,
  params: {
    userId: string;
    courseId: Id<'courses'>;
    card: Doc<'cards'>;
    args: ReviewCardArgs;
    track: SchedulingTrack;
    phase: SchedulingPhase;
    transition: ReviewTransition;
    todayDate: string;
    wasFirstReview: boolean;
    writingUnseeded: boolean;
  },
): Promise<Id<'reviewHistory'>> {
  const {
    userId,
    courseId,
    card,
    args,
    track,
    phase,
    todayDate,
    wasFirstReview,
    writingUnseeded,
  } = params;
  const { cardState, result, dueDate } = params.transition;

  return insertReviewHistory(ctx, {
    userId,
    courseId,
    cardId: args.cardId,
    reviewedAt: Date.now(),
    date: todayDate,
    timezone: args.timezone,
    track,
    reviewMode: args.reviewMode,
    phase,
    rating: args.rating,
    timeSpentMs: args.timeSpentMs,
    wasDefaultRating: args.wasDefaultRating,
    wasFirstReview,
    accuracy: args.accuracy,
    // Mirrors the both-present gate in recordReviewStats.
    ...(args.accuracyStrict != null && args.accuracyLenient != null
      ? {
          accuracyStrict: args.accuracyStrict,
          accuracyLenient: args.accuracyLenient,
        }
      : {}),
    sessionId: args.sessionId,
    prevDueDate: cardState.dueDate,
    newDueDate: dueDate,
    ...(track === 'shared' ? { prevPreReviewCount: card.preReviewCount } : {}),
    prevFsrsState: cardState.fsrsState ?? undefined,
    newFsrsState: result.fsrsState ?? undefined,
    ...(result.phaseTransitioned ? { phaseTransitioned: true } : {}),
    ...(writingUnseeded ? { lazySeededWriting: true } : {}),
  });
}

/**
 * Log the review for the learn-mode undo stack: the pre-patch card
 * snapshot plus the keys `reverseReviewStats` needs to decrement the
 * right stat buckets. The study context stamps scope undo to the settings
 * the review happened under.
 */
export async function logReviewForUndo(
  ctx: MutationCtx,
  params: {
    userId: string;
    courseId: Id<'courses'>;
    card: Doc<'cards'>;
    args: ReviewCardArgs;
    reviewSettings: Doc<'courseSettings'> | null;
    track: SchedulingTrack;
    historyId: Id<'reviewHistory'>;
    writing: WritingBaseline;
    stats: {
      todayDate: string;
      hourOfDay: number;
      languages: string[];
      wasFirstReview: boolean;
    };
  },
): Promise<void> {
  const {
    userId,
    courseId,
    card,
    args,
    reviewSettings,
    track,
    historyId,
    writing,
    stats,
  } = params;

  await logReview(ctx, {
    userId,
    courseId,
    cardId: args.cardId,
    reviewedAt: Date.now(),
    timezone: args.timezone,
    kind: 'review',
    date: stats.todayDate,
    schedulingMode: reviewSettings?.schedulingMode ?? 'learnAndReview',
    studyContentFilter: reviewSettings?.studyContentFilter ?? 'both',
    track,
    historyId,
    // Snapshot the reviewed track's TRUE prior fields (for a lazy seed
    // that's all-undefined), so undo restores exactly what was overwritten.
    ...(track === 'writing'
      ? {
          prevWriting: {
            writingDueDate: card.writingDueDate,
            writingFsrsState: card.writingFsrsState,
            writingIsGraduated: card.writingIsGraduated,
            writingLastReviewedAt: card.writingLastReviewedAt,
            writingGoodReviewCount: card.writingGoodReviewCount,
          },
        }
      : {
          prevCard: {
            dueDate: card.dueDate,
            schedulingPhase: card.schedulingPhase,
            preReviewCount: card.preReviewCount,
            fsrsState: card.fsrsState,
            isGraduated: card.isGraduated,
            lastReviewedAt: card.lastReviewedAt,
            goodReviewCount: card.goodReviewCount,
          },
        }),
    statsReversal: {
      hourOfDay: stats.hourOfDay,
      rating: args.rating,
      reviewModeForStats: args.reviewMode ?? 'audio',
      reviewModeRaw: args.reviewMode,
      wasFirstReview: stats.wasFirstReview,
      // Bucket the dailyStats.newCardsByOrigin increment landed in. Stamped
      // (not re-derived on undo) for the same reason as `cardState` below.
      newCardOrigin: getCardOriginBucket(card),
      wasDefaultRating: args.wasDefaultRating,
      accuracy: args.accuracy,
      // Mirrors the both-present gate in recordReviewStats so undo reverses
      // exactly what was written.
      ...(args.accuracyStrict != null && args.accuracyLenient != null
        ? {
            accuracyStrict: args.accuracyStrict,
            accuracyLenient: args.accuracyLenient,
          }
        : {}),
      // Must mirror recordReviewStats' formula per track, including the
      // lazy-seed resolution (priorFsrsState, not the raw card).
      reviewDepth:
        args.accuracy != null
          ? track === 'writing'
            ? (writing.priorFsrsState?.reps ?? 0) + 1
            : card.preReviewCount + (card.fsrsState?.reps ?? 0) + 1
          : undefined,
      // Same rule, same reason, for the reviewsByCardState bucket: stamp the
      // state the review was scheduled FROM. `prevWriting` above snapshots
      // the card's true (on a lazy seed, unset) writing fields because undo
      // must restore them, so it is NOT a valid source for the stat bucket,
      // and re-deriving from it would decrement 'new' for a review counted
      // under the copied shared state.
      cardState:
        (track === 'writing' ? writing.priorFsrsState : card.fsrsState)
          ?.state ?? 0,
      languages: stats.languages,
      collectionId: card.collectionId,
    },
  });
}

/**
 * Server-side milestone verdict: client just respects this. Opt-out
 * setting defaults to enabled when undefined (matches the UI check
 * `progressDisplayEnabled !== false`). The `lastCelebratedAtCount`
 * high-water mark keeps an undo + re-review from replaying a celebration:
 * the count must EXCEED the mark, and undo never lowers it.
 */
export async function resolveCelebrationVerdict(
  ctx: MutationCtx,
  params: {
    userId: string;
    courseId: Id<'courses'>;
    reviewSettings: Doc<'courseSettings'> | null;
    dailyReviewsToday: number;
    lastCelebratedAtCount: number;
    todayDate: string;
  },
): Promise<{ triggerCelebration: boolean; celebrationHighWater: number }> {
  const {
    userId,
    courseId,
    reviewSettings,
    dailyReviewsToday,
    lastCelebratedAtCount,
    todayDate,
  } = params;

  const progressDisplayEnabled =
    reviewSettings?.progressDisplayEnabled !== false;
  let celebrationHighWater = lastCelebratedAtCount;
  let triggerCelebration =
    progressDisplayEnabled &&
    dailyReviewsToday > 0 &&
    dailyReviewsToday % PROGRESS_DISPLAY_INTERVAL === 0 &&
    dailyReviewsToday > lastCelebratedAtCount;
  if (triggerCelebration) {
    const todayStats = await getDailyStats(ctx, userId, courseId, todayDate);
    if (todayStats) {
      await ctx.db.patch(todayStats._id, {
        lastCelebratedAtCount: dailyReviewsToday,
      });
      celebrationHighWater = dailyReviewsToday;
    } else {
      triggerCelebration = false;
    }
  }
  return { triggerCelebration, celebrationHighWater };
}
