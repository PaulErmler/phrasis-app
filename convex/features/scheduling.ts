import { v, ConvexError } from 'convex/values';
import { mutation, query, MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { buildCardSearchableText } from '../lib/cardContent';
import { Id, Doc } from '../_generated/dataModel';
import { getAuthUserId, requireAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getCourseSettings } from '../db/courseSettings';
import { getCollectionProgress } from '../db/collections';
import { getDeckByCourseId } from '../db/decks';
import { trackEvent } from '../db/stats/dailyStats';
import { updateWordTextsForEdit } from '../db/stats/wordTracking';
import { recordReviewStats } from '../db/stats/recordReviewStats';
import { recordRadioPlayStats } from '../db/stats/recordRadioPlayStats';
import {
  reverseReviewStats,
  reverseRadioPlayStats,
  readTodayCounters,
} from '../db/stats/reverseReviewStats';
import { logReview, takeUndoableLogs } from '../db/reviewLogs';
import {
  getDailyStats,
  floorToCelebration,
  displayedActiveReviews,
} from '../db/stats/dailyStats';
import { patchCard, insertCard, deleteCard } from '../db/stats/cardAggregates';
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
} from '../types';
import { PROGRESS_DISPLAY_INTERVAL } from '../../lib/constants/learning';
import { settledCount } from '../lib/collections';
import { getTodayInTimezone } from '../lib/dateUtils';
import {
  getAudioForText,
  deleteAudioRow,
  deleteAudioRowsForTextLanguage,
} from '../lib/audio';
import { soundsSame } from '../lib/textComparison';
import {
  ROMANIZATION_LANGUAGES,
  USER_PROVIDED_TRANSLATION_SOURCE,
  FLAG_AUTO_RETRANSLATION_MAX,
} from '../../lib/languages';
import { consumeQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { scheduleMissingContent } from './decks';
import {
  claimLlmTranslationIfAvailable,
  CLAIM_STALE_MS as LLM_CLAIM_STALE_MS,
} from './llmTranslationQueue';
import { MAX_CARD_TEXT_LENGTH } from '../../lib/constants/learning';
import {
  CARD_OVERRIDE_SPEED_MIN,
  CARD_OVERRIDE_SPEED_MAX,
} from '../../lib/constants/audioPlayback';

/**
 * A fresh, uniform-random integer used as the radio-mode tiebreak. Re-rolled
 * on every `advanceRadioCard` so each round-robin loop visits cards in a
 * different order. After the first full loop, the order is also fully
 * decoupled from review's `dueDate`-driven sequence; for decks that pre-date
 * this field, every card starts with `radioOrderKey === undefined` and the
 * very first loop falls back to `_creationTime` order until each card has
 * been played once. 32-bit space gives collision-free tiebreaking in any
 * plausible deck size.
 */
function randomRadioOrderKey(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * Authenticate the user and verify ownership of a card via deck → course.
 * Throws ConvexError on failure.
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
  hasMissingContent: v.boolean(),
  audioSpeedOverrides: v.optional(v.record(v.string(), v.number())),
};

const cardResultValidator = v.object(cardResultFields);

type SchedulingMode = 'learn_new' | 'learnAndReview' | 'radio';
type StudyContentFilter = 'custom' | 'course' | 'both';

/**
 * Fetch the top-K due cards for a scheduling mode, honoring the
 * content-source filter. Filter semantics:
 *   - 'both' / undefined : existing indexes, no origin filtering.
 *   - 'course'           : single origin-keyed query with origin='premade'.
 *   - 'custom'           : two origin-keyed queries (origin='custom' and
 *                          origin='chat') merged by the mode's sort key.
 *
 * Cards inserted before the origin backfill won't match the new indexes;
 * they're handled by the fallback unfiltered query in the 'both' branch.
 */
async function fetchDueCardsWithFilter(
  ctx: QueryCtx,
  deckId: Id<'decks'>,
  schedulingMode: SchedulingMode,
  filter: StudyContentFilter,
  now: number,
  take: number,
): Promise<Doc<'cards'>[]> {
  if (filter === 'both') {
    if (schedulingMode === 'learn_new') {
      return ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_graduated_due', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('isGraduated', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(take);
    }
    if (schedulingMode === 'radio') {
      return ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_radioCounter_radioOrder', (q) =>
          q.eq('deckId', deckId).eq('isHidden', false).eq('isMastered', false),
        )
        .order('asc')
        .take(take);
    }
    return ctx.db
      .query('cards')
      .withIndex('by_deckId_and_isHidden_and_isMastered_and_dueDate', (q) =>
        q
          .eq('deckId', deckId)
          .eq('isHidden', false)
          .eq('isMastered', false)
          .lte('dueDate', now),
      )
      .order('asc')
      .take(take);
  }

  // Filtered path: run one query per allowed origin and merge results.
  const allowedOrigins: Array<'premade' | 'custom' | 'chat'> =
    filter === 'course' ? ['premade'] : ['custom', 'chat'];
  const perOriginResults = await Promise.all(
    allowedOrigins.map((origin) => {
      if (schedulingMode === 'learn_new') {
        return ctx.db
          .query('cards')
          .withIndex('by_deck_hidden_mastered_origin_graduated_due', (q) =>
            q
              .eq('deckId', deckId)
              .eq('isHidden', false)
              .eq('isMastered', false)
              .eq('collectionOrigin', origin)
              .eq('isGraduated', false)
              .lte('dueDate', now),
          )
          .order('asc')
          .take(take);
      }
      if (schedulingMode === 'radio') {
        return ctx.db
          .query('cards')
          .withIndex('by_deck_hidden_mastered_origin_radioCounter_radioOrder', (q) =>
            q
              .eq('deckId', deckId)
              .eq('isHidden', false)
              .eq('isMastered', false)
              .eq('collectionOrigin', origin),
          )
          .order('asc')
          .take(take);
      }
      return ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_origin_dueDate', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('collectionOrigin', origin)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(take);
    }),
  );

  // Merge by the mode's sort key (radio: counter+order; else: dueDate),
  // tiebreak by _creationTime to mirror Convex's default index ordering.
  const merged = perOriginResults.flat();
  if (schedulingMode === 'radio') {
    merged.sort((a, b) => {
      const ca = a.radioRoundCounter ?? 0;
      const cb = b.radioRoundCounter ?? 0;
      if (ca !== cb) return ca - cb;
      const oa = a.radioOrderKey ?? Number.POSITIVE_INFINITY;
      const ob = b.radioOrderKey ?? Number.POSITIVE_INFINITY;
      if (oa !== ob) return oa - ob;
      return a._creationTime - b._creationTime;
    });
  } else {
    merged.sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
      return a._creationTime - b._creationTime;
    });
  }
  return merged.slice(0, take);
}

