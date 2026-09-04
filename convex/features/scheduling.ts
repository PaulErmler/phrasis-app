import { v, ConvexError, type Infer } from 'convex/values';
import { mutation, query, MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import {
  buildCardSearchableText,
  buildTextContentBatchForLanguages,
  type CardAlternativeContent,
} from '../lib/cardContent';
import {
  cardPinAt,
  liveTranslation,
  resolveServedFromLive,
  type ServedTranslation,
} from '../db/translationReads';
import { Id, Doc } from '../_generated/dataModel';
import { getAuthUserId, requireAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getCourseSettings } from '../db/courseSettings';
import { hasPendingCustomCardsToAdd } from '../db/collections';
import { getDeckByCourseId } from '../db/decks';
import { trackEvent } from '../db/stats/dailyStats';
import { EVENTS, track } from '../analytics';
import { recordReviewStats } from '../db/stats/recordReviewStats';
import { recordFreePlayStats } from '../db/stats/recordFreePlayStats';
import {
  reverseReviewStats,
  reverseFreePlayStats,
  readTodayCounters,
} from '../db/stats/reverseReviewStats';
import {
  logReview,
  takeUndoableLogs,
  studyContextFromSettings,
} from '../db/reviewLogs';
import { reviewTimeUndoPatch } from '../lib/reviewTimeStats';
import {
  floorToCelebration,
  displayedActiveReviews,
} from '../db/stats/dailyStats';
import { patchCard, deleteCard } from '../db/stats/cardAggregates';
import {
  languageRole,
  recordCardEdit,
  recordRetranslationAttempt,
  retranslationAuditFields,
  setCardEditResult,
  type RetranslationAuditFields,
} from './cardEditAudit';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';
import {
  fsrsStateValidator,
  translationValidator,
  audioRecordingValidator,
  schedulingPhaseValidator,
  freePlayFace,
  schedulingTrackFromSettings,
  type SchedulingMode,
  type SchedulingTrack,
  type StudyContentFilter,
  type FreePlayFace,
  type CardEditLanguageRole,
} from '../types';
import { cardOriginPillFields, originsForFilter } from '../lib/collections';
import {
  FREE_PLAY_MODES,
  fetchFreePlayRotation,
  randomOrderKey,
} from '../lib/freePlay';
import { getTodayInTimezone, resolveClientNow } from '../lib/dateUtils';
import { dateInTimezone } from '../../lib/dateStrings';
import { deleteAudioRow, deleteAudioRowsForTextLanguage } from '../lib/audio';
import { normalizeForComparison } from '../lib/textComparison';
import { FLAG_AUTO_RETRANSLATION_MAX } from '../../lib/languages';
import {
  isUserCreatedText,
  mayRegenerateTranslation,
} from '../../lib/translationProvenance';
import { consumeQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import {
  regenerateSupersededRevisionAudio,
  scheduleMissingContent,
} from '../lib/contentScheduling';
import { fetchTrackDueCards } from '../lib/dueQueue';
import { claimLlmTranslationIfAvailable } from './llmTranslationQueue';
import { WRITING_ALTERNATIVES_MAX } from '../../lib/constants/learning';
import {
  CARD_OVERRIDE_SPEED_MIN,
  CARD_OVERRIDE_SPEED_MAX,
} from '../../lib/constants/audioPlayback';
import {
  resolveCardEditPlan,
  assertTranslationLengths,
  recordCardEditAuditStart,
  applyInPlaceTextEdit,
  forkSharedTextForEdit,
  repointCardAtEditedText,
  propagateEditToDerivedContent,
} from './cardEditPipeline';
import {
  reviewCardArgsFields,
  resolveWritingBaseline,
  resolveValidatedPhase,
  applyFsrsTransition,
  resolveSearchableTextRefresh,
  applyReviewPatchToCard,
  recordReviewHistoryRow,
  logReviewForUndo,
  resolveCelebrationVerdict,
} from './reviewPipeline';

/**
 * Authenticate the user and verify ownership of a card via deck → course.
 * Throws ConvexError on failure. Every card-mutating entry point shares this
 * ONE ownership rule instead of re-implementing the card → deck → course walk
 * The chat "also correct" replace inherits it through `applyCardEdit`.
 */
async function authorizeCardAccess(ctx: MutationCtx, cardId: Id<'cards'>) {
  const userId = await requireAuthUserId(ctx);

  const card = await ctx.db.get(cardId);
  if (!card)
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Card not found' });

  const deck = await ctx.db.get(card.deckId);
  if (!deck)
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Deck not found' });

  const course = await ctx.db.get(deck.courseId);
  if (!course || course.userId !== userId)
    throw new ConvexError({ code: 'FORBIDDEN', message: 'Unauthorized' });

  return { userId, card, deck, course };
}

/**
 * One `card_action` event for every deliberate action a user takes on a card.
 *
 * Deliberately NOT fired on review. Ratings are the highest-frequency thing in
 * the app and are already recorded, with far more detail, in `dailyStats` /
 * `courseStats` / `reviewDepthAccuracy`. These are the low-volume, intentful
 * actions: the ones that say something about how people curate their deck.
 */
async function trackCardAction(
  ctx: MutationCtx,
  userId: string,
  action: string,
  card: Doc<'cards'>,
  extra?: Record<string, unknown>,
): Promise<void> {
  await track(ctx, userId, EVENTS.CARD_ACTION, {
    action,
    card_id: card._id,
    collection_id: card.collectionId,
    scheduling_phase: card.schedulingPhase,
    ...extra,
  });
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get the next card due for review in the user's active deck.
 *
 * Returns the card with the earliest dueDate that is <= now and not hidden,
 * joined with its text, translations, and audio recordings.
 */
const cardResultFields = {
  _id: v.id('cards'),
  _creationTime: v.number(),
  textId: v.id('texts'),
  sourceText: v.string(),
  sourceLanguage: v.string(),
  translations: v.array(translationValidator),
  audioRecordings: v.array(audioRecordingValidator),
  dueDate: v.number(),
  isMastered: v.boolean(),
  isHidden: v.boolean(),
  isFavorite: v.optional(v.boolean()),
  schedulingPhase: schedulingPhaseValidator,
  preReviewCount: v.number(),
  initialReviewCount: v.number(),
  fsrsState: v.union(fsrsStateValidator, v.null()),
  // True count of radio plays for this card. Surfaced to the client so the
  // "Only new" Practice-Listening limit can count radio plays (which don't bump
  // the FSRS review count). Undefined for cards that predate the field.
  radioPlayCount: v.optional(v.number()),
  // True count of Free Study plays for this card, the writing face's analogue
  // of radioPlayCount. Surfaced so the "show translation on new sentences"
  // copy-typing assist can retire itself in free play, which advances neither
  // preReviewCount nor the FSRS reps. Undefined for cards that predate it.
  freeStudyPlayCount: v.optional(v.number()),
  // FSRS good/easy count. The "until rated good" Practice-Listening strategy.
  goodReviewCount: v.optional(v.number()),
  hasMissingContent: v.boolean(),
  audioSpeedOverrides: v.optional(v.record(v.string(), v.number())),
  // Source-collection shorthand ("A1.2"), origin bucket, and CEFR tier (the
  // pill's color key), for the optional card-origin pill. Null for cards
  // whose collection can't be resolved.
  collectionLabel: v.union(v.string(), v.null()),
  collectionOrigin: v.union(
    v.literal('premade'),
    v.literal('custom'),
    v.literal('chat'),
    v.null(),
  ),
  collectionCefrTier: v.union(v.string(), v.null()),
};

const cardResultValidator = v.object(cardResultFields);

/**
 * Fetch the top-K cards the current study surface serves: the free-play
 * rotation when a face is active, otherwise the active track's due queue
 * (see `fetchTrackDueCards` in convex/lib/dueQueue.ts, one selector for
 * both tracks, shared with the content warmer in decks.ts). Both shared
 * selectors exist for the same reason: the serving path and its consumers
 * (catch-up floor, warmer, probes) must always draw from the same
 * population.
 */
async function fetchDueCardsWithFilter(
  ctx: QueryCtx,
  deckId: Id<'decks'>,
  schedulingMode: SchedulingMode,
  face: FreePlayFace | null,
  filter: StudyContentFilter,
  track: SchedulingTrack,
  now: number,
  take: number,
): Promise<Doc<'cards'>[]> {
  if (face) {
    return fetchFreePlayRotation(ctx, deckId, face, filter, take);
  }
  return fetchTrackDueCards(
    ctx,
    deckId,
    schedulingMode,
    filter,
    track,
    now,
    take,
  );
}

/**
 * `getCardForReview`'s result. Hoisted so the handler can be annotated with
 * it: a Convex function's client-facing return type is inferred from the
 * HANDLER, not from `returns`, so an optional field declared only in the
 * validator (`nextCard`, see below) would still reach the client as
 * required and reject the optimistic advance's "unknown" preview.
 */
const getCardForReviewResult = v.union(
  v.object({
    ...cardResultFields,
    /** The card served after this one. `null` means the server found no
     * other card due now, i.e. this is the last of the queue (the client
     * pre-adds the next batch on that signal). Never omitted by the server;
     * `undefined` is reserved for the client's optimistic advance, which
     * cannot know the next preview until this query answers again. */
    nextCard: v.optional(v.union(cardResultValidator, v.null())),
    /** Today's non-radio review count (audio + full) for the active course,
     * mirroring what drives `triggerCelebration` in `reviewCard`. 0 when
     * `timezone` is omitted (caller opted out of the side-channel). */
    dailyReviewsToday: v.number(),
    /** How many reviews the undo button can take back (0..UNDO_DEPTH).
     * Bundled here so the learn view needs a single subscription that
     * invalidates once per review, not this query plus a separate
     * `getUndoableReviewCount`. */
    undoableCount: v.number(),
  }),
  v.null(),
);

export const getCardForReview = query({
  // `timezone` is optional so callers that don't care about the daily-count
  // side-channel (tests, the layout warm-up) can still call `{}`. The learn
  // view always supplies it so the in-learn progress bar can subscribe to
  // today's active review count via this single query, no separate
  // `getTodayReviewCount` subscription, and updates flow in live whether they
  // come from a local mutation or another device.
  //
  // `now` follows the no-wall-clock query guideline like getCardCounts
  // (stats.ts): a stable, minute-quantized client value keeps the app's
  // hottest query cacheable and bounds the due queue deterministically. It
  // stays OPTIONAL for back-compat: already-shipped bundles call without it
  // and keep the historical wall-clock behavior. The daily-count
  // side-channel's "today" is derived from the same `now` so the two can
  // never disagree. A skewed `now` only shifts the caller's own queue.
  args: { timezone: v.optional(v.string()), now: v.optional(v.number()) },
  returns: getCardForReviewResult,
  handler: async (ctx, args): Promise<Infer<typeof getCardForReviewResult>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const { course } = active;

    const deck = await getDeckByCourseId(ctx, course._id);
    if (!deck) return null;

    // Load settings (initialReviewCount + schedulingMode + studyContentFilter) from the courseSettings table
    const settings = await getCourseSettings(ctx, course._id);
    const initialReviewCount =
      settings?.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT;
    const studyContext = studyContextFromSettings(settings);
    const { schedulingMode, studyContentFilter } = studyContext;

    const now = resolveClientNow(args.now);

    // Fetch the current + peeked-next due cards so the client can pre-merge
    // audio for the upcoming card while the user is still on the current one.
    const dueCards = await fetchDueCardsWithFilter(
      ctx,
      deck._id,
      schedulingMode,
      studyContext.face,
      studyContentFilter,
      studyContext.track,
      now,
      2,
    );
    if (dueCards.length === 0) return null;

    // Current + peeked-next card content in one batched pass. `rawRomanization`
    // and `ignoreMissingWordTimings` keep this query's long-standing semantics:
    // it surfaces stored romanization for every language and does not treat
    // legacy timing-less audio as a content gap.
    const texts = await Promise.all(
      dueCards.map((card) => ctx.db.get(card.textId)),
    );
    // Source collections for the card-origin pill (max 2 point reads).
    const collections = await Promise.all(
      dueCards.map((card) =>
        card.collectionId ? ctx.db.get(card.collectionId) : null,
      ),
    );
    const contentInputs = dueCards.flatMap((card, i) => {
      const text = texts[i];
      return text
        ? [
            {
              key: String(i),
              textId: card.textId,
              sourceText: text.text,
              sourceLanguage: text.language,
              sourceRomanization: text.romanizedText ?? undefined,
              sourceIpa: text.ipaText ?? undefined,
              sourceFurigana: text.furiganaText ?? undefined,
              userCreated: text.userCreated,
              pinAt: cardPinAt(card),
            },
          ]
        : [];
    });
    const contentByKey = await buildTextContentBatchForLanguages(
      ctx,
      contentInputs,
      course.baseLanguages,
      course.targetLanguages,
      { rawRomanization: true, ignoreMissingWordTimings: true },
    );

    // AI-feedback accepted alternatives, card-scoped (unlike the shared text
    // content above): the writing card diffs against the closest of primary +
    // alternatives and lists the others with their own annotations + audio.
    // Usually-empty indexed reads, at most 2 cards x target languages.
    const alternativesByCardLang = new Map<string, CardAlternativeContent[]>();
    await Promise.all(
      dueCards.flatMap((card, i) =>
        course.targetLanguages.map(async (lang) => {
          const rows = await ctx.db
            .query('writingAlternatives')
            .withIndex('by_cardId_and_language', (q) =>
              q.eq('cardId', card._id).eq('language', lang),
            )
            .take(WRITING_ALTERNATIVES_MAX);
          if (rows.length === 0) return;
          alternativesByCardLang.set(
            `${i}:${lang}`,
            await Promise.all(
              rows.map(async (r) => {
                const asset = r.audioAssetId
                  ? await ctx.db.get(r.audioAssetId)
                  : null;
                return {
                  text: r.text,
                  // '' is the attempted-and-failed sentinel; hide it.
                  ...(r.romanizedText ? { romanization: r.romanizedText } : {}),
                  ...(r.ipaText ? { ipa: r.ipaText } : {}),
                  ...(r.furiganaText ? { furigana: r.furiganaText } : {}),
                  ...(asset
                    ? { audioUrl: await ctx.storage.getUrl(asset.storageId) }
                    : {}),
                };
              }),
            ),
          );
        }),
      ),
    );

    const buildCardResult = (card: Doc<'cards'>, index: number) => {
      const text = texts[index];
      const content = contentByKey.get(String(index));
      if (!text || !content) return null;

      const collection = collections[index];

      // Under separateModeTracking + Writing mode the writing track IS the
      // card's schedule as far as this session is concerned, so surface its
      // state in the shared-named fields the client already consumes (rating
      // interval previews read fsrsState; the writing track has no pre-review
      // phase, hence phase 'review' / count 0).
      //
      // DUE-QUEUE SERVING ONLY (`face === null`): in Free Study the track is
      // also 'writing' (same settings combination) but cards come from the
      // rotation. Masking their real preReviewCount/fsrsState there made
      // long-known cards look brand new to the client (translation assist
      // reappeared, first-exposure auto-rating kicked in).
      const writingTrack =
        studyContext.track === 'writing' && studyContext.face === null;

      return {
        _id: card._id,
        _creationTime: card._creationTime,
        textId: card.textId,
        sourceText: text.text,
        sourceLanguage: text.language,
        translations: content.translations.map((tr) => {
          const alternatives = alternativesByCardLang.get(
            `${index}:${tr.language}`,
          );
          return alternatives ? { ...tr, alternatives } : tr;
        }),
        audioRecordings: content.audioRecordings,
        dueDate: writingTrack
          ? (card.writingDueDate ?? card.dueDate)
          : card.dueDate,
        isMastered: card.isMastered,
        isHidden: card.isHidden,
        isFavorite: card.isFavorite ?? false,
        schedulingPhase: writingTrack
          ? ('review' as const)
          : card.schedulingPhase,
        preReviewCount: writingTrack ? 0 : card.preReviewCount,
        initialReviewCount,
        fsrsState:
          (writingTrack ? card.writingFsrsState : card.fsrsState) ?? null,
        radioPlayCount: card.radioPlayCount,
        freeStudyPlayCount: card.freeStudyPlayCount,
        goodReviewCount: card.goodReviewCount,
        hasMissingContent: content.hasMissingContent,
        audioSpeedOverrides: card.audioSpeedOverrides,
        ...cardOriginPillFields(collection),
        collectionOrigin: card.collectionOrigin ?? collection?.origin ?? null,
      };
    };

    const current = buildCardResult(dueCards[0], 0);
    const next = dueCards[1] ? buildCardResult(dueCards[1], 1) : null;

    if (!current) return null;

    // Today's active (non-radio) review count, same audio+full sum used by
    // `triggerCelebration` in `reviewCard`. Folding it into this query means
    // the bar updates live across devices via the same subscription, and we
    // avoid a second `getTodayReviewCount` subscription on the hot path.
    let dailyReviewsToday = 0;
    if (args.timezone) {
      const today = dateInTimezone(now, args.timezone);
      const todayStats = await ctx.db
        .query('dailyStats')
        .withIndex('by_userId_and_courseId_and_date', (q) =>
          q.eq('userId', userId).eq('courseId', course._id).eq('date', today),
        )
        .unique();
      dailyReviewsToday = displayedActiveReviews(todayStats);
    }

    // Undo stack depth under the CURRENT study context. Shares
    // takeUndoableLogs with undoLastReview so the button and the mutation
    // can't disagree.
    const undoable = await takeUndoableLogs(
      ctx,
      userId,
      course._id,
      studyContext,
    );

    return {
      ...current,
      nextCard: next,
      dailyReviewsToday,
      undoableCount: undoable.length,
    };
  },
});

/**
 * Reports WHY `getCardForReview` returned null, so the UI can choose between
 * a generic "all caught up" empty state and a filter-aware CTA.
 *
 *   - 'no_session'     : not signed in / no active course / no deck.
 *   - 'no_cards'       : deck has zero cards from any source (new user).
 *   - 'filtered_out'   : the content filter is hiding cards. The shape of
 *                        the unblock CTA depends on TWO signals:
 *                          • `currentSourceHasAnyCards`: does the user have
 *                            ANY cards in the source they're filtering to?
 *                            (false ⇒ they need to add cards, not just
 *                            wait for them to come due).
 *                          • `availableInOtherSource`: does the OTHER
 *                            source have at least one due card right now?
 *   - 'all_caught_up'  : the deck has cards but none are due right now
 *                        (filter not the cause).
 */
export const getCardForReviewEmptyReason = query({
  // `now` bounds the due-card probes; same optional back-compat contract as
  // getCardForReview above (no-wall-clock query guideline).
  args: { now: v.optional(v.number()) },
  returns: v.union(
    v.object({ reason: v.literal('no_session') }),
    v.object({ reason: v.literal('no_cards') }),
    v.object({
      reason: v.literal('filtered_out'),
      activeFilter: v.union(v.literal('custom'), v.literal('course')),
      currentSourceHasAnyCards: v.boolean(),
      availableInOtherSource: v.boolean(),
      customCardsPendingAdd: v.boolean(),
    }),
    v.object({
      reason: v.literal('all_caught_up'),
      customCardsPendingAdd: v.boolean(),
    }),
    // separateModeTracking: the enable-time writing seed is still in flight
    // (or stalled and awaiting a re-kick), so an empty writing queue says
    // nothing about the user's actual due state.
    v.object({ reason: v.literal('preparing_writing') }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { reason: 'no_session' as const };

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { reason: 'no_session' as const };

    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return { reason: 'no_session' as const };

    const settings = await getCourseSettings(ctx, active.course._id);
    const { schedulingMode, studyContentFilter, face, track } =
      studyContextFromSettings(settings);
    const now = resolveClientNow(args.now);

    // Cheap probe: any usable (non-hidden, non-mastered) card in the deck?
    // Using the (deckId, isHidden, isMastered) index so a deck of all-hidden
    // or all-mastered cards correctly resolves to 'no_cards' instead of
    // falling through to 'all_caught_up' / 'filtered_out'.
    const anyCard = await ctx.db
      .query('cards')
      .withIndex('by_deckId_and_isHidden_and_isMastered', (q) =>
        q.eq('deckId', deck._id).eq('isHidden', false).eq('isMastered', false),
      )
      .first();
    if (!anyCard) return { reason: 'no_cards' as const };

    // Writing queue while the enable-time seed is incomplete: unseeded cards
    // are deliberately excluded from every writing due query, so neither
    // "all caught up" nor the filtered-out analysis would be truthful yet.
    // (`track === 'writing'` already implies separateModeTracking is on.)
    //
    // `face === null` is load-bearing, exactly as in getCardForReview's
    // writing-track mask: schedulingTrackFromSettings ignores schedulingMode,
    // so Free Study (radio + Writing) also resolves to track 'writing', but
    // free play serves from the rotation and never reads the writing queue, so
    // reporting a seed-in-progress there would hide the real reason its
    // rotation is empty behind a spinner it can never clear.
    if (
      face === null &&
      track === 'writing' &&
      settings?.writingSeedDone !== true
    ) {
      return { reason: 'preparing_writing' as const };
    }

    const customCardsPendingAdd = await hasPendingCustomCardsToAdd(
      ctx,
      userId,
      active.course._id,
      settings?.activeCustomCollectionIds,
    );

    if (studyContentFilter === 'both') {
      return { reason: 'all_caught_up' as const, customCardsPendingAdd };
    }

    // Filter is active. Two probes:
    //   1. Does the current (filtered-to) source have ANY card at all? If
    //      not, the user must add: flipping the filter alone won't help in
    //      the long run.
    //   2. Does the OTHER source have any DUE card right now? If yes, we
    //      can offer the one-tap unblock.
    const currentOrigins =
      studyContentFilter === 'custom'
        ? (['custom', 'chat'] as const)
        : (['premade'] as const);
    let currentSourceHasAnyCards = false;
    for (const origin of currentOrigins) {
      const probe = await ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_origin_dueDate', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('collectionOrigin', origin),
        )
        .first();
      if (probe) {
        currentSourceHasAnyCards = true;
        break;
      }
    }

    const otherFilter: StudyContentFilter =
      studyContentFilter === 'custom' ? 'course' : 'custom';
    const otherCards = await fetchDueCardsWithFilter(
      ctx,
      deck._id,
      schedulingMode,
      face,
      otherFilter,
      track,
      now,
      1,
    );

    return {
      reason: 'filtered_out' as const,
      activeFilter: studyContentFilter,
      currentSourceHasAnyCards,
      availableInOtherSource: otherCards.length > 0,
      customCardsPendingAdd,
    };
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Review a card with the given rating.
 *
 * Delegates to the shared `scheduleCard()` function from lib/scheduling.ts
 * and patches the card document with the new scheduling state.
 */
export const reviewCard = mutation({
  args: reviewCardArgsFields,
  returns: v.object({
    schedulingPhase: schedulingPhaseValidator,
    preReviewCount: v.number(),
    dueDate: v.number(),
    phaseTransitioned: v.boolean(),
    fsrsState: v.union(fsrsStateValidator, v.null()),
    dailyReviewsToday: v.number(),
    dailyTimeMsToday: v.number(),
    dailyNewWordsToday: v.number(),
    triggerCelebration: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { userId, card, deck, course } = await authorizeCardAccess(
      ctx,
      args.cardId,
    );

    const reviewSettings = await getCourseSettings(ctx, deck.courseId);
    const initialReviewCount =
      reviewSettings?.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT;

    // Which per-card schedule this review writes: the writing track iff the
    // course has separateModeTracking on AND the review happened in Writing
    // mode. Derived from args.reviewMode (what the user actually did), not
    // settings.reviewMode. The two only diverge on a settings-update race.
    const track: SchedulingTrack = schedulingTrackFromSettings({
      separateModeTracking: reviewSettings?.separateModeTracking,
      reviewMode: args.reviewMode,
    });

    // Writing-track baseline with the lazy seed resolved (see
    // resolveWritingBaseline); phase + args validation; FSRS transition.
    const writing = await resolveWritingBaseline(
      ctx,
      card,
      reviewSettings,
      track,
    );
    const phase = resolveValidatedPhase(card, track, args);
    const transition = applyFsrsTransition({
      card,
      track,
      writing,
      phase,
      rating: args.rating,
      initialReviewCount,
    });
    const { result, dueDateWithJitter } = transition;

    // Stale searchable-text refresh; also fetches the text doc once when
    // word tracking (inside recordReviewStats) will need it.
    const { text, searchableTextPatch } = await resolveSearchableTextRefresh(
      ctx,
      card,
      course,
    );

    // Record stats first so we can fold the new wordsTrackedLanguages stamp
    // into the single patchCard call below. `recordReviewStats` reads `card`
    // by value and intentionally uses the pre-patch state for its own
    // bookkeeping (isFirstReview, fsrsCardState, reviewDepth), so order is safe.
    const {
      newWordsTrackedLanguages,
      dailyReviewsToday,
      dailyTimeMsToday,
      dailyNewWordsToday,
      todayDate,
      hourOfDay,
      languages,
      wasFirstReview,
      lastCelebratedAtCount,
    } = await recordReviewStats(ctx, {
      userId,
      card,
      deck,
      course,
      timezone: args.timezone,
      timeSpentMs: args.timeSpentMs,
      reviewMode: args.reviewMode,
      track,
      // The state this review was scheduled FROM, on the writing track's
      // lazy-seed path that's the copied shared state, not the (still unset)
      // raw writingFsrsState.
      priorFsrsState:
        track === 'writing'
          ? (writing.priorFsrsState ?? null)
          : (card.fsrsState ?? null),
      rating: args.rating,
      accuracy: args.accuracy,
      accuracyStrict: args.accuracyStrict,
      accuracyLenient: args.accuracyLenient,
      wasDefaultRating: args.wasDefaultRating,
      text,
      sessionId: args.sessionId,
    });

    // Persist the transition on the card via the aggregate-aware patch
    // (only the reviewed track's scheduling fields are written).
    await applyReviewPatchToCard(ctx, {
      card,
      track,
      rating: args.rating,
      reviewMode: args.reviewMode,
      timeSpentMs: args.timeSpentMs,
      transition,
      writing,
      searchableTextPatch,
      newWordsTrackedLanguages,
    });

    // Permanent per-review history row (append-only, unlike the capped undo
    // stack below).
    const historyId = await recordReviewHistoryRow(ctx, {
      userId,
      courseId: deck.courseId,
      card,
      args,
      track,
      phase,
      transition,
      todayDate,
      wasFirstReview,
      writingUnseeded: writing.writingUnseeded,
    });

    // Log the review for the learn-mode undo stack (pre-patch snapshot +
    // stat-reversal keys), then resolve the milestone-celebration verdict.
    await logReviewForUndo(ctx, {
      userId,
      courseId: deck.courseId,
      card,
      args,
      reviewSettings,
      track,
      historyId,
      writing,
      stats: { todayDate, hourOfDay, languages, wasFirstReview },
    });

    const { triggerCelebration, celebrationHighWater } =
      await resolveCelebrationVerdict(ctx, {
        userId,
        courseId: deck.courseId,
        reviewSettings,
        dailyReviewsToday,
        lastCelebratedAtCount,
        todayDate,
      });

    return {
      schedulingPhase: result.schedulingPhase,
      preReviewCount: result.preReviewCount,
      dueDate: dueDateWithJitter,
      phaseTransitioned: result.phaseTransitioned,
      fsrsState: result.fsrsState,
      dailyReviewsToday: floorToCelebration(
        dailyReviewsToday,
        celebrationHighWater,
      ),
      dailyTimeMsToday,
      dailyNewWordsToday,
      triggerCelebration,
    };
  },
});

/**
 * Undo the most recent card review (or radio play) for the active course.
 *
 * Pops the newest `reviewLogs` entry whose study context matches the CURRENT
 * course settings (see `takeUndoableLogs`), restores the card's pre-review
 * scheduling/rotation state from the snapshot, and reverses the review's
 * counting stats. Time spent, streak, and word tracking stay (the learning
 * genuinely happened; see `reverseReviewStats`). Restoring the snapshot
 * `dueDate` (or radio counters) deterministically makes the card the next one
 * served, since it was at the front of the queue when it was reviewed and
 * reviews only ever push cards backward.
 *
 * Cards hidden or mastered since the review are still undone (so the user can
 * unhide/unmaster and continue where they were), only deleted cards are
 * skipped. Returns `nothing_to_undo` instead of throwing when the stack is
 * empty: two devices racing over the same stack is expected, not an error.
 */
/**
 * Reverse `reviewCard`'s per-mode counter bump for one undone review entry.
 * Keyed by the entry's recorded raw mode with the same 'audio' default the
 * increment used. Cards whose counter predates the field (undefined) have
 * nothing to reverse; the floor guards a counter that was reset/migrated
 * between review and undo.
 */
function reviewCountUndoPatch(
  card: Doc<'cards'>,
  log: Doc<'reviewLogs'>,
): Partial<Doc<'cards'>> {
  const counts = card.reviewCountByMode;
  if (!counts) return {};
  const mode = log.statsReversal?.reviewModeRaw ?? 'audio';
  return {
    reviewCountByMode: {
      ...counts,
      [mode]: Math.max(0, counts[mode] - 1),
    },
  };
}

export const undoLastReview = mutation({
  args: { timezone: v.string() },
  returns: v.union(
    v.object({
      status: v.literal('undone'),
      cardId: v.id('cards'),
      dailyReviewsToday: v.number(),
      dailyTimeMsToday: v.number(),
      dailyNewWordsToday: v.number(),
    }),
    v.object({ status: v.literal('nothing_to_undo') }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { status: 'nothing_to_undo' as const };
    const { course } = active;

    const settings = await getCourseSettings(ctx, course._id);
    const studyContext = studyContextFromSettings(settings);

    const undoable = await takeUndoableLogs(
      ctx,
      userId,
      course._id,
      studyContext,
    );

    for (const log of undoable) {
      const card = await ctx.db.get(log.cardId);
      if (!card) {
        // Card deleted since the review, nothing to restore, and deletion
        // never reverses stat contributions elsewhere either. Discard and
        // fall through to the next entry. The permanent reviewHistory row
        // (if any) deliberately survives: the review happened, and its stat
        // contributions are kept on this path too.
        await ctx.db.delete(log._id);
        continue;
      }

      // The permanent history row this undo would revoke (only 'review'
      // entries carry one). Resolved up front so both track branches can fold
      // the per-card time-average reversal into their single patchCard call;
      // the row itself is deleted after the branch actually undoes the review
      // (the malformed-entry discards below leave it standing).
      const history =
        log.kind === 'review' && log.historyId
          ? await ctx.db.get(log.historyId)
          : null;
      const timeUndoPatch = history ? reviewTimeUndoPatch(card, history) : {};

      if (
        log.kind === 'review' &&
        (log.track ?? 'shared') === 'writing' &&
        log.prevWriting
      ) {
        // Writing-track review: restore only the writing fields. Explicit
        // per-field patch so snapshot values that were `undefined` (the
        // lazy-seed case, where the track didn't exist yet) unset the fields
        // again, returning the card to its unseeded state, and dropping it
        // from the writing aggregates via patchCard.
        await patchCard(
          ctx,
          log.cardId,
          {
            writingDueDate: log.prevWriting.writingDueDate,
            writingFsrsState: log.prevWriting.writingFsrsState,
            writingIsGraduated: log.prevWriting.writingIsGraduated,
            writingLastReviewedAt: log.prevWriting.writingLastReviewedAt,
            writingGoodReviewCount: log.prevWriting.writingGoodReviewCount,
            ...reviewCountUndoPatch(card, log),
            ...timeUndoPatch,
          },
          card,
        );
        await reverseReviewStats(ctx, { userId, courseId: course._id, log });
      } else if (
        log.kind === 'review' &&
        (log.track ?? 'shared') === 'shared' &&
        log.prevCard
      ) {
        // `undefined` snapshot values (e.g. fsrsState before the card entered
        // FSRS) correctly unset the field again via patchCard → ctx.db.patch.
        await patchCard(
          ctx,
          log.cardId,
          {
            dueDate: log.prevCard.dueDate,
            schedulingPhase: log.prevCard.schedulingPhase,
            preReviewCount: log.prevCard.preReviewCount,
            fsrsState: log.prevCard.fsrsState,
            isGraduated: log.prevCard.isGraduated,
            lastReviewedAt: log.prevCard.lastReviewedAt,
            goodReviewCount: log.prevCard.goodReviewCount,
            ...reviewCountUndoPatch(card, log),
            ...timeUndoPatch,
          },
          card,
        );
        await reverseReviewStats(ctx, { userId, courseId: course._id, log });
      } else if (log.kind === 'radio' || log.kind === 'freeStudy') {
        const patch = FREE_PLAY_MODES[log.kind].undoPatch(log);
        if (!patch) {
          // Malformed entry (kind without its snapshot), discard defensively.
          await ctx.db.delete(log._id);
          continue;
        }
        await patchCard(ctx, log.cardId, patch, card);
        await reverseFreePlayStats(ctx, {
          userId,
          courseId: course._id,
          log,
          mode: log.kind,
        });
      } else {
        // Malformed entry (kind without its snapshot), discard defensively.
        await ctx.db.delete(log._id);
        continue;
      }

      // Revoke the permanent history row for the undone review. Free-play
      // entries never carry one, and the malformed-entry discards above
      // `continue` before reaching here, so a standing history row always
      // reflects a review that actually counts.
      if (history) {
        await ctx.db.delete(history._id);
      }

      // Consume the entry so it can't be undone twice.
      await ctx.db.delete(log._id);

      const counters = await readTodayCounters(ctx, {
        userId,
        courseId: course._id,
        timezone: args.timezone,
        targetLanguages: course.targetLanguages,
      });
      return { status: 'undone' as const, cardId: log.cardId, ...counters };
    }

    return { status: 'nothing_to_undo' as const };
  },
});

/**
 * How many reviews the undo mechanism can currently take back
 * (0..UNDO_DEPTH): the newest-first run of review-log entries matching the
 * current study context.
 *
 * The learn view no longer subscribes to this. It reads the bundled
 * `undoableCount` field on `getCardForReview` (one invalidation per review
 * instead of two). Kept as a standalone query for tests, which need to
 * assert the count in states where `getCardForReview` returns null.
 */
export const getUndoableReviewCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return 0;

    const settings = await getCourseSettings(ctx, active.course._id);
    const undoable = await takeUndoableLogs(
      ctx,
      userId,
      active.course._id,
      studyContextFromSettings(settings),
    );
    return undoable.length;
  },
});

/**
 * Master a card. Marks `isMastered: true` so it no longer appears for review.
 */
export const masterCard = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, card } = await authorizeCardAccess(ctx, args.cardId);
    await patchCard(ctx, args.cardId, { isMastered: true }, card);
    await trackCardAction(ctx, userId, 'master', card);
    return null;
  },
});

