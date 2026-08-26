import { v, ConvexError } from 'convex/values';
import { mutation, query, MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import {
  buildCardSearchableText,
  buildTextContentBatchForLanguages,
  type CardAlternativeContent,
} from '../lib/cardContent';
import { Id, Doc } from '../_generated/dataModel';
import { getAuthUserId, requireAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getCourseSettings } from '../db/courseSettings';
import {
  carriedAnnotationFields,
  clearedAnnotationFields,
} from '../lib/textAnnotations';
import { getCollectionProgress } from '../db/collections';
import { getDeckByCourseId } from '../db/decks';
import { trackEvent } from '../db/stats/dailyStats';
import { EVENTS, track } from '../analytics';
import { updateWordTextsForEdit } from '../db/stats/wordTracking';
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
import {
  getDailyStats,
  floorToCelebration,
  displayedActiveReviews,
} from '../db/stats/dailyStats';
import { patchCard, insertCard, deleteCard } from '../db/stats/cardAggregates';
import {
  languageRole,
  recordCardEdit,
  recordRetranslationAttempt,
  retranslationAuditFields,
  setCardEditResult,
  type CardEditChange,
  type RetranslationAuditFields,
} from './cardEditAudit';
import {
  scheduleCard,
  getValidRatings,
  DEFAULT_INITIAL_REVIEW_COUNT,
  type CardSchedulingState,
} from '../../lib/scheduling';
import {
  fsrsStateValidator,
  translationValidator,
  audioRecordingValidator,
  schedulingPhaseValidator,
  reviewRatingValidator,
  reviewModeValidator,
  asVoiceGender,
  freePlayFace,
  schedulingTrackFromSettings,
  type SchedulingMode,
  type SchedulingTrack,
  type StudyContentFilter,
  type FreePlayFace,
  type CardEditLanguageRole,
} from '../types';
import { PROGRESS_DISPLAY_INTERVAL } from '../../lib/constants/learning';
import {
  cardOriginPillFields,
  isCollectionComplete,
  originsForFilter,
} from '../lib/collections';
import {
  FREE_PLAY_MODES,
  fetchFreePlayRotation,
  randomOrderKey,
} from '../lib/freePlay';
import { getTodayInTimezone } from '../lib/dateUtils';
import {
  deleteAudioRow,
  deleteAudioRowsForTextLanguage,
} from '../lib/audio';
import { soundsSame } from '../lib/textComparison';
import { FLAG_AUTO_RETRANSLATION_MAX } from '../../lib/languages';
import {
  isUserCreatedText,
  mayRegenerateTranslation,
  USER_PROVIDED_TRANSLATION_SOURCE,
} from '../../lib/translationProvenance';
import { consumeQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { scheduleMissingContent } from './decks';
import {
  maybeScheduleWritingSeed,
  writingSeedPatch,
} from '../migrations/seedWritingTrack';
import { fetchTrackDueCards } from '../lib/dueQueue';
import { claimLlmTranslationIfAvailable } from './llmTranslationQueue';
import { migrateWritingAlternatives } from './writingAlternatives';
import {
  MAX_CARD_TEXT_LENGTH,
  WRITING_ALTERNATIVES_MAX,
} from '../../lib/constants/learning';
import {
  CARD_OVERRIDE_SPEED_MIN,
  CARD_OVERRIDE_SPEED_MAX,
} from '../../lib/constants/audioPlayback';


/**
 * Authenticate the user and verify ownership of a card via deck → course.
 * Throws ConvexError on failure. Every card-mutating entry point shares this
 * ONE ownership rule instead of re-implementing the card → deck → course walk
 * The chat "also correct" replace inherits it through `applyCardEdit`.
 */
async function authorizeCardAccess(ctx: MutationCtx, cardId: Id<'cards'>) {
  const userId = await requireAuthUserId(ctx);

  const card = await ctx.db.get(cardId);
  if (!card) throw new ConvexError('Card not found');

  const deck = await ctx.db.get(card.deckId);
  if (!deck) throw new ConvexError('Deck not found');

  const course = await ctx.db.get(deck.courseId);
  if (!course || course.userId !== userId)
    throw new ConvexError('Unauthorized');

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
  return fetchTrackDueCards(ctx, deckId, schedulingMode, filter, track, now, take);
}

export const getCardForReview = query({
  // `timezone` is optional so callers that don't care about the daily-count
  // side-channel (tests, the layout warm-up) can still call `{}`. The learn
  // view always supplies it so the in-learn progress bar can subscribe to
  // today's active review count via this single query, no separate
  // `getTodayReviewCount` subscription, and updates flow in live whether they
  // come from a local mutation or another device.
  args: { timezone: v.optional(v.string()) },
  returns: v.union(
    v.object({
      ...cardResultFields,
      nextCard: v.union(cardResultValidator, v.null()),
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
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const { course } = active;

    const deck = await getDeckByCourseId(ctx, course._id);
    if (!deck) return null;

    // Load settings (initialReviewCount + schedulingMode + studyContentFilter) from the courseSettings table
    const settings = await getCourseSettings(ctx, course._id);
    const initialReviewCount = settings?.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT;
    const studyContext = studyContextFromSettings(settings);
    const { schedulingMode, studyContentFilter } = studyContext;

    const now = Date.now();

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
    const texts = await Promise.all(dueCards.map((card) => ctx.db.get(card.textId)));
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
        dueDate: writingTrack ? card.writingDueDate ?? card.dueDate : card.dueDate,
        isMastered: card.isMastered,
        isHidden: card.isHidden,
        isFavorite: card.isFavorite ?? false,
        schedulingPhase: writingTrack ? ('review' as const) : card.schedulingPhase,
        preReviewCount: writingTrack ? 0 : card.preReviewCount,
        initialReviewCount,
        fsrsState: (writingTrack ? card.writingFsrsState : card.fsrsState) ?? null,
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
      const today = getTodayInTimezone(args.timezone);
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
    const undoable = await takeUndoableLogs(ctx, userId, course._id, studyContext);

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
/**
 * True iff any of the user's active custom collections has at least one text
 * the deck hasn't pulled in yet. The auto-add Phase 1 (custom/chat) consumes
 * no `SENTENCES` quota, so when this returns `true` the user can still get
 * more cards without paying. The UI must NOT show the upgrade button in
 * that case (see decks.ts:`addCardsFromCollection`).
 *
 * `activeCustomCollectionIds` is the canonical source-of-truth: when the
 * user creates a chat or custom collection it's appended here (see
 * collections.ts:`getOrCreateChatCollection` / `getOrCreateCustomCollection`).
 */
async function hasPendingCustomCardsToAdd(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  activeCustomCollectionIds: Id<'collections'>[] | undefined,
): Promise<boolean> {
  if (!activeCustomCollectionIds || activeCustomCollectionIds.length === 0) {
    return false;
  }
  for (const collId of activeCustomCollectionIds) {
    const coll = await ctx.db.get(collId);
    if (!coll) continue;
    const prog = await getCollectionProgress(ctx, userId, courseId, collId);
    // Ignored texts are excluded from auto-add, so they aren't pending.
    if (!isCollectionComplete(coll.textCount, prog)) return true;
  }
  return false;
}

export const getCardForReviewEmptyReason = query({
  args: {},
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
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { reason: 'no_session' as const };

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { reason: 'no_session' as const };

    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return { reason: 'no_session' as const };

    const settings = await getCourseSettings(ctx, active.course._id);
    const { schedulingMode, studyContentFilter, face, track } =
      studyContextFromSettings(settings);
    const now = Date.now();

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
    const currentOrigins = studyContentFilter === 'custom'
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

    const otherFilter: StudyContentFilter = studyContentFilter === 'custom' ? 'course' : 'custom';
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
  args: {
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
  },
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
    const { userId, card, deck, course } = await authorizeCardAccess(ctx, args.cardId);

    const reviewSettings = await getCourseSettings(ctx, deck.courseId);
    const initialReviewCount = reviewSettings?.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT;

    // Which per-card schedule this review writes: the writing track iff the
    // course has separateModeTracking on AND the review happened in Writing
    // mode. Derived from args.reviewMode (what the user actually did), not
    // settings.reviewMode. The two only diverge on a settings-update race.
    const track: SchedulingTrack = schedulingTrackFromSettings({
      separateModeTracking: reviewSettings?.separateModeTracking,
      reviewMode: args.reviewMode,
    });

    // Lazy seed: a writing-track review of a card the enable-time backfill
    // hasn't reached yet (or one created while the split was off) starts from
    // a copy of the shared schedule. Exactly what the backfill would have
    // written. The undo snapshot below still records the true prior (unset)
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
    const priorWritingFsrsState = writingBaseline.writingFsrsState;
    const priorWritingGraduated = writingBaseline.writingIsGraduated ?? false;
    const priorWritingGoodCount = writingBaseline.writingGoodReviewCount ?? 0;

    // When forceReviewPhase is true (full review mode), treat the card as
    // being in the 'review' phase so FSRS ratings are accepted directly.
    // The writing track has no pre-review phase at all.
    const phase =
      args.forceReviewPhase || track === 'writing'
        ? ('review' as const)
        : card.schedulingPhase;
    const validRatings = getValidRatings(phase);
    if (!validRatings.includes(args.rating)) {
      throw new ConvexError(
        `Invalid rating "${args.rating}" for ${phase} phase. Valid ratings: ${validRatings.join(', ')}`,
      );
    }

    const assertAccuracy = (value: number | undefined, name: string) => {
      if (value != null && (value < 0 || value > 1 || !Number.isFinite(value))) {
        throw new ConvexError(`Invalid ${name} value, must be between 0 and 1`);
      }
    };
    assertAccuracy(args.accuracy, 'accuracy');
    assertAccuracy(args.accuracyStrict, 'accuracyStrict');
    assertAccuracy(args.accuracyLenient, 'accuracyLenient');

    // Build current scheduling state from the reviewed track
    const cardState: CardSchedulingState =
      track === 'writing'
        ? {
            schedulingPhase: 'review',
            preReviewCount: 0,
            dueDate: writingBaseline.writingDueDate ?? card.dueDate,
            fsrsState: priorWritingFsrsState ?? null,
          }
        : {
            schedulingPhase: phase,
            preReviewCount: card.preReviewCount,
            dueDate: card.dueDate,
            fsrsState: card.fsrsState ?? null,
          };

    // Run the shared scheduling algorithm
    const result = scheduleCard(cardState, args.rating, initialReviewCount);

    // Add a random jitter of 0–60 seconds to spread cards apart in the queue.
    const jitterMs = (Math.random()-0.5) * 60_000;
    const dueDateWithJitter = result.dueDate + jitterMs;

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

    let searchableTextPatch: { searchableText: string; searchableTextLanguages: string[] } | undefined;
    if (searchableTextIsStale && text) {
      searchableTextPatch = await buildCardSearchableText(
        ctx,
        card.textId,
        text.text,
        courseLanguages,
        text,
      );
    }

    // Flip isGraduated once the card reaches FSRS Review state (one-way flag)
    const isGraduatedPatch =
      !(card.isGraduated ?? false) && result.fsrsState && result.fsrsState.state >= 2
        ? { isGraduated: true as const }
        : {};

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
          ? priorWritingFsrsState ?? null
          : card.fsrsState ?? null,
      rating: args.rating,
      accuracy: args.accuracy,
      accuracyStrict: args.accuracyStrict,
      accuracyLenient: args.accuracyLenient,
      wasDefaultRating: args.wasDefaultRating,
      text,
      sessionId: args.sessionId,
    });

    // Patch the card (via aggregate-aware helper). We pass `card` as oldDoc so
    // patchCard can skip both the pre- and post-patch reads. Only the reviewed
    // track's scheduling fields are written, under separateModeTracking the
    // other track's schedule is untouched.
    // Per-mode review counter. Keyed by what the user actually did
    // (args.reviewMode), independent of the track the review wrote, so it
    // counts correctly with the split on or off. Same 'audio' default as
    // statsReversal.reviewModeForStats; decremented symmetrically on undo.
    const prevModeCounts = card.reviewCountByMode ?? { audio: 0, full: 0 };
    const reviewModeKey = args.reviewMode ?? 'audio';
    const nonSchedulingPatch = {
      ...searchableTextPatch,
      ...(newWordsTrackedLanguages
        ? { wordsTrackedLanguages: newWordsTrackedLanguages }
        : {}),
      reviewCountByMode: {
        ...prevModeCounts,
        [reviewModeKey]: prevModeCounts[reviewModeKey] + 1,
      },
    };
    if (track === 'writing') {
      await patchCard(
        ctx,
        args.cardId,
        {
          writingDueDate: dueDateWithJitter,
          writingLastReviewedAt: Date.now(),
          // `lastReviewedAt` is the track-agnostic activity timestamp (the
          // Library sorts and displays it; even free-play stamps it), so a
          // writing review updates it too. Like free play, undo does not
          // restore it, prevWriting snapshots only the writing schedule.
          lastReviewedAt: Date.now(),
          // Writing-track counterpart of goodReviewCount. On a lazy seed the
          // copied baseline is persisted even for non-good ratings, so the
          // review is indistinguishable from backfill-then-review.
          ...(args.rating === 'good' || args.rating === 'easy'
            ? { writingGoodReviewCount: priorWritingGoodCount + 1 }
            : writingUnseeded && card.goodReviewCount !== undefined
              ? { writingGoodReviewCount: priorWritingGoodCount }
              : {}),
          ...(result.fsrsState && { writingFsrsState: result.fsrsState }),
          // Always write the flag (never leave it undefined): the learn_new
          // writing index matches on eq(writingIsGraduated, false), which an
          // undefined field would silently fall out of. One-way like
          // isGraduated.
          writingIsGraduated:
            priorWritingGraduated ||
            (result.fsrsState !== null && result.fsrsState.state >= 2),
          ...nonSchedulingPatch,
        },
        card,
      );
    } else {
      await patchCard(
        ctx,
        args.cardId,
        {
          schedulingPhase: result.schedulingPhase,
          preReviewCount: result.preReviewCount,
          dueDate: dueDateWithJitter,
          lastReviewedAt: Date.now(),
          // Only FSRS good/easy count (never pre-review "understood"), drives
          // the "until rated good" Practice-Listening strategy.
          ...(args.rating === 'good' || args.rating === 'easy'
            ? { goodReviewCount: (card.goodReviewCount ?? 0) + 1 }
            : {}),
          ...(result.fsrsState && { fsrsState: result.fsrsState }),
          ...isGraduatedPatch,
          ...nonSchedulingPatch,
        },
        card,
      );
    }

    // Log the review for the learn-mode undo stack: the pre-patch card
    // snapshot plus the keys `reverseReviewStats` needs to decrement the
    // right stat buckets. The study context stamps scope undo to the settings
    // the review happened under.
    await logReview(ctx, {
      userId,
      courseId: deck.courseId,
      cardId: args.cardId,
      reviewedAt: Date.now(),
      timezone: args.timezone,
      kind: 'review',
      date: todayDate,
      schedulingMode: reviewSettings?.schedulingMode ?? 'learnAndReview',
      studyContentFilter: reviewSettings?.studyContentFilter ?? 'both',
      track,
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
        hourOfDay,
        rating: args.rating,
        reviewModeForStats: args.reviewMode ?? 'audio',
        reviewModeRaw: args.reviewMode,
        wasFirstReview,
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
        // lazy-seed resolution (priorWritingFsrsState, not the raw card).
        reviewDepth:
          args.accuracy != null
            ? track === 'writing'
              ? (priorWritingFsrsState?.reps ?? 0) + 1
              : card.preReviewCount + (card.fsrsState?.reps ?? 0) + 1
            : undefined,
        // Same rule, same reason, for the reviewsByCardState bucket: stamp the
        // state the review was scheduled FROM. `prevWriting` below snapshots
        // the card's true (on a lazy seed, unset) writing fields because undo
        // must restore them, so it is NOT a valid source for the stat bucket,
        // and re-deriving from it would decrement 'new' for a review counted
        // under the copied shared state.
        cardState:
          (track === 'writing' ? priorWritingFsrsState : card.fsrsState)
            ?.state ?? 0,
        languages,
        collectionId: card.collectionId,
      },
    });

    // Server-side milestone verdict: client just respects this. Opt-out
    // setting defaults to enabled when undefined (matches the UI check
    // `progressDisplayEnabled !== false`). The `lastCelebratedAtCount`
    // high-water mark keeps an undo + re-review from replaying a celebration:
    // the count must EXCEED the mark, and undo never lowers it.
    const progressDisplayEnabled = reviewSettings?.progressDisplayEnabled !== false;
    let celebrationHighWater = lastCelebratedAtCount;
    let triggerCelebration =
      progressDisplayEnabled &&
      dailyReviewsToday > 0 &&
      dailyReviewsToday % PROGRESS_DISPLAY_INTERVAL === 0 &&
      dailyReviewsToday > lastCelebratedAtCount;
    if (triggerCelebration) {
      const todayStats = await getDailyStats(ctx, userId, deck.courseId, todayDate);
      if (todayStats) {
        await ctx.db.patch(todayStats._id, {
          lastCelebratedAtCount: dailyReviewsToday,
        });
        celebrationHighWater = dailyReviewsToday;
      } else {
        triggerCelebration = false;
      }
    }

    return {
      schedulingPhase: result.schedulingPhase,
      preReviewCount: result.preReviewCount,
      dueDate: dueDateWithJitter,
      phaseTransitioned: result.phaseTransitioned,
      fsrsState: result.fsrsState,
      dailyReviewsToday: floorToCelebration(dailyReviewsToday, celebrationHighWater),
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

    const undoable = await takeUndoableLogs(ctx, userId, course._id, studyContext);

    for (const log of undoable) {
      const card = await ctx.db.get(log.cardId);
      if (!card) {
        // Card deleted since the review, nothing to restore, and deletion
        // never reverses stat contributions elsewhere either. Discard and
        // fall through to the next entry.
        await ctx.db.delete(log._id);
        continue;
      }

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
    throw new ConvexError('Not in free play');
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
  const floorCounter = floorCard ? (floorCard[cfg.counterField] ?? 0) : pickedCounter;
  // Land strictly above the floor so the played card cannot tie with the
  // rest of the round; combined with ascending counter ordering this rules
  // out an immediate repeat as long as ≥1 other playable card exists.
  const newCounter = Math.max(pickedCounter, floorCounter) + 1;

  // Separate from the round counter (a rotation position subject to the
  // catch-up jump above): a true +1-per-play count. The seed for cards that
  // predate the field is face-specific. See `playCountSeed` in
  // convex/lib/freePlay.ts.
  const newPlayCount = (card[cfg.playCountField] ?? cfg.playCountSeed(card)) + 1;

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
 * @deprecated Back-compat alias for client bundles built before the
 * radio→free-play rename (open tabs, cached PWA/Capacitor builds). Same
 * behavior as `advanceFreePlayCard`, but keeps the old name and the old
 * `nextRadioRoundCounter` return field. Remove once the deploy has soaked.
 * Tracked in `.devtool/features/remove-advance-radio-card-alias-2026-08-03.md`.
 */
export const advanceRadioCard = mutation({
  args: {
    cardId: v.id('cards'),
    timezone: v.string(),
    timeSpentMs: v.optional(v.number()),
  },
  returns: v.object({
    nextRadioRoundCounter: v.number(),
  }),
  handler: async (ctx, args) => {
    const { nextRoundCounter } = await advanceFreePlayCardImpl(ctx, args);
    return { nextRadioRoundCounter: nextRoundCounter };
  },
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
        throw new ConvexError(
          `audioSpeedOverride must be between ${CARD_OVERRIDE_SPEED_MIN} and ${CARD_OVERRIDE_SPEED_MAX}`,
        );
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
    await trackCardAction(ctx, userId, nextFavorite ? 'favorite' : 'unfavorite', card);
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
  existingTranslationMap: Map<string, Doc<'translations'>>,
  audit: { cardEditId: Id<'cardEdits'>; userId: string; course: Doc<'courses'> },
): Promise<string[]> {
  const flagged: string[] = [];

  for (const lang of changedLanguages) {
    if (lang === originalText.language) continue;

    const existing = existingTranslationMap.get(lang);
    // No shared row for this language: the curriculum never had a translation
    // here, so there is nothing to correct and nothing to count.
    if (!existing) continue;

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
 */
export const flagTranslation = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.object({
    retranslated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { userId, card, course } = await authorizeCardAccess(ctx, args.cardId);

    const text = await ctx.db.get(card.textId);
    if (!text) throw new ConvexError('Text not found');

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
      cardLanguages.map((lang) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('targetLanguage', lang),
          )
          .first(),
      ),
    );

    // Drop languages with no translation row (the card simply doesn't
    // have a translation in that language yet, nothing to flag).
    const nonSourceTranslations = fetched.filter(
      (tr): tr is NonNullable<typeof tr> => tr !== null,
    );

    if (nonSourceTranslations.length === 0) {
      return { retranslated: false };
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
      return { retranslated: false };
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
      return { retranslated: false };
    }

    // Flag volume per language is the clearest quality signal the app has for
    // the translation pipeline.
    await trackCardAction(ctx, userId, 'flag_translation', card, {
      retranslated: anyEnqueued,
      target_languages: course.targetLanguages,
    });

    return { retranslated: anyEnqueued };
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
    const { userId, card, course } = await authorizeCardAccess(ctx, args.cardId);

    const text = await ctx.db.get(card.textId);
    if (!text) throw new ConvexError('Text not found');

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
    for (const lang of allLanguages) {
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
      { forceAudioRegen: true },
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
  /** The card after the edit, same id on Path A, a NEW id on Path B. */
  cardId: Id<'cards'>;
  changed: boolean;
  /** The card's course, from the one authorizeCardAccess walk this edit
   * already performs. Returned so callers needing course languages (the
   * also-correct replace) don't repeat the card → deck → course reads. */
  course: Doc<'courses'>;
}> {
    const { userId, card, course } = await authorizeCardAccess(ctx, args.cardId);

    const text = await ctx.db.get(card.textId);
    if (!text) throw new ConvexError('Text not found');

    // Narrow the card's resolved voice gender once for stamping onto the
    // translation rows below. `texts.audioSpeakerGender` is typed as a loose
    // string but is always 'male' | 'female' in practice; the stamped
    // `translations.speakerGender` field is strict. A proposed gender wins.
    // The re-stamped rows must agree with the voice the edit enqueues.
    const audioGenderStamp = asVoiceGender(
      args.proposedAudioSpeakerGender ?? text.audioSpeakerGender,
    );

    const sourceLanguage = text.language;
    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];

    // Load existing translations for non-source languages
    const nonSourceLanguages = allLanguages.filter(
      (lang) => lang !== sourceLanguage,
    );
    const existingTranslations = await Promise.all(
      nonSourceLanguages.map((lang) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('targetLanguage', lang),
          )
          .first(),
      ),
    );
    const existingTranslationMap = new Map<string, Doc<'translations'>>();
    nonSourceLanguages.forEach((lang, i) => {
      if (existingTranslations[i]) {
        existingTranslationMap.set(lang, existingTranslations[i]!);
      }
    });

    // Build a map of submitted texts
    const submittedMap = new Map<string, string>();
    for (const t of args.translations) {
      submittedMap.set(t.language, t.text);
    }

    // Diff: determine which languages actually changed
    const changedLanguages = new Set<string>();
    for (const lang of allLanguages) {
      const submitted = submittedMap.get(lang);
      if (submitted === undefined) continue;
      if (lang === sourceLanguage) {
        if (submitted !== text.text) changedLanguages.add(lang);
      } else {
        const existing = existingTranslationMap.get(lang);
        if (submitted !== (existing?.translatedText ?? '')) changedLanguages.add(lang);
      }
    }

    const isUserOwned = text.userCreated && text.userId === userId;
    // Path B must also run for a no-text-change call that requires ownership
    // (metadata-only "also correct" replace on a shared text): the pure
    // logical copy gives the caller a user-owned row to patch.
    const needsCopy =
      !isUserOwned &&
      (changedLanguages.size > 0 || args.ensureUserOwnedText === true);
    if (changedLanguages.size === 0 && !needsCopy) {
      return { textId: card.textId, cardId: args.cardId, changed: false, course };
    }

    // Audio-relevant subset of the diff: an edit that only touches
    // punctuation/'_' (`soundsSame`) sounds identical spoken aloud, so the
    // language keeps its audio. Path A skips the delete, Path B copies the
    // rows like an unchanged language (word timings still align; the words
    // are the same). Text/romanization writes keep using the full
    // `changedLanguages` set.
    const audioChangedLanguages = new Set<string>();
    for (const lang of changedLanguages) {
      const oldText =
        lang === sourceLanguage
          ? text.text
          : (existingTranslationMap.get(lang)?.translatedText ?? '');
      if (!soundsSame(submittedMap.get(lang)!, oldText)) {
        audioChangedLanguages.add(lang);
      }
    }

    // Validate text lengths
    for (const { language, text } of args.translations) {
      if (text.length > MAX_CARD_TEXT_LENGTH) {
        throw new ConvexError({
          code: 'TEXT_TOO_LONG',
          message: `Text for language "${language}" exceeds the maximum length of ${MAX_CARD_TEXT_LENGTH} characters.`,
          language,
          maxLength: MAX_CARD_TEXT_LENGTH,
        });
      }
    }

    // Consume quota before making changes
    if (!args.skipQuota) {
      await consumeQuota(ctx, userId, FEATURE_IDS.CARD_EDITS);
    }

    // Track card edit event
    await trackEvent(ctx, { userId, courseId: course._id, timezone: args.timezone, field: 'cardsEdited' });

    // Audit row, written before the paths diverge: Path B's curriculum-fix
    // enqueue needs its id and runs before the replacement card exists. The
    // after-ids therefore start as the before-ids and are corrected at the end
    // (`setCardEditResult`), on the fork path only.
    //
    // Skipped when no wording changed. `ensureUserOwnedText` reaches here with
    // an empty diff (the metadata-only "also correct" replace, which forks
    // purely to get a user-owned row): a real card replacement, but not an
    // edit, and logging it as one would put a changeless row in a feed whose
    // whole subject is before/after wording.
    const auditChanges: CardEditChange[] = [...changedLanguages].map((lang) => {
      const isSourceLanguage = lang === sourceLanguage;
      const existing = existingTranslationMap.get(lang);
      return {
        language: lang,
        role: languageRole(course, lang),
        isSourceLanguage,
        before: isSourceLanguage
          ? text.text
          : (existing?.translatedText ?? ''),
        after: submittedMap.get(lang)!,
        ...(isSourceLanguage
          ? {}
          : {
            beforeTranslationSource: existing?.translationSource,
            beforeFlagCount: existing?.flagCount,
          }),
        soundsSame: !audioChangedLanguages.has(lang),
      };
    });
    let cardEditId: Id<'cardEdits'> | undefined;
    if (auditChanges.length > 0) {
      cardEditId = await recordCardEdit(ctx, {
        userId,
        course,
        kind: args.auditKind,
        path: isUserOwned ? 'in_place' : 'fork',
        cardIdBefore: args.cardId,
        cardIdAfter: args.cardId,
        textIdBefore: card.textId,
        textIdAfter: card.textId,
        collectionOrigin: card.collectionOrigin,
        textWasUserCreated: text.userCreated,
        sourceLanguage,
        sourceText: text.text,
        changes: auditChanges,
      });
    }

    let resolvedTextId: Id<'texts'>;
    // Languages whose shared curriculum row this edit flagged, for the
    // analytics event at the end. Only ever non-empty on Path B.
    let flaggedLanguages: string[] = [];

    if (isUserOwned) {
      // Path A: modify in place
      resolvedTextId = card.textId;

      if (changedLanguages.has(sourceLanguage)) {
        // Annotation values and their provenance tags travel as units. The
        // old transliteration/IPA no longer matches the new text, so the
        // tags go with them (mirrors the translation branch below).
        await ctx.db.patch(text._id, {
          text: submittedMap.get(sourceLanguage)!,
          ...clearedAnnotationFields(),
        });
      }

      for (const lang of allLanguages) {
        if (lang === sourceLanguage) continue;
        if (!changedLanguages.has(lang)) continue;
        const existing = existingTranslationMap.get(lang);
        if (existing) {
          // User edited an existing translation. Drop the annotations (they
          // don't match the new text), drop their source tags, and re-tag
          // as user-provided so a future strategy swap doesn't overwrite
          // the user's edit.
          await ctx.db.patch(existing._id, {
            translatedText: submittedMap.get(lang)!,
            ...clearedAnnotationFields(),
            translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
            // Stamp with the card's current gender so the mismatch sweep in
            // `scheduleMissingContent` sees agreement (the user-provided
            // branch is already skipped by the sweep, but keeping this in
            // sync avoids relying on that skip).
            ...(audioGenderStamp
              ? { speakerGender: audioGenderStamp }
              : {}),
          });
        } else {
          await ctx.db.insert('translations', {
            textId: card.textId,
            targetLanguage: lang,
            translatedText: submittedMap.get(lang)!,
            translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
            ...(audioGenderStamp
              ? { speakerGender: audioGenderStamp }
              : {}),
          });
        }
      }

      // Detach audio pointers for audibly-changed languages only.
      // Punctuation-only edits keep their audio. keepAsset: the old audio is
      // still correct for the old sentence, so it stays in the audioAssets
      // cache (only the regenerate button and TTS-system migrations fully
      // delete audio).
      for (const lang of audioChangedLanguages) {
        await deleteAudioRowsForTextLanguage(ctx, card.textId, lang, {
          keepAsset: true,
        });
      }
    } else {
      // Path B: create new textId, copy unchanged content
      const submittedSource = submittedMap.get(sourceLanguage);
      const sourceChanged = changedLanguages.has(sourceLanguage);
      const newTextId = await ctx.db.insert('texts', {
        text: sourceChanged && submittedSource ? submittedSource : text.text,
        language: text.language,
        // Annotations (romanization, IPA) travel with their source tags:
        // copy when unchanged (so we keep pointing at whichever engine
        // produced the carried-over text); drop when changed (next
        // ensureContent regenerates and re-tags).
        ...(sourceChanged ? {} : carriedAnnotationFields(text)),
        userCreated: true,
        userId,
        collectionId: text.collectionId,
        collectionRank: text.collectionRank,
        // This row is a logical copy of `text`. The user only edited
        // translations, not the source, so preserve all pipeline-derived
        // metadata rather than regenerating it. speakerGender specifically
        // also prevents the downstream `scheduleMissingContent` sweep from
        // coin-flipping a new gender that disagrees with the copied audio
        // rows and deletes them.
        speakerGender: text.speakerGender,
        audioSpeakerGender: text.audioSpeakerGender,
        register: text.register,
        addresseeNumber: text.addresseeNumber,
        addresseeGender: text.addresseeGender,
        addressesSomeone: text.addressesSomeone,
        referentGender: text.referentGender,
        tenseAspect: text.tenseAspect,
        sentenceType: text.sentenceType,
        literalFigurative: text.literalFigurative,
      });
      resolvedTextId = newTextId;

      // Create translations rows for all non-source languages.
      // Sources travel with their values:
      //   - User-edited rows: tag as `'user-provided'`; carry no annotations.
      //   - Unchanged rows: copy `translatedText` + `translationSource` +
      //     every present annotation pair (romanization, IPA) so we don't
      //     lose the original tags on the logical-copy operation.
      for (const lang of allLanguages) {
        if (lang === sourceLanguage) continue;
        const existing = existingTranslationMap.get(lang);
        const changed = changedLanguages.has(lang);
        await ctx.db.insert('translations', {
          textId: newTextId,
          targetLanguage: lang,
          translatedText: changed
            ? (submittedMap.get(lang) ?? '')
            : (existing?.translatedText ?? ''),
          ...(changed
            ? { translationSource: USER_PROVIDED_TRANSLATION_SOURCE }
            : existing?.translationSource
              ? { translationSource: existing.translationSource }
              : {}),
          ...(changed || !existing ? {} : carriedAnnotationFields(existing)),
          // Copy the prior row's speakerGender on the carry-over path so the
          // logical copy doesn't trigger a gender-mismatch regeneration on
          // the new text. For user-edited (changed) rows, stamp with the
          // new text's current gender (which copies `text.audioSpeakerGender`
          // a few lines above).
          ...(changed
            ? audioGenderStamp
              ? { speakerGender: audioGenderStamp }
              : {}
            : existing?.speakerGender
              ? { speakerGender: existing.speakerGender }
              : {}),
          // Carry the source row's translationVersion on the unchanged carry-over
          // branch so the logical copy is faithful (matching the audio copy and
          // the stamping done everywhere else). User-edited rows are tagged
          // user-provided and left unstamped (user-owned). Benign today since the
          // version sweep exempts userCreated + user-provided rows, but this keeps
          // the copy honest if those exemptions ever change.
          ...(!changed && existing?.translationVersion !== undefined
            ? { translationVersion: existing.translationVersion }
            : {}),
        });
      }

      // Copy audio recordings for languages whose audio is still valid.
      // Unchanged ones AND punctuation-only edits (audibly identical).
      for (const lang of allLanguages) {
        if (audioChangedLanguages.has(lang)) continue;
        const audioRows = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('language', lang),
          )
          .take(20);
        for (const row of audioRows) {
          // The copy shares the same asset. Staleness (the asset's
          // ttsVersion stamp) travels with the asset itself.
          await ctx.db.insert('audioRecordings', {
            textId: newTextId,
            language: row.language,
            assetId: row.assetId,
          });
        }
      }

      // The fork above is now the user's private copy. `text` and
      // `existingTranslationMap` still describe the untouched shared rows, so
      // this is the one place with both the original rows and the user's
      // wording in hand.
      //
      // Skipped entirely when the source line changed: the user's target text
      // is then a translation of THEIR source sentence, not the curriculum's,
      // so offering it as a correction would compare two different sentences.
      if (
        args.suggestCurriculumFix &&
        !changedLanguages.has(sourceLanguage) &&
        cardEditId !== undefined
      ) {
        flaggedLanguages = await suggestCurriculumFixesForEdit(
          ctx,
          text,
          changedLanguages,
          submittedMap,
          existingTranslationMap,
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

    // Build searchable text for the new card
    const resolvedText = await ctx.db.get(resolvedTextId);
    if (!resolvedText) throw new ConvexError('Resolved text not found');

    const courseLanguages = [...course.baseLanguages, ...course.targetLanguages];
    const { searchableText, searchableTextLanguages } =
      await buildCardSearchableText(ctx, resolvedTextId, resolvedText.text, courseLanguages);

    // The card this edit leaves behind: unchanged on Path A (patched in
    // place), a brand-new document on Path B (insert + delete). Callers need
    // to know which. The chat replace path retargets its sibling approvals
    // and the learn view suppresses its thread rotation off this identity.
    let resolvedCardId: Id<'cards'> = args.cardId;

    if (isUserOwned) {
      // Path A edits the existing text row, so the card still points at the
      // right content, only its derived search index needs refreshing. Patch
      // in place: the card keeps its `_id`, `_creationTime` and `dueDate`, so
      // it holds its exact position in the queue and costs three aggregate
      // writes instead of the six a delete + insert would.
      await patchCard(
        ctx,
        args.cardId,
        {
          searchableText,
          searchableTextLanguages,
          // Same defaults the replacement path applied, so cards predating
          // these fields still get backfilled on edit.
          isGraduated: card.isGraduated ?? false,
          radioRoundCounter: card.radioRoundCounter ?? 0,
          radioOrderKey: card.radioOrderKey ?? randomOrderKey(),
          freeStudyRoundCounter: card.freeStudyRoundCounter ?? 0,
          freeStudyOrderKey: card.freeStudyOrderKey ?? randomOrderKey(),
        },
        card,
      );
    } else {
      // Path B pointed the card at a brand-new text row, so the card document
      // has to be replaced. Subtract 1ms from dueDate so this card sorts before
      // any other card that happens to share the exact same dueDate (Convex
      // uses _creationTime as the tiebreaker within equal index values, and the
      // new doc would otherwise sort last, causing a different card to be
      // returned by getCardForReview).
      resolvedCardId = await insertCard(ctx, {
        deckId: card.deckId,
        textId: resolvedTextId,
        collectionId: card.collectionId,
        collectionOrigin: card.collectionOrigin,
        dueDate: card.dueDate - 1,
        isMastered: card.isMastered,
        isHidden: card.isHidden,
        isFavorite: card.isFavorite,
        isGraduated: card.isGraduated ?? false,
        schedulingPhase: card.schedulingPhase,
        preReviewCount: card.preReviewCount,
        // Preserve the "until rated good" Practice-Listening progress. Losing
        // this on edit would restart listening for an already-graduated card.
        goodReviewCount: card.goodReviewCount,
        audioSpeedOverrides: card.audioSpeedOverrides,
        radioRoundCounter: card.radioRoundCounter ?? 0,
        // Preserve the true radio play-count so an in-place edit doesn't reset the
        // "Only new" graduation (undefined for cards that predate the field).
        radioPlayCount: card.radioPlayCount,
        // Preserve the existing tiebreak so the edited card keeps its place in
        // the radio rotation (or take a fresh random one if the original card
        // predates this field). Same treatment for the free-study rotation.
        radioOrderKey: card.radioOrderKey ?? randomOrderKey(),
        freeStudyRoundCounter: card.freeStudyRoundCounter ?? 0,
        freeStudyPlayCount: card.freeStudyPlayCount,
        freeStudyOrderKey: card.freeStudyOrderKey ?? randomOrderKey(),
        fsrsState: card.fsrsState,
        lastReviewedAt: card.lastReviewedAt,
        // Preserve the writing track (separateModeTracking) so an edit doesn't
        // reset the card's writing schedule; same -1ms queue-position trick as
        // dueDate above. Undefined (no track) stays undefined.
        writingDueDate:
          card.writingDueDate !== undefined ? card.writingDueDate - 1 : undefined,
        writingFsrsState: card.writingFsrsState,
        writingIsGraduated: card.writingIsGraduated,
        writingLastReviewedAt: card.writingLastReviewedAt,
        writingGoodReviewCount: card.writingGoodReviewCount,
        // Per-mode review history, same rationale as goodReviewCount and the
        // play counters above: an edit must not reset it. There is no backfill
        // for these counters, so a drop here is unrecoverable, and it would
        // also silently disable undo's decrement, which no-ops when the field
        // is undefined.
        reviewCountByMode: card.reviewCountByMode,
        wordsTrackedLanguages: card.wordsTrackedLanguages,
        searchableText,
        searchableTextLanguages,
      });

      // The replacement is the same logical card, so its accepted
      // alternatives move with it; `deleteCard` below drains whatever is
      // still attached to the old id (that drain is for REAL deletions).
      await migrateWritingAlternatives(ctx, args.cardId, resolvedCardId);
      await deleteCard(ctx, args.cardId);
    }
    // Defensive cleanup: if the edit left the old text orphaned and user-created
    // (path A reuses the textId, so the new card normally still references it.
    // This is a no-op then), drop its now-unreferenced translations/audio/blobs.
    await cascadeCleanupTextIfOrphaned(ctx, card.textId);

    // Update word-text links for changed languages (only if words were previously tracked)
    if (card.wordsTrackedLanguages && card.wordsTrackedLanguages.length > 0) {
      const changedLangTexts: Array<{ language: string; text: string }> = [];
      for (const lang of changedLanguages) {
        const submitted = submittedMap.get(lang);
        if (submitted) changedLangTexts.push({ language: lang, text: submitted });
      }
      if (changedLangTexts.length > 0) {
        await updateWordTextsForEdit(ctx, {
          userId,
          courseId: course._id,
          textId: resolvedTextId,
          languages: changedLangTexts,
        });
      }
    }

    // Trigger TTS + romanization for changed languages
    await scheduleMissingContent(
      ctx,
      resolvedTextId,
      resolvedText,
      course.baseLanguages,
      course.targetLanguages,
    );

    // Path B pointed the card and text at brand-new rows; the audit row still
    // holds the before-ids for both. Path A never moved either.
    if (
      cardEditId !== undefined &&
      (resolvedCardId !== args.cardId || resolvedTextId !== card.textId)
    ) {
      await setCardEditResult(ctx, cardEditId, {
        cardIdAfter: resolvedCardId,
        textIdAfter: resolvedTextId,
      });
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

    return { textId: resolvedTextId, cardId: resolvedCardId, changed: true, course };
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