export const getCardForReview = query({
  // `timezone` is optional so callers that don't care about the daily-count
  // side-channel (tests, the layout warm-up) can still call `{}`. The learn
  // view always supplies it so the in-learn progress bar can subscribe to
  // today's active review count via this single query — no separate
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
       * invalidates once per review — not this query plus a separate
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
    const schedulingMode: SchedulingMode = settings?.schedulingMode ?? 'learnAndReview';
    const studyContentFilter: StudyContentFilter = settings?.studyContentFilter ?? 'both';

    const now = Date.now();

    // Fetch the current + peeked-next due cards so the client can pre-merge
    // audio for the upcoming card while the user is still on the current one.
    const dueCards = await fetchDueCardsWithFilter(
      ctx,
      deck._id,
      schedulingMode,
      studyContentFilter,
      now,
      2,
    );
    if (dueCards.length === 0) return null;

    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];

    const buildCardResult = async (card: Doc<'cards'>) => {
      const text = await ctx.db.get(card.textId);
      if (!text) return null;

      const sourceLanguage = text.language;

      const audioRecordings = await getAudioForText(ctx, card.textId, allLanguages);

      // Per-language LLM-claim lookup. A non-stale row in
      // `llmTranslationClaims` means a `flagTranslation`-triggered LLM
      // retranslation is currently in flight; the "Retranslating" pill
      // keys off this rather than "audio is missing" so it doesn't fire
      // when the user clicks "regenerate audio" (no LLM phase).
      const claimsByLang = new Map<string, number | null>();
      await Promise.all(
        allLanguages.map(async (lang) => {
          const claim = await ctx.db
            .query('llmTranslationClaims')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', card.textId).eq('targetLanguage', lang),
            )
            .first();
          claimsByLang.set(lang, claim?.claimedAt ?? null);
        }),
      );

      const translations = await Promise.all(
        allLanguages.map(async (lang) => {
          if (lang === sourceLanguage) {
            return {
              language: lang,
              text: text.text,
              isBaseLanguage: course.baseLanguages.includes(lang),
              isTargetLanguage: course.targetLanguages.includes(lang),
              romanization: text.romanizedText ?? undefined,
              retranslating: false,
            };
          }
          const translation = await ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', card.textId).eq('targetLanguage', lang),
            )
            .first();
          const translatedText = translation?.translatedText || '';
          const claimedAt = claimsByLang.get(lang) ?? null;
          const llmClaimHeld =
            claimedAt !== null &&
            Date.now() - claimedAt < LLM_CLAIM_STALE_MS;
          // Show the pill only for *re*translations — first-time
          // translations of new cards also hold a claim, but there's no
          // prior text to retranslate from, so the pill would be confusing
          // pre-translation. Gate on `translatedText` being non-empty.
          return {
            language: lang,
            text: translatedText,
            isBaseLanguage: course.baseLanguages.includes(lang),
            isTargetLanguage: course.targetLanguages.includes(lang),
            romanization: translation?.romanizedText ?? undefined,
            retranslating: llmClaimHeld && translatedText.length > 0,
          };
        }),
      );

      const hasMissingTranslation = translations.some(
        (tr) => tr.language !== sourceLanguage && !tr.text,
      );
      const hasMissingAudio = audioRecordings.some((a) => !a.url);
      const hasMissingRomanization = translations.some(
        (tr) => ROMANIZATION_LANGUAGES.has(tr.language) && !tr.romanization,
      );

      return {
        _id: card._id,
        _creationTime: card._creationTime,
        textId: card.textId,
        sourceText: text.text,
        sourceLanguage,
        translations,
        audioRecordings,
        dueDate: card.dueDate,
        isMastered: card.isMastered,
        isHidden: card.isHidden,
        isFavorite: card.isFavorite ?? false,
        schedulingPhase: card.schedulingPhase,
        preReviewCount: card.preReviewCount,
        initialReviewCount,
        fsrsState: card.fsrsState ?? null,
        radioPlayCount: card.radioPlayCount,
        hasMissingContent: hasMissingTranslation || hasMissingAudio || hasMissingRomanization,
        audioSpeedOverrides: card.audioSpeedOverrides,
      };
    };

    const [current, next] = await Promise.all([
      buildCardResult(dueCards[0]),
      dueCards[1] ? buildCardResult(dueCards[1]) : Promise.resolve(null),
    ]);

    if (!current) return null;

    // Today's active (non-radio) review count — same audio+full sum used by
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

    // Undo stack depth under the CURRENT study context — shares
    // takeUndoableLogs with undoLastReview so the button and the mutation
    // can't disagree.
    const undoable = await takeUndoableLogs(
      ctx,
      userId,
      course._id,
      schedulingMode,
      studyContentFilter,
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
 *                          • `currentSourceHasAnyCards` — does the user have
 *                            ANY cards in the source they're filtering to?
 *                            (false ⇒ they need to add cards, not just
 *                            wait for them to come due).
 *                          • `availableInOtherSource`  — does the OTHER
 *                            source have at least one due card right now?
 *   - 'all_caught_up'  : the deck has cards but none are due right now
 *                        (filter not the cause).
 */
/**
 * True iff any of the user's active custom collections has at least one text
 * the deck hasn't pulled in yet. The auto-add Phase 1 (custom/chat) consumes
 * no `SENTENCES` quota, so when this returns `true` the user can still get
 * more cards without paying — the UI must NOT show the upgrade button in
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
    if (coll.textCount > settledCount(prog)) return true;
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
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { reason: 'no_session' as const };

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { reason: 'no_session' as const };

    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return { reason: 'no_session' as const };

    const settings = await getCourseSettings(ctx, active.course._id);
    const schedulingMode: SchedulingMode = settings?.schedulingMode ?? 'learnAndReview';
    const studyContentFilter: StudyContentFilter = settings?.studyContentFilter ?? 'both';
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
    //      not, the user must add — flipping the filter alone won't help in
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
      otherFilter,
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
    // present — see recordReviewStats.
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

    // When forceReviewPhase is true (full review mode), treat the card as
    // being in the 'review' phase so FSRS ratings are accepted directly.
    const phase = args.forceReviewPhase ? 'review' as const : card.schedulingPhase;
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

    // Build current scheduling state
    const cardState: CardSchedulingState = {
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
    // into the single patchCard call below — `recordReviewStats` reads `card`
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
      rating: args.rating,
      accuracy: args.accuracy,
      accuracyStrict: args.accuracyStrict,
      accuracyLenient: args.accuracyLenient,
      wasDefaultRating: args.wasDefaultRating,
      text,
      sessionId: args.sessionId,
    });

    // Patch the card (via aggregate-aware helper). We pass `card` as oldDoc so
    // patchCard can skip both the pre- and post-patch reads.
    await patchCard(
      ctx,
      args.cardId,
      {
        schedulingPhase: result.schedulingPhase,
        preReviewCount: result.preReviewCount,
        dueDate: dueDateWithJitter,
        lastReviewedAt: Date.now(),
        ...searchableTextPatch,
        ...(result.fsrsState && { fsrsState: result.fsrsState }),
        ...isGraduatedPatch,
        ...(newWordsTrackedLanguages
          ? { wordsTrackedLanguages: newWordsTrackedLanguages }
          : {}),
      },
      card,
    );

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
      prevCard: {
        dueDate: card.dueDate,
        schedulingPhase: card.schedulingPhase,
        preReviewCount: card.preReviewCount,
        fsrsState: card.fsrsState,
        isGraduated: card.isGraduated,
        lastReviewedAt: card.lastReviewedAt,
      },
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
        reviewDepth:
          args.accuracy != null
            ? card.preReviewCount + (card.fsrsState?.reps ?? 0) + 1
            : undefined,
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
 * counting stats — time spent, streak, and word tracking stay (the learning
 * genuinely happened; see `reverseReviewStats`). Restoring the snapshot
 * `dueDate` (or radio counters) deterministically makes the card the next one
 * served, since it was at the front of the queue when it was reviewed and
 * reviews only ever push cards backward.
 *
 * Cards hidden or mastered since the review are still undone (so the user can
 * unhide/unmaster and continue where they were) — only deleted cards are
 * skipped. Returns `nothing_to_undo` instead of throwing when the stack is
 * empty: two devices racing over the same stack is expected, not an error.
 */
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
    const schedulingMode: SchedulingMode = settings?.schedulingMode ?? 'learnAndReview';
    const studyContentFilter: StudyContentFilter = settings?.studyContentFilter ?? 'both';

    const undoable = await takeUndoableLogs(
      ctx,
      userId,
      course._id,
      schedulingMode,
      studyContentFilter,
    );

    for (const log of undoable) {
      const card = await ctx.db.get(log.cardId);
      if (!card) {
        // Card deleted since the review — nothing to restore, and deletion
        // never reverses stat contributions elsewhere either. Discard and
        // fall through to the next entry.
        await ctx.db.delete(log._id);
        continue;
      }

      if (log.kind === 'review' && log.prevCard) {
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
          },
          card,
        );
        await reverseReviewStats(ctx, { userId, courseId: course._id, log });
      } else if (log.kind === 'radio' && log.prevRadio) {
        await patchCard(
          ctx,
          log.cardId,
          {
            radioRoundCounter: log.prevRadio.radioRoundCounter,
            radioOrderKey: log.prevRadio.radioOrderKey,
            radioPlayCount: log.prevRadio.radioPlayCount,
            lastReviewedAt: log.prevRadio.lastReviewedAt,
          },
          card,
        );
        await reverseRadioPlayStats(ctx, { userId, courseId: course._id, log });
      } else {
        // Malformed entry (kind without its snapshot) — discard defensively.
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
 * The learn view no longer subscribes to this — it reads the bundled
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
      settings?.schedulingMode ?? 'learnAndReview',
      settings?.studyContentFilter ?? 'both',
    );
    return undoable.length;
  },
});