/**
 * Hide a card. Marks `isHidden: true` so it no longer appears for review.
 */
export const hideCard = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, card } = await authorizeCardAccess(ctx, args.cardId);
    await patchCard(ctx, args.cardId, { isHidden: true }, card);
    await trackCardAction(ctx, userId, 'hide', card);
    return null;
  },
});

/**
 * Delete a text's translations + audio (rows AND storage blobs) and the text
 * row itself, but ONLY when the text is user-created AND no card references it
 * any more. Shared premade/dataset texts (and texts still referenced by another
 * card) are left untouched. Call after deleting/replacing a card so a custom or
 * chat sentence the user removed doesn't leave orphaned translations/audio/blobs.
 *
 * Bounded: a single text has at most a course's worth of languages, so the
 * per-text `.collect()`s read a small, bounded set. Audio goes through
 * `deleteAudioRow` so a blob shared via an `editCard` copy isn't dropped.
 *
 * Invariant relied on: a user-created text is never referenced by another user's
 * card. Every userCreated text is stamped with the acting user's `userId` and
 * lives in that user's own per-course collection, and `authorizeCardAccess`
 * enforces course ownership, so the `userCreated` guard below is sufficient and
 * no `text.userId === userId` check is needed. If cross-user sharing of
 * user-created texts is ever introduced, add an owner check here.
 */