/**
 * Master a card — marks `isMastered: true` so it no longer appears for review.
 */
export const masterCard = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { card } = await authorizeCardAccess(ctx, args.cardId);
    await patchCard(ctx, args.cardId, { isMastered: true }, card);
    return null;
  },
});

/**
 * Hide a card — marks `isHidden: true` so it no longer appears for review.
 */
export const hideCard = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { card } = await authorizeCardAccess(ctx, args.cardId);
    await patchCard(ctx, args.cardId, { isHidden: true }, card);
    return null;
  },
});

/**
 * Delete a text's translations + audio (rows AND storage blobs) and the text
 * row itself — but ONLY when the text is user-created AND no card references it
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
 * enforces course ownership — so the `userCreated` guard below is sufficient and
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
    const { card } = await authorizeCardAccess(ctx, args.cardId);
    const textId = card.textId;
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
 * Advance to the next card in radio mode.
 *
 * Bumps the card's `radioRoundCounter` so the next-lowest counter rises to
 * the front, re-rolls `radioOrderKey` so the round-robin shuffles every loop
 * (and stays decoupled from the review/dueDate order), and records radio
 * playtime in the per-mode stats.
 *
 * Catch-up rule: a brand-new card (counter 0) joining a deck whose other
 * cards are all at e.g. 100 should not replay 99 more times. After playing,
 * its counter jumps to `max(picked, floorOfOthers) + 1` so it lands one
 * step past the rest of the deck — strictly above every other playable
 * card. This guarantees the just-played card is never re-picked as the
 * next card while any other playable card exists (the random `radioOrderKey`
 * tiebreak only kicks in at equal counters, which can no longer include
 * the played card).
 *
 * Stats: writes `dailyStats.reviewsByMode.radio` + `timeMsByMode.radio` and
 * the equivalent rollups, plus `courseStats.totalReviewsByMode.radio` and
 * the streak. Word tracking, FSRS state, accuracy, ratings, and collection
 * progress are explicitly skipped — radio is passive listening.
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
    const { userId, card, deck } = await authorizeCardAccess(ctx, args.cardId);

    // Fetch the two lowest-counter playable cards. The first should be the
    // card we just played; the second tells us the floor that the played
    // card needs to catch up to.
    const lowestTwo = await ctx.db
      .query('cards')
      .withIndex('by_deck_hidden_mastered_radioCounter_radioOrder', (q) =>
        q
          .eq('deckId', deck._id)
          .eq('isHidden', false)
          .eq('isMastered', false),
      )
      .order('asc')
      .take(2);

    const pickedCounter = card.radioRoundCounter ?? 0;
    // Identify the floor card — the second-lowest, excluding `card` itself.
    // If the just-played card is no longer the lowest (e.g. it was favorited
    // or another tab advanced concurrently), `lowestTwo[0]` may differ from
    // `card`; in that case the floor is whichever of the two is not `card`.
    const floorCard = lowestTwo.find((c) => c._id !== card._id) ?? null;
    const floorCounter = floorCard ? (floorCard.radioRoundCounter ?? 0) : pickedCounter;
    // Land strictly above the floor so the played card cannot tie with the
    // rest of the round; combined with ascending counter ordering this rules
    // out an immediate repeat as long as ≥1 other playable card exists.
    const newCounter = Math.max(pickedCounter, floorCounter) + 1;

    // Separate from radioRoundCounter (a rotation position subject to the
    // catch-up jump above): a true +1-per-play count for the "Only new"
    // Practice-Listening limit. Seed from the card's review count for cards that
    // predate the field so an already-practiced card doesn't reset to "new".
    const reviewCount = card.preReviewCount + (card.fsrsState?.reps ?? 0);
    const newPlayCount = (card.radioPlayCount ?? reviewCount) + 1;

    await patchCard(
      ctx,
      args.cardId,
      {
        radioRoundCounter: newCounter,
        radioPlayCount: newPlayCount,
        // Re-roll the random tiebreak each play so the order changes between
        // loops and never aligns with the review (`dueDate`-driven) order.
        radioOrderKey: randomRadioOrderKey(),
        lastReviewedAt: Date.now(),
      },
      card,
    );

    await recordRadioPlayStats(ctx, {
      userId,
      courseId: deck.courseId,
      timezone: args.timezone,
      timeSpentMs: args.timeSpentMs,
    });

    // Log the play for the learn-mode undo stack. Restoring the pre-play
    // rotation state puts this card back at the front (advancing only ever
    // raises counters, so nothing can have slotted in below it since).
    const radioSettings = await getCourseSettings(ctx, deck.courseId);
    await logReview(ctx, {
      userId,
      courseId: deck.courseId,
      cardId: args.cardId,
      reviewedAt: Date.now(),
      timezone: args.timezone,
      kind: 'radio',
      date: getTodayInTimezone(args.timezone),
      schedulingMode: 'radio',
      studyContentFilter: radioSettings?.studyContentFilter ?? 'both',
      prevRadio: {
        radioRoundCounter: card.radioRoundCounter,
        radioOrderKey: card.radioOrderKey,
        radioPlayCount: card.radioPlayCount,
        lastReviewedAt: card.lastReviewedAt,
      },
    });

    return { nextRadioRoundCounter: newCounter };
  },
});

/**
 * Whether the user's active deck has at least one playable card
 * (non-hidden, non-mastered). Used by the home screen to gate the Radio
 * mode button — radio is meaningless on an empty deck.
 *
 * Uses the minimal `by_deckId_and_isHidden_and_isMastered` index: radio
 * doesn't care about due-ness, and a trailing field like `dueDate`,
 * `lastReviewedAt`, or the radio counters would needlessly broaden the
 * read set and refire the subscription every time those fields change.
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
 * Toggle a card's favorite state — flips `isFavorite` between true and false.
 */