async function cascadeCleanupTextIfOrphaned(
  ctx: MutationCtx,
  textId: Id<'texts'>,
): Promise<void> {
  const text = await ctx.db.get(textId);
  // Never delete shared premade/dataset content.
  if (!text || !text.userCreated) return;
  // Still referenced by another card → leave everything in place.
  const referencingCard = await ctx.db
    .query('cards')
    .withIndex('by_textId', (q) => q.eq('textId', textId))
    .first();
  if (referencingCard) return;

  const translations = await ctx.db
    .query('translations')
    .withIndex('by_textId', (q) => q.eq('textId', textId))
    .collect();
  for (const tr of translations) {
    await ctx.db.delete(tr._id);
  }
  const audioRows = await ctx.db
    .query('audioRecordings')
    .withIndex('by_textId', (q) => q.eq('textId', textId))
    .collect();
  for (const audio of audioRows) {
    await deleteAudioRow(ctx, audio);
  }
  await ctx.db.delete(textId);
}

/**
 * Permanently delete a card. Unlike `hideCard`, this removes the card row
 * entirely (and its aggregate entries). For user-created (custom/chat) texts
 * that no other card references, the text + its translations + audio (and
 * storage blobs) are cascade-deleted; shared premade/dataset rows stay.
 */
export const deleteCardPermanently = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, card } = await authorizeCardAccess(ctx, args.cardId);
    const textId = card.textId;
    // Tracked before the delete, while `card` is still readable, and the event is
    // rolled back with the mutation if the cascade throws.
    await trackCardAction(ctx, userId, 'delete', card);
    await deleteCard(ctx, args.cardId);
    await cascadeCleanupTextIfOrphaned(ctx, textId);
    return null;
  },
});

export const unmasterCard = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { card } = await authorizeCardAccess(ctx, args.cardId);
    await patchCard(ctx, args.cardId, { isMastered: false }, card);
    return null;
  },
});

export const unhideCard = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { card } = await authorizeCardAccess(ctx, args.cardId);
    await patchCard(ctx, args.cardId, { isHidden: false }, card);
    return null;
  },
});

/**
 * Advance to the next card in free play, in whichever face the user's review
 * mode puts them (Shadowing → radio rotation, Writing → free-study rotation).
 *
 * The face is resolved from course settings rather than passed in, so the
 * rotation advanced here is always the one the client is being served from.
 * There is no argument the client could get out of sync with.
 *
 * Bumps the card's round counter so the next-lowest counter rises to the
 * front, re-rolls the order key so the round-robin shuffles every loop (and
 * stays decoupled from the review/dueDate order), and records playtime in
 * the per-face stats.
 *
 * Catch-up rule: a brand-new card (counter 0) joining a deck whose other
 * cards are all at e.g. 100 should not replay 99 more times. After playing,
 * its counter jumps to `max(picked, floorOfOthers) + 1` so it lands one
 * step past the rest of the deck. Strictly above every other playable
 * card. This guarantees the just-played card is never re-picked as the
 * next card while any other playable card exists (the random order-key
 * tiebreak only kicks in at equal counters, which can no longer include
 * the played card).
 *
 * Stats: writes the face's `dailyStats.reviewsByMode` + `timeMsByMode`
 * buckets and the equivalent rollups, plus `courseStats.totalReviewsByMode`
 * and the streak. Word tracking, FSRS state, accuracy, ratings, and
 * collection progress are explicitly skipped. Free play never touches the
 * spaced-repetition schedule.
 */