export const toggleFavoriteCard = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { card } = await authorizeCardAccess(ctx, args.cardId);
    await patchCard(
      ctx,
      args.cardId,
      { isFavorite: !(card.isFavorite ?? false) },
      card,
    );
    return null;
  },
});

/** Maximum auto-retranslations per flagged row. Shared with the card queries
 * (which use it to decide between "Retranslating" vs "Flagged" pill state). */
const FLAG_RETRANSLATION_MAX = FLAG_AUTO_RETRANSLATION_MAX;

/**
 * Flag a card as having bad translation content. The user sees a single
 * "Flag" affordance on the card; we then increment `flagCount` on every
 * non-source-language `translations` row for that card's text, and enqueue
 * a retranslation for each one whose post-increment count is within
 * `FLAG_RETRANSLATION_MAX` AND whose language is part of the user's
 * course. Counts past the cap still increment the counter (for later
 * admin triage) but skip the retranslation work to bound cost.
 *
 * Routing per text: curriculum (premade-dataset) texts use
 * `retranslation_high` (Pro-medium). User-created custom texts are
 * **flagged without retranslation** — the LLM has no curated source of
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
 * the whole mutation rolls back — counters and any prior claim/audio
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
    // removed from their course — we shouldn't bump flagCount on those.
    const cardLanguages = Array.from(
      new Set([...course.baseLanguages, ...course.targetLanguages]),
    ).filter((lang) => lang !== text.language);

    if (cardLanguages.length === 0) {
      return { retranslated: false };
    }

    // Parallel indexed reads — one per language, each O(1) via the
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
    // have a translation in that language yet — nothing to flag).
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

    // Custom-text flag policy: increment counters but never auto-retranslate.
    // Custom texts have no curated source of truth — the LLM would only be
    // second-guessing the user's own content. Flagging surfaces them in the
    // "Flagged" UI pill for the user and admin triage; that's the full
    // workflow. No quota charge, no audio invalidation, no enqueue.
    if (text.userCreated) {
      return { retranslated: false };
    }

    // 2) Filter to rows still under-cap. Over-cap rows already had their
    // counter bumped above but skip the enqueue + quota path. All rows are
    // guaranteed in-course because we fetched from the course's language
    // set above.
    const enqueueable = withCounts.filter(
      ({ nextCount }) => nextCount <= FLAG_RETRANSLATION_MAX,
    );

    if (enqueueable.length === 0) {
      // Everything was over-cap. Counters incremented, no quota charge,
      // no retranslations.
      return { retranslated: false };
    }

    // Curriculum-only path: user-created texts already short-circuited above.
    const ruleOverride = 'retranslation_high';

    // 3) Per-language: claim slot, charge quota on first success only,
    // delete stale audio, enqueue retranslation. Claim-contested rows
    // skip silently (something else is already retranslating them).
    let anyEnqueued = false;
    let quotaCharged = false;

    for (const { tr } of enqueueable) {
      const lang = tr.targetLanguage;

      const claimId = await claimLlmTranslationIfAvailable(
        ctx,
        card.textId,
        lang,
      );
      if (!claimId) continue;

      // Charge quota once total — on the first successful claim. If the
      // user is depleted, this throws USAGE_LIMIT and the whole mutation
      // rolls back (counters, claim row, audio deletes).
      if (!quotaCharged) {
        await consumeQuota(ctx, userId, FEATURE_IDS.TRANSLATION_FLAGS);
        quotaCharged = true;
      }

      // Audio is deliberately NOT deleted here: before the LLM lands we
      // can't know whether the retranslation is audibly different. The
      // decision lives in storeTranslationAndScheduleTTS's replaceExisting
      // branch, which has old + new text in hand — it keeps the audio when
      // the change is punctuation-only (`soundsSame`) and deletes + re-
      // enqueues TTS otherwise.

      await ctx.runMutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        {
          args: {
            textId: card.textId,
            sourceLanguage: text.language,
            targetLanguage: lang,
            text: text.text,
            audioSpeakerGender: text.audioSpeakerGender,
            ruleOverride,
            // Deliberate retranslation — overwrite the existing translation
            // row (and its romanization) once the LLM lands.
            replaceExisting: true,
          },
        },
      );
      anyEnqueued = true;
    }

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

    await scheduleMissingContent(
      ctx,
      card.textId,
      text,
      course.baseLanguages,
      course.targetLanguages,
    );

    return null;
  },
});

/**
 * Edit the translations of a card.
 *
 * Creates a replacement card with identical scheduling stats but updated text.
 * Two paths:
 *   A) User-owned text — patches rows in place, reuses textId.
 *   B) Shared/dataset text — creates new textId, copies unchanged content.
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
    const { userId, card, course } = await authorizeCardAccess(ctx, args.cardId);

    const text = await ctx.db.get(card.textId);
    if (!text) throw new ConvexError('Text not found');

    // Narrow the card's resolved voice gender once for stamping onto the
    // translation rows below. `texts.audioSpeakerGender` is typed as a loose
    // string but is always 'male' | 'female' in practice; the stamped
    // `translations.speakerGender` field is strict.
    const audioGenderStamp = asVoiceGender(text.audioSpeakerGender);

    const sourceLanguage = text.language;
    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];

    // Load existing translations for non-source languages
    const existingTranslations = await Promise.all(
      allLanguages
        .filter((lang) => lang !== sourceLanguage)
        .map((lang) =>
          ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', card.textId).eq('targetLanguage', lang),
            )
            .first(),
        ),
    );
    const existingTranslationMap = new Map<string, Doc<'translations'>>();
    allLanguages
      .filter((lang) => lang !== sourceLanguage)
      .forEach((lang, i) => {
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

    if (changedLanguages.size === 0) return null;

    // Audio-relevant subset of the diff: an edit that only touches
    // punctuation/'_' (`soundsSame`) sounds identical spoken aloud, so the
    // language keeps its audio — Path A skips the delete, Path B copies the
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
    await consumeQuota(ctx, userId, FEATURE_IDS.CARD_EDITS);

    // Track card edit event
    await trackEvent(ctx, { userId, courseId: course._id, timezone: args.timezone, field: 'cardsEdited' });

    const isUserOwned = text.userCreated && text.userId === userId;
    let resolvedTextId: Id<'texts'>;

    if (isUserOwned) {
      // Path A: modify in place
      resolvedTextId = card.textId;

      if (changedLanguages.has(sourceLanguage)) {
        await ctx.db.patch(text._id, {
          text: submittedMap.get(sourceLanguage)!,
          romanizedText: undefined,
        });
      }

      for (const lang of allLanguages) {
        if (lang === sourceLanguage) continue;
        if (!changedLanguages.has(lang)) continue;
        const existing = existingTranslationMap.get(lang);
        if (existing) {
          // User edited an existing translation — drop the romanization (it
          // doesn't match the new text), drop the old romanization source,
          // and re-tag as user-provided so a future strategy swap doesn't
          // overwrite the user's edit.
          await ctx.db.patch(existing._id, {
            translatedText: submittedMap.get(lang)!,
            romanizedText: undefined,
            romanizationSource: undefined,
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

      // Delete audio recordings for audibly-changed languages only —
      // punctuation-only edits keep their audio.
      for (const lang of audioChangedLanguages) {
        await deleteAudioRowsForTextLanguage(ctx, card.textId, lang);
      }
    } else {
      // Path B: create new textId, copy unchanged content
      const submittedSource = submittedMap.get(sourceLanguage);
      const sourceChanged = changedLanguages.has(sourceLanguage);
      const newTextId = await ctx.db.insert('texts', {
        text: sourceChanged && submittedSource ? submittedSource : text.text,
        language: text.language,
        romanizedText: sourceChanged ? undefined : text.romanizedText,
        // Source travels with the value: copy when unchanged (so we keep
        // pointing at whichever romanizer produced the carried-over text);
        // drop when changed (next ensureContent will re-romanize and tag).
        romanizationSource: sourceChanged ? undefined : text.romanizationSource,
        userCreated: true,
        userId,
        collectionId: text.collectionId,
        collectionRank: text.collectionRank,
        // This row is a logical copy of `text` — the user only edited
        // translations, not the source — so preserve all pipeline-derived
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
      //   - User-edited rows: tag as `'user-provided'`; carry no romanization.
      //   - Unchanged rows: copy `translatedText` + `translationSource` + (if
      //     present) `romanizedText` + `romanizationSource` so we don't lose
      //     the original tags on the logical-copy operation.
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
          ...(changed
            ? {}
            : existing?.romanizedText !== undefined
              ? {
                romanizedText: existing.romanizedText,
                ...(existing.romanizationSource
                  ? { romanizationSource: existing.romanizationSource }
                  : {}),
              }
              : {}),
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

      // Copy audio recordings for languages whose audio is still valid —
      // unchanged ones AND punctuation-only edits (audibly identical).
      for (const lang of allLanguages) {
        if (audioChangedLanguages.has(lang)) continue;
        const audioRows = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('language', lang),
          )
          .take(20);
        for (const row of audioRows) {
          await ctx.db.insert('audioRecordings', {
            textId: newTextId,
            language: row.language,
            voiceName: row.voiceName,
            storageId: row.storageId,
            ttsQuality: row.ttsQuality,
            ttsProvider: row.ttsProvider,
            voiceGender: row.voiceGender,
            speed: row.speed,
            wordTimings: row.wordTimings,
            // Carry the SOURCE row's ttsVersion stamp on the copy. Without it the
            // copy lands undefined ("=== current, never stale") and permanently
            // escapes the version sweep — so genuinely-stale source audio (e.g. a
            // pt_pt row stamped below the bumped ttsVersion) would be laundered
            // onto the new text and never regenerate. Copying the source stamp
            // (not the current version) preserves staleness so it regenerates.
            ...(row.ttsVersion !== undefined ? { ttsVersion: row.ttsVersion } : {}),
          });
        }
      }
    }

    // Build searchable text for the new card
    const resolvedText = await ctx.db.get(resolvedTextId);
    if (!resolvedText) throw new ConvexError('Resolved text not found');

    const courseLanguages = [...course.baseLanguages, ...course.targetLanguages];
    const { searchableText, searchableTextLanguages } =
      await buildCardSearchableText(ctx, resolvedTextId, resolvedText.text, courseLanguages);

    // Insert replacement card with identical scheduling stats.
    // Subtract 1ms from dueDate so this card sorts before any other card that
    // happens to share the exact same dueDate (Convex uses _creationTime as the
    // tiebreaker within equal index values, and the new doc would otherwise sort
    // last, causing a different card to be returned by getCardForReview).
    await insertCard(ctx, {
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
      radioRoundCounter: card.radioRoundCounter ?? 0,
      // Preserve the true radio play-count so an in-place edit doesn't reset the
      // "Only new" graduation (undefined for cards that predate the field).
      radioPlayCount: card.radioPlayCount,
      // Preserve the existing tiebreak so the edited card keeps its place in
      // the radio rotation (or take a fresh random one if the original card
      // predates this field).
      radioOrderKey: card.radioOrderKey ?? randomRadioOrderKey(),
      fsrsState: card.fsrsState,
      lastReviewedAt: card.lastReviewedAt,
      wordsTrackedLanguages: card.wordsTrackedLanguages,
      searchableText,
      searchableTextLanguages,
    });

    // Delete old card
    await deleteCard(ctx, args.cardId);
    // Defensive cleanup: if the edit left the old text orphaned and user-created
    // (path A reuses the textId, so the new card normally still references it —
    // this is a no-op then), drop its now-unreferenced translations/audio/blobs.
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

    return null;
  },
});