async function advanceFreePlayCardImpl(
  ctx: MutationCtx,
  args: { cardId: Id<'cards'>; timezone: string; timeSpentMs?: number },
): Promise<{ nextRoundCounter: number }> {
  const { userId, card, deck } = await authorizeCardAccess(ctx, args.cardId);

  // Settings first: they decide WHICH rotation this advance touches, so they
  // have to be read before the queue fetch and the patch.
  const settings = await getCourseSettings(ctx, deck.courseId);
  const face = freePlayFace(
    settings?.schedulingMode ?? 'learnAndReview',
    settings?.reviewMode ?? 'audio',
  );
  if (!face) {
    // The client only calls this from a free-play session; landing here means
    // the mode changed underneath it, so there is no rotation to advance.
    throw new ConvexError({
      code: 'INVALID_STATE',
      message: 'Not in free play',
    });
  }
  const cfg = FREE_PLAY_MODES[face];

  // Fetch the two lowest-counter playable cards, from the same
  // origin-filtered rotation the card was served from, or the floor could
  // come from a card the active content filter never serves (stuck at a far
  // lower counter), neutering the catch-up jump below. The first should be
  // the card we just played; the second tells us the floor that the played
  // card needs to catch up to.
  const lowestTwo = await fetchFreePlayRotation(
    ctx,
    deck._id,
    face,
    settings?.studyContentFilter ?? 'both',
    2,
  );

  const pickedCounter = card[cfg.counterField] ?? 0;
  // Identify the floor card. The second-lowest, excluding `card` itself.
  // If the just-played card is no longer the lowest (e.g. it was favorited
  // or another tab advanced concurrently), `lowestTwo[0]` may differ from
  // `card`; in that case the floor is whichever of the two is not `card`.
  const floorCard = lowestTwo.find((c) => c._id !== card._id) ?? null;
  const floorCounter = floorCard
    ? (floorCard[cfg.counterField] ?? 0)
    : pickedCounter;
  // Land strictly above the floor so the played card cannot tie with the
  // rest of the round; combined with ascending counter ordering this rules
  // out an immediate repeat as long as ≥1 other playable card exists.
  const newCounter = Math.max(pickedCounter, floorCounter) + 1;

  // Separate from the round counter (a rotation position subject to the
  // catch-up jump above): a true +1-per-play count. The seed for cards that
  // predate the field is face-specific. See `playCountSeed` in
  // convex/lib/freePlay.ts.
  const newPlayCount =
    (card[cfg.playCountField] ?? cfg.playCountSeed(card)) + 1;

  const patch: Partial<Doc<'cards'>> = { lastReviewedAt: Date.now() };
  patch[cfg.counterField] = newCounter;
  patch[cfg.playCountField] = newPlayCount;
  // Re-roll the random tiebreak each play so the order changes between
  // loops and never aligns with the review (`dueDate`-driven) order.
  patch[cfg.orderField] = randomOrderKey();
  await patchCard(ctx, args.cardId, patch, card);

  await recordFreePlayStats(ctx, {
    userId,
    courseId: deck.courseId,
    timezone: args.timezone,
    timeSpentMs: args.timeSpentMs,
    mode: face,
  });

  // Log the play for the learn-mode undo stack. Restoring the pre-play
  // rotation state puts this card back at the front (advancing only ever
  // raises counters, so nothing can have slotted in below it since).
  // `kind` carries the face. That is what scopes the undo stack to the
  // rotation the user is actually looking at (see takeUndoableLogs).
  await logReview(ctx, {
    userId,
    courseId: deck.courseId,
    cardId: args.cardId,
    reviewedAt: Date.now(),
    timezone: args.timezone,
    kind: face,
    date: getTodayInTimezone(args.timezone),
    schedulingMode: 'radio',
    studyContentFilter: settings?.studyContentFilter ?? 'both',
    ...cfg.logSnapshot(card),
  });

  return { nextRoundCounter: newCounter };
}

export const advanceFreePlayCard = mutation({
  args: {
    cardId: v.id('cards'),
    timezone: v.string(),
    timeSpentMs: v.optional(v.number()),
  },
  returns: v.object({
    nextRoundCounter: v.number(),
  }),
  handler: async (ctx, args) => advanceFreePlayCardImpl(ctx, args),
});

/**
 * Whether the user's active deck has at least one playable card
 * (non-hidden, non-mastered). Used by the home screen to gate the free-play
 * button (Radio / Free Study), free play is meaningless on an empty deck.
 *
 * Uses the narrowest index that answers the question (free play doesn't care
 * about due-ness): the plain hidden/mastered index for 'both', the
 * origin-keyed one when a content filter is active. `.first()` keeps the read
 * set to a single document either way, so the subscription doesn't refire on
 * unrelated rotation-counter writes.
 */
export const hasPlayableCards = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return false;

    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return false;

    // Same content-filter scoping as the free-play queue itself, or the
    // button lights up for cards the filter will never serve (e.g. filter
    // "My content" with only premade cards) and the user taps into an
    // instant empty state.
    const settings = await getCourseSettings(ctx, active.course._id);
    const filter = settings?.studyContentFilter ?? 'both';
    if (filter === 'both') {
      const first = await ctx.db
        .query('cards')
        .withIndex('by_deckId_and_isHidden_and_isMastered', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false),
        )
        .first();
      return first !== null;
    }
    const allowedOrigins = originsForFilter(filter);
    for (const origin of allowedOrigins) {
      const first = await ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_origin_dueDate', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('collectionOrigin', origin),
        )
        .first();
      if (first !== null) return true;
    }
    return false;
  },
});

/**
 * Set or clear a per-card, per-language playback-speed override.
 *
 * `speed === null` removes the override for that language so playback falls
 * back to the course-level general speed. Valid override values are bounded
 * by `CARD_OVERRIDE_SPEED_MIN`–`CARD_OVERRIDE_SPEED_MAX` (the fixed cycle
 * exposed by the card-speed indicator).
 */
export const setCardAudioSpeedOverride = mutation({
  args: {
    cardId: v.id('cards'),
    language: v.string(),
    speed: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { card } = await authorizeCardAccess(ctx, args.cardId);
    if (args.speed !== null) {
      if (
        !Number.isFinite(args.speed) ||
        args.speed < CARD_OVERRIDE_SPEED_MIN ||
        args.speed > CARD_OVERRIDE_SPEED_MAX
      ) {
        throw new ConvexError({
          code: 'INVALID_ARGUMENT',
          message: `audioSpeedOverride must be between ${CARD_OVERRIDE_SPEED_MIN} and ${CARD_OVERRIDE_SPEED_MAX}`,
        });
      }
    }
    const current = card.audioSpeedOverrides ?? {};
    const next: Record<string, number> = { ...current };
    if (args.speed === null) {
      delete next[args.language];
    } else {
      next[args.language] = args.speed;
    }
    await patchCard(ctx, args.cardId, { audioSpeedOverrides: next }, card);
    return null;
  },
});

/**
 * Toggle a card's favorite state. Flips `isFavorite` between true and false.
 */
export const toggleFavoriteCard = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, card } = await authorizeCardAccess(ctx, args.cardId);
    const nextFavorite = !(card.isFavorite ?? false);
    await patchCard(ctx, args.cardId, { isFavorite: nextFavorite }, card);
    await trackCardAction(
      ctx,
      userId,
      nextFavorite ? 'favorite' : 'unfavorite',
      card,
    );
    return null;
  },
});

/**
 * Claim the (text, language) translation slot and enqueue a `retranslation_high`
 * job for it. The single unit of work shared by the two gestures that can
 * trigger an automatic retranslation: the explicit Flag button below, and a
 * manual card edit of a curriculum translation
 * (`suggestCurriculumFixesForEdit`).
 *
 * Returns true iff this call acquired the claim and enqueued. False means
 * something else is already retranslating this (text, language) and this
 * caller's request, including any suggestion it carried, is dropped. Callers
 * that bill quota should do so only on a true return.
 *
 * Audio is deliberately NOT deleted here: before the LLM lands we can't know
 * whether the retranslation is audibly different. That decision lives in
 * `storeTranslationAndScheduleTTS`'s replaceExisting branch, which has old +
 * new text in hand. It keeps the audio when the change is punctuation-only
 * (`soundsSame`) and deletes + re-enqueues TTS otherwise.
 */
async function enqueueFlagRetranslation(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  targetLanguage: string,
  opts: {
    /** Why this retranslation was asked for. Threaded to the worker, which
     * branches on it for the "the user says this is wrong" prompt block. */
    reason: 'flag' | 'curriculum_fix';
    /** The prebuilt audit bundle (retranslationAuditFields) for this
     * (gesture, language). The child row is written HERE because this is
     * the only place that can tell an enqueue from a lost claim. */
    audit: RetranslationAuditFields;
    userSuggestedTranslation?: string;
    /** Runs after the claim is acquired and before the job is enqueued.
     * `flagTranslation` bills its one quota unit here so a depleted user
     * throws before any pool work is created, rather than relying on the
     * surrounding transaction to unwind an enqueue that already happened. */
    onClaimed?: () => Promise<void>;
  },
): Promise<boolean> {
  const RULE = 'retranslation_high';
  const auditFields = { ...opts.audit, rule: RULE };

  const claimId = await claimLlmTranslationIfAvailable(
    ctx,
    text._id,
    targetLanguage,
  );
  if (!claimId) {
    // Something else owns this (text, language). This request — and any
    // suggestion it carried — is dropped, which is exactly the outcome a
    // reviewer wondering "why didn't my edit change anything?" needs to see.
    await recordRetranslationAttempt(ctx, {
      ...auditFields,
      status: 'skipped_claim_contested',
    });
    return false;
  }

  await opts.onClaimed?.();

  const retranslationAuditId = await recordRetranslationAttempt(ctx, {
    ...auditFields,
    status: 'enqueued',
  });

  await ctx.runMutation(
    internal.features.llmTranslationQueue.enqueueLlmTranslation,
    {
      args: {
        textId: text._id,
        sourceLanguage: text.language,
        targetLanguage,
        text: text.text,
        audioSpeakerGender: text.audioSpeakerGender,
        // The flagging/editing user deliberately asked for this retranslation.
        requestedByUserId: opts.audit.userId,
        ruleOverride: RULE,
        translationReason: opts.reason,
        retranslationAuditId,
        // Deliberate retranslation. Overwrite the existing translation
        // row (and its romanization) once the LLM lands.
        replaceExisting: true,
        ...(opts.userSuggestedTranslation
          ? { userSuggestedTranslation: opts.userSuggestedTranslation }
          : {}),
      },
    },
  );
  return true;
}

/**
 * Shared tail of the two flag paths (`flagTranslation`, the curriculum-fix
 * suggestions): build the audit bundle once, record `skipped_capped` when
 * the post-increment count is over the auto-retranslation cap (counter rose
 * but no work was created — logged so the QC view can tell "we declined to
 * spend on this" from "nothing happened"), otherwise enqueue the
 * retranslation carrying those same fields. Returns whether a job was
 * actually enqueued (false for the cap skip and for a lost claim).
 */
async function retranslateOrRecordCapSkip(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  language: string,
  opts: {
    reason: 'flag' | 'curriculum_fix';
    cardEditId: Id<'cardEdits'>;
    userId: string;
    role: CardEditLanguageRole;
    beforeText: string;
    beforeTranslationSource?: string;
    userSuggestion?: string;
    flagCountAfter: number;
    onClaimed?: () => Promise<void>;
  },
): Promise<boolean> {
  const audit = retranslationAuditFields({
    cardEditId: opts.cardEditId,
    userId: opts.userId,
    language,
    role: opts.role,
    text,
    beforeText: opts.beforeText,
    beforeTranslationSource: opts.beforeTranslationSource,
    userSuggestion: opts.userSuggestion,
    flagCountAfter: opts.flagCountAfter,
  });
  if (opts.flagCountAfter > FLAG_AUTO_RETRANSLATION_MAX) {
    await recordRetranslationAttempt(ctx, {
      ...audit,
      status: 'skipped_capped',
    });
    return false;
  }
  return enqueueFlagRetranslation(ctx, text, language, {
    reason: opts.reason,
    audit,
    userSuggestedTranslation: opts.userSuggestion,
    onClaimed: opts.onClaimed,
  });
}

/**
 * A manual edit of a curriculum card is also a complaint about the curriculum.
 * Path B of `applyCardEdit` forks the shared text so the editor keeps their
 * wording, which leaves the shared row every OTHER learner studies exactly as
 * wrong as it was. This closes that loop: each changed target language flags
 * the original shared `translations` row and, within the flag cap, enqueues a
 * retranslation carrying the user's wording as a suggestion the prompt tells
 * the model to distrust.
 *
 * Called only from Path B (shared text) and only for manual edits. The chat
 * "also correct" replace is excluded at the call site: accepting an
 * alternative phrasing from the tutor is not a claim that the curriculum
 * translation is wrong, and burning the row's capped retranslations on it
 * would be wrong. Edits that also change the source line are excluded too,
 * since the user's target text then translates THEIR source, not the
 * curriculum's.
 *
 * No quota: `applyCardEdit` already consumed a CARD_EDITS unit in this same
 * mutation, and the shared `flagCount` cap bounds provider spend per row
 * across every user and both trigger paths. Not calling `consumeQuota` also
 * means no new USAGE_LIMIT throw can roll back an otherwise-valid edit.
 *
 * Returns the languages that were flagged, for the caller's analytics event.
 */
async function suggestCurriculumFixesForEdit(
  ctx: MutationCtx,
  originalText: Doc<'texts'>,
  changedLanguages: Set<string>,
  submittedMap: Map<string, string>,
  servedTranslationMap: Map<string, ServedTranslation>,
  audit: {
    cardEditId: Id<'cardEdits'>;
    userId: string;
    course: Doc<'courses'>;
  },
): Promise<string[]> {
  const flagged: string[] = [];

  for (const lang of changedLanguages) {
    if (lang === originalText.language) continue;

    const served = servedTranslationMap.get(lang);
    // No shared row for this language: the curriculum never had a translation
    // here, so there is nothing to correct and nothing to count.
    if (!served) continue;
    // A pinned card shows a superseded wording. The learner corrected THAT,
    // not the live row they never saw, so the live row gets no complaint
    // and no retranslation (same rule as `flagTranslation`).
    if (served.archived) continue;
    const existing = served.live;

    // Hand-curated and user-provided rows are never second-guessed by the
    // pipeline. Skip them whole, counter included: a flag we will never act on
    // reads as unresolved triage rather than a deliberate exemption.
    if (!mayRegenerateTranslation(originalText, existing)) continue;

    // Post-increment cap, matching `flagTranslation`. The counter always rises
    // (over-cap flags are the admin-triage signal); only the enqueue is gated.
    const nextCount = (existing.flagCount ?? 0) + 1;
    await ctx.db.patch(existing._id, { flagCount: nextCount });
    flagged.push(lang);

    await retranslateOrRecordCapSkip(ctx, originalText, lang, {
      reason: 'curriculum_fix',
      cardEditId: audit.cardEditId,
      userId: audit.userId,
      role: languageRole(audit.course, lang),
      beforeText: existing.translatedText,
      beforeTranslationSource: existing.translationSource,
      userSuggestion: submittedMap.get(lang),
      flagCountAfter: nextCount,
    });
  }

  return flagged;
}

/**
 * Flag a card as having bad translation content. The user sees a single
 * "Flag" affordance on the card; we then increment `flagCount` on every
 * non-source-language `translations` row for that card's text, and enqueue
 * a retranslation for each one whose post-increment count is within
 * `FLAG_AUTO_RETRANSLATION_MAX` AND whose language is part of the user's
 * course. Counts past the cap still increment the counter (for later
 * admin triage) but skip the retranslation work to bound cost.
 *
 * Routing per text: curriculum (premade-dataset) texts use
 * `retranslation_high` (Pro-medium). User-created custom texts are
 * **flagged without retranslation**. The LLM has no curated source of
 * truth to second-guess against, so flagging a custom-text translation
 * only bumps `flagCount` (for admin triage / surfacing the "Flagged" pill)
 * and exits without enqueueing an LLM call. The rule applies to the whole
 * card because `text.userCreated` is a property of the text, not the
 * translation.
 *
 * Quota: one `translation_flags` unit total per flag click, regardless of
 * how many languages were retranslated. Charged on the first language
 * that successfully claims a slot; not charged at all if every language
 * was over-cap or claim-contested. If `consumeQuota` throws USAGE_LIMIT,
 * the whole mutation rolls back. Counters and any prior claim/audio
 * deletion are reverted.
 *
 * Pinned cards: a card created before a version bump keeps showing the
 * superseded wording (see `supersededAt` in schema.ts). Flagging such a
 * card disputes wording the curriculum has already moved past, so the card
 * is moved to the latest revision (`translationsAcceptedAt = now`) instead of
 * counting a complaint against the live row; only languages whose live row
 * IS what the learner saw continue into the retranslation path. The result
 * carries `updatedToLatest` so the client can say so instead of showing the
 * "Flagged" pill.
 */
export const flagTranslation = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.object({
    retranslated: v.boolean(),
    updatedToLatest: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const { userId, card, course } = await authorizeCardAccess(
      ctx,
      args.cardId,
    );

    const text = await ctx.db.get(card.textId);
    if (!text)
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Text not found' });

    // Languages we need translations for: every base + target language in
    // the user's course except the source. Dedupe in case a language is
    // both base and target (unusual but possible). Fetching this exact
    // set via the `by_text_and_language` index lets us skip orphan
    // translation rows that may exist for languages the user has since
    // removed from their course. We shouldn't bump flagCount on those.
    const cardLanguages = Array.from(
      new Set([...course.baseLanguages, ...course.targetLanguages]),
    ).filter((lang) => lang !== text.language);

    if (cardLanguages.length === 0) {
      return { retranslated: false };
    }

    // Parallel indexed reads. One per language, each O(1) via the
    // composite index. Faster than a single `by_textId` collect + JS
    // filter when only a subset of the text's translations matter.
    const fetched = await Promise.all(
      cardLanguages.map((lang) => liveTranslation(ctx, card.textId, lang)),
    );

    // Drop languages with no translation row (the card simply doesn't
    // have a translation in that language yet, nothing to flag).
    const liveRows = fetched.filter(
      (tr): tr is NonNullable<typeof tr> => tr !== null,
    );

    if (liveRows.length === 0) {
      return { retranslated: false };
    }

    // What the learner's card actually shows per language. A served row that
    // is archived means the curriculum already revised this wording after
    // the card was pinned: the fix for that learner is the latest wording,
    // not another retranslation.
    const pinAt = cardPinAt(card);
    const served = await Promise.all(
      liveRows.map((tr) => resolveServedFromLive(ctx, tr, pinAt)),
    );
    const moved = served.filter((s) => s.archived);
    const updatedToLatest = moved.length > 0;
    if (updatedToLatest) {
      const now = Date.now();
      const courseLanguages = [
        ...course.baseLanguages,
        ...course.targetLanguages,
      ];
      const search = await buildCardSearchableText(
        ctx,
        card.textId,
        text.text,
        courseLanguages,
        text,
        now,
      );
      // Raw patch: no card aggregate keys on the pin or the search fields.
      await ctx.db.patch(card._id, {
        translationsAcceptedAt: now,
        ...search,
      });
      await recordCardEdit(ctx, {
        userId,
        course,
        kind: 'accept_latest',
        path: 'none',
        cardIdBefore: card._id,
        cardIdAfter: card._id,
        textIdBefore: card.textId,
        textIdAfter: card.textId,
        collectionOrigin: card.collectionOrigin,
        textWasUserCreated: text.userCreated,
        sourceLanguage: text.language,
        sourceText: text.text,
        changes: moved.map((s) => ({
          language: s.live.targetLanguage,
          role: languageRole(course, s.live.targetLanguage),
          isSourceLanguage: false,
          before: s.row.translatedText,
          after: s.live.translatedText,
          beforeTranslationSource: s.row.translationSource,
          beforeFlagCount: s.live.flagCount,
        })),
      });
    }
    // Only the languages whose live row is what the learner disputed carry
    // on as a complaint about the curriculum.
    const nonSourceTranslations = served
      .filter((s) => !s.archived)
      .map((s) => s.live);

    if (nonSourceTranslations.length === 0) {
      await trackCardAction(ctx, userId, 'flag_translation', card, {
        retranslated: false,
        updated_to_latest: true,
        target_languages: course.targetLanguages,
      });
      return { retranslated: false, updatedToLatest };
    }

    // 1) Compute the post-patch count once per row and persist it. Doing the
    // increment up front means a quota failure later in this mutation
    // cleanly rolls back every counter via the surrounding transaction.
    const withCounts = nonSourceTranslations.map((tr) => ({
      tr,
      nextCount: (tr.flagCount ?? 0) + 1,
    }));
    for (const { tr, nextCount } of withCounts) {
      await ctx.db.patch(tr._id, { flagCount: nextCount });
    }

    // Audit row for the gesture itself, written now that we know which
    // languages it actually touched. Deliberately before the two policy
    // short-circuits below: a flag that deliberately produces no retranslation
    // is exactly the case QC needs to see, and `textWasUserCreated` on this row
    // is what explains the user-created one.
    const cardEditId = await recordCardEdit(ctx, {
      userId,
      course,
      kind: 'flag',
      path: 'none',
      cardIdBefore: args.cardId,
      cardIdAfter: args.cardId,
      textIdBefore: card.textId,
      textIdAfter: card.textId,
      collectionOrigin: card.collectionOrigin,
      textWasUserCreated: text.userCreated,
      sourceLanguage: text.language,
      sourceText: text.text,
      // No `after`/`soundsSame`: a flag disputes the wording without proposing
      // a replacement, so there is nothing to diff.
      changes: withCounts.map(({ tr, nextCount }) => ({
        language: tr.targetLanguage,
        role: languageRole(course, tr.targetLanguage),
        isSourceLanguage: false,
        before: tr.translatedText,
        beforeTranslationSource: tr.translationSource,
        beforeFlagCount: nextCount - 1,
      })),
    });

    // Custom-text flag policy: increment counters but never auto-retranslate.
    // Custom texts have no curated source of truth. The LLM would only be
    // second-guessing the user's own content. Flagging surfaces them in the
    // "Flagged" UI pill for the user and admin triage; that's the full
    // workflow. No quota charge, no audio invalidation, no enqueue.
    if (isUserCreatedText(text)) {
      return { retranslated: false, updatedToLatest };
    }

    // 2) Per-language: over-cap rows record their skip (counter already rose
    // above); under-cap rows claim a slot and enqueue, charging quota on the
    // first success only. Claim-contested rows skip silently (something else
    // is already retranslating them). The rule is always `retranslation_high`
    // here; user-created texts short-circuited above. All rows are guaranteed
    // in-course because we fetched from the course's language set.
    let anyEnqueued = false;
    let quotaCharged = false;

    for (const { tr, nextCount } of withCounts) {
      const enqueued = await retranslateOrRecordCapSkip(
        ctx,
        text,
        tr.targetLanguage,
        {
          reason: 'flag',
          cardEditId,
          userId,
          role: languageRole(course, tr.targetLanguage),
          beforeText: tr.translatedText,
          beforeTranslationSource: tr.translationSource,
          flagCountAfter: nextCount,
          // Charge once total, on the first successful claim. If the user is
          // depleted this throws USAGE_LIMIT from inside the helper, before
          // that language's job is enqueued, and the whole mutation rolls
          // back (counters, claim rows, any earlier enqueue).
          onClaimed: async () => {
            if (quotaCharged) return;
            await consumeQuota(ctx, userId, FEATURE_IDS.TRANSLATION_FLAGS);
            quotaCharged = true;
          },
        },
      );
      if (enqueued) anyEnqueued = true;
    }

    if (
      withCounts.every(
        ({ nextCount }) => nextCount > FLAG_AUTO_RETRANSLATION_MAX,
      )
    ) {
      // Everything was over-cap. Counters incremented and skips recorded,
      // no quota charge, no retranslations, no analytics event (unchanged
      // from before the loop merge).
      return { retranslated: false, updatedToLatest };
    }

    // Flag volume per language is the clearest quality signal the app has for
    // the translation pipeline.
    await trackCardAction(ctx, userId, 'flag_translation', card, {
      retranslated: anyEnqueued,
      updated_to_latest: updatedToLatest,
      target_languages: course.targetLanguages,
    });

    return { retranslated: anyEnqueued, updatedToLatest };
  },
});

/**
 * Regenerate audio for every language on the card. Consumes one
 * `audio_regenerations` quota unit per call regardless of language count.
 * Deletes all `audioRecordings` rows for the card's text and re-invokes
 * `scheduleMissingContent`, which only schedules audio jobs for languages
 * that already have translations (no re-translation here).
 */
export const regenerateCardAudio = mutation({
  args: {
    cardId: v.id('cards'),
    timezone: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, card, course } = await authorizeCardAccess(
      ctx,
      args.cardId,
    );

    const text = await ctx.db.get(card.textId);
    if (!text)
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Text not found' });

    await consumeQuota(ctx, userId, FEATURE_IDS.AUDIO_REGENERATIONS);
    await trackEvent(ctx, {
      userId,
      courseId: course._id,
      timezone: args.timezone,
      field: 'cardsEdited',
    });

    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];
    // A pinned card plays the asset of a superseded revision, not the live
    // pointer's audio (see `supersededAt` in schema.ts). Regenerating the
    // live audio would spend the quota unit on a clip this card never plays,
    // so those languages re-synthesize their archived asset in place instead
    // and keep the live pointer as it is.
    const pinAt = cardPinAt(card);
    const archivedLanguages = new Set<string>();
    for (const lang of allLanguages) {
      if (lang === text.language) continue;
      const live = await liveTranslation(ctx, card.textId, lang);
      if (!live) continue;
      const served = await resolveServedFromLive(ctx, live, pinAt);
      if (served.archived) {
        archivedLanguages.add(lang);
        await regenerateSupersededRevisionAudio(ctx, text, served.row, {
          audioSpeakerGender: text.audioSpeakerGender,
          // The button means "synthesize anew": bypass the asset cache (a
          // hit would hand back the very asset being replaced).
          forceRegen: true,
          requestedByUserId: userId,
        });
      }
    }
    // The live pointers of the archived languages stay, so the sweep below
    // sees their audio as present and regenerates nothing for them.
    for (const lang of allLanguages) {
      if (archivedLanguages.has(lang)) continue;
      await deleteAudioRowsForTextLanguage(ctx, card.textId, lang);
    }

    // forceAudioRegen: bypass the audioAssets cache (a hit would hand back
    // exactly the audio the user just asked to replace) and synthesize anew.
    // The completed job patches the shared asset in place, so every other
    // text with the same sentence also gets the new audio on next load.
    await scheduleMissingContent(
      ctx,
      card.textId,
      text,
      course.baseLanguages,
      course.targetLanguages,
      { forceAudioRegen: true, requestedByUserId: userId },
    );

    await trackCardAction(ctx, userId, 'regenerate_audio', card);

    return null;
  },
});

/**
 * Core of `editCard`, shared with the chat "also correct" replace path
 * (convex/features/chat/cardApprovals.ts).
 *
 * Creates a replacement card with identical scheduling stats but updated text.
 * Two paths:
 *   A) User-owned text: patches rows in place, reuses textId.
 *   B) Shared/dataset text: creates new textId, copies unchanged content.
 *
 * Options beyond the editCard args:
 *   - ensureUserOwnedText: run Path B even when no text changed, so the
 *     returned textId is always user-owned. The also-correct replace path
 *     patches metadata (speaker gender, register, …) onto the row afterwards,
 *     which must never hit a shared/dataset text other users reference.
 *   - skipQuota: caller owns CARD_EDITS billing (bills once itself).
 *   - suggestCurriculumFix: on Path B, also flag the shared rows this edit
 *     disagrees with and suggest the user's wording to the retranslation.
 *     Manual edits only.
 *
 * Returns the resolved textId and whether anything was written; a no-op diff
 * without ensureUserOwnedText returns `changed: false` and consumes nothing.
 */
export async function applyCardEdit(
  ctx: MutationCtx,
  args: {
    cardId: Id<'cards'>;
    translations: { language: string; text: string }[];
    timezone: string;
    ensureUserOwnedText?: boolean;
    skipQuota?: boolean;
    /** Definitive speaker gender proposed alongside the edit (the chat
     * "also correct" replace). Applied to the text row BEFORE this edit's
     * `scheduleMissingContent` pass: the TTS enqueue resolves its voice from
     * the row and takes a per-(text, language) claim, so a gender patched
     * only afterwards (applyTextMetadata) would come too late. The claim
     * blocks the follow-up pass and the wrong-gender synthesis wins. */
    proposedAudioSpeakerGender?: 'male' | 'female';
    /** Treat this edit as a complaint about the curriculum as well as a
     * private fix. On Path B only, flag the ORIGINAL shared translation rows
     * for the changed languages and hand the user's wording to the
     * retranslation as a suggestion. See `suggestCurriculumFixesForEdit`.
     *
     * Off by default so a caller has to opt in deliberately. Only `editCard`
     * (the manual edit dialog) does; the chat "also correct" replace must
     * not, since an alternative phrasing the tutor offered is not a claim
     * that the curriculum translation is wrong. */
    suggestCurriculumFix?: boolean;
    /** Which gesture this edit is, for the `cardEdits` audit row. Required:
     * the two callers are the whole point of the discriminator, so a new one
     * should have to state which it is rather than inherit a default. */
    auditKind: 'manual_edit' | 'chat_also_correct';
  },
): Promise<{
  textId: Id<'texts'>;
  /** The edited card. ALWAYS the id passed in: Path B forks the text row
   * and patches `textId` in place, never replacing the card document —
   * pending approvals and per-card counters keep pointing at a live row
   * (the reason cardApprovals dropped its sibling-retargeting sweep). */
  cardId: Id<'cards'>;
  changed: boolean;
  /** The card's course, from the one authorizeCardAccess walk this edit
   * already performs. Returned so callers needing course languages (the
   * also-correct replace) don't repeat the card → deck → course reads. */
  course: Doc<'courses'>;
}> {
  const { userId, card, course } = await authorizeCardAccess(ctx, args.cardId);

  const text = await ctx.db.get(card.textId);
  if (!text)
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Text not found' });

  // Diff plan: which languages changed (audibly or not), which path the
  // edit takes, and the gender stamp for written rows. A no-op diff
  // without a demanded fork returns before validation/billing, as before.
  const plan = await resolveCardEditPlan(ctx, {
    userId,
    card,
    text,
    course,
    translations: args.translations,
    ensureUserOwnedText: args.ensureUserOwnedText,
    proposedAudioSpeakerGender: args.proposedAudioSpeakerGender,
  });
  const { changedLanguages } = plan;
  if (changedLanguages.size === 0 && !plan.needsCopy) {
    return { textId: card.textId, cardId: args.cardId, changed: false, course };
  }

  assertTranslationLengths(args.translations);

  // Consume quota before making changes
  if (!args.skipQuota) {
    await consumeQuota(ctx, userId, FEATURE_IDS.CARD_EDITS);
  }

  // Track card edit event
  await trackEvent(ctx, {
    userId,
    courseId: course._id,
    timezone: args.timezone,
    field: 'cardsEdited',
  });

  // Audit row, written before the paths diverge (Path B's curriculum-fix
  // enqueue needs its id). See `recordCardEditAuditStart` for why a
  // changeless fork is not logged.
  const cardEditId = await recordCardEditAuditStart(ctx, {
    userId,
    course,
    card,
    text,
    plan,
    auditKind: args.auditKind,
  });

  let resolvedTextId: Id<'texts'>;
  // Languages whose shared curriculum row this edit flagged, for the
  // analytics event at the end. Only ever non-empty on Path B.
  let flaggedLanguages: string[] = [];

  if (plan.isUserOwned) {
    // Path A: modify in place
    resolvedTextId = card.textId;
    await applyInPlaceTextEdit(ctx, { card, text, plan });
  } else {
    // Path B: fork the shared text into a user-owned logical copy.
    resolvedTextId = await forkSharedTextForEdit(ctx, {
      userId,
      card,
      text,
      plan,
    });

    // The fork above is now the user's private copy. `text` and the plan's
    // `existingTranslationMap` still describe the untouched shared rows, so
    // this is the one place with both the original rows and the user's
    // wording in hand.
    //
    // Skipped entirely when the source line changed: the user's target text
    // is then a translation of THEIR source sentence, not the curriculum's,
    // so offering it as a correction would compare two different sentences.
    if (
      args.suggestCurriculumFix &&
      !changedLanguages.has(plan.sourceLanguage) &&
      cardEditId !== undefined
    ) {
      flaggedLanguages = await suggestCurriculumFixesForEdit(
        ctx,
        text,
        changedLanguages,
        plan.submittedMap,
        plan.servedTranslationMap,
        { cardEditId, userId, course },
      );
    }
  }

  // Metadata-before-scheduling: land the proposed gender on the resolved
  // text row now, so `scheduleMissingContent` below (which resolves the
  // voice from this row and claims the synthesis) already speaks with the
  // right voice. See the arg's doc comment for why afterwards is too late.
  // Both fields: `resolveCardSpeakerGenders` gives the definitive
  // linguistic `speakerGender` precedence over `audioSpeakerGender` and
  // would flip a lone audio-gender patch straight back.
  if (args.proposedAudioSpeakerGender !== undefined) {
    await ctx.db.patch(resolvedTextId, {
      speakerGender: args.proposedAudioSpeakerGender,
      audioSpeakerGender: args.proposedAudioSpeakerGender,
    });
  }

  // Re-point the card at the resolved text (in place — see
  // `repointCardAtEditedText` for why the card id never changes) and
  // refresh its searchable text.
  const resolvedText = await repointCardAtEditedText(ctx, {
    card,
    course,
    resolvedTextId,
  });
  // Defensive cleanup: if the edit left the old text orphaned and user-created
  // (path A reuses the textId, so the new card normally still references it.
  // This is a no-op then), drop its now-unreferenced translations/audio/blobs.
  await cascadeCleanupTextIfOrphaned(ctx, card.textId);

  // Word re-tracking + TTS/romanization for the changed languages.
  await propagateEditToDerivedContent(ctx, {
    userId,
    course,
    card,
    plan,
    resolvedTextId,
    resolvedText,
  });

  // Path B forked the text row; the audit row was inserted before the fork
  // and still holds the before-ids, so point it at the produced text. On
  // Path A neither id moved, so the row is already correct as inserted and
  // there is nothing to update (see setCardEditResult's doc).
  if (cardEditId !== undefined && resolvedTextId !== card.textId) {
    await setCardEditResult(ctx, cardEditId, {
      cardIdAfter: args.cardId,
      textIdAfter: resolvedTextId,
    });
  }

  // An edit can turn the primary sentence INTO one of the user's stored
  // accepted alternatives; the store path dedupes against the primary, so
  // keeping such a row would list the card's own sentence twice under the
  // writing answer. Drop any alternative the new wording now duplicates.
  for (const lang of changedLanguages) {
    const newPrimary = normalizeForComparison(plan.submittedMap.get(lang)!);
    const duplicateAlternatives = await ctx.db
      .query('writingAlternatives')
      .withIndex('by_cardId_and_language', (q) =>
        q.eq('cardId', args.cardId).eq('language', lang),
      )
      .take(WRITING_ALTERNATIVES_MAX * 2);
    for (const alt of duplicateAlternatives) {
      if (normalizeForComparison(alt.text) === newPrimary) {
        await ctx.db.delete(alt._id);
      }
    }
  }

  await trackCardAction(ctx, userId, 'edit', card, {
    changed_languages: [...changedLanguages],
    // Present only when the edit doubled as a curriculum complaint. Keeps
    // the quality signal `flag_translation` provides on this path too, since
    // it charges no TRANSLATION_FLAGS unit and fires no flag event.
    ...(flaggedLanguages.length > 0
      ? { flagged_languages: flaggedLanguages }
      : {}),
  });

  return {
    textId: resolvedTextId,
    // Always the input card: edits patch the card in place on both paths
    // (see repointCardAtEditedText), so by-id references stay valid.
    cardId: args.cardId,
    changed: true,
    course,
  };
}

/**
 * Edit the translations of a card. Thin wrapper over `applyCardEdit`. See
 * its doc comment for the Path A/B mechanics.
 *
 * The manual edit dialog is the one caller that opts into
 * `suggestCurriculumFix`: a user retyping a curriculum translation is telling
 * us it is wrong, so the edit flags the shared row and offers their wording to
 * the retranslation alongside forking their own card.
 */
export const editCard = mutation({
  args: {
    cardId: v.id('cards'),
    translations: v.array(
      v.object({
        language: v.string(),
        text: v.string(),
      }),
    ),
    timezone: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyCardEdit(ctx, {
      ...args,
      suggestCurriculumFix: true,
      auditKind: 'manual_edit',
    });
    return null;
  },
});
