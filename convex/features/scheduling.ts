import { v, ConvexError } from 'convex/values';
import { mutation, query, MutationCtx } from '../_generated/server';
import { buildCardSearchableText } from '../lib/cardContent';
import { Id, Doc } from '../_generated/dataModel';
import { getAuthUserId, requireAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getCourseSettings } from '../db/courseSettings';
import { getDeckByCourseId } from '../db/decks';
import { trackEvent } from '../db/stats/dailyStats';
import { updateWordTextsForEdit } from '../db/stats/wordTracking';
import { recordReviewStats } from '../db/stats/recordReviewStats';
import { recordRadioPlayStats } from '../db/stats/recordRadioPlayStats';
import { patchCard, insertCard, deleteCard } from '../db/stats/cardAggregates';
import {
  scheduleCard,
  getValidRatings,
  DEFAULT_INITIAL_REVIEW_COUNT,
  type ReviewRating,
  type CardSchedulingState,
} from '../../lib/scheduling';
import {
  fsrsStateValidator,
  translationValidator,
  audioRecordingValidator,
  schedulingPhaseValidator
} from '../types';
import { PROGRESS_DISPLAY_INTERVAL } from '../../lib/constants/learning';
import { getAudioForText } from '../lib/audio';
import { ROMANIZATION_LANGUAGES } from '../../lib/languages';
import { consumeQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { scheduleMissingContent } from './decks';
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
  hasMissingContent: v.boolean(),
  audioSpeedOverrides: v.optional(v.record(v.string(), v.number())),
};

const cardResultValidator = v.object(cardResultFields);

export const getCardForReview = query({
  args: {},
  returns: v.union(
    v.object({
      ...cardResultFields,
      nextCard: v.union(cardResultValidator, v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const { course } = active;

    const deck = await getDeckByCourseId(ctx, course._id);
    if (!deck) return null;

    // Load settings (initialReviewCount + schedulingMode) from the courseSettings table
    const settings = await getCourseSettings(ctx, course._id);
    const initialReviewCount = settings?.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT;
    const schedulingMode = settings?.schedulingMode ?? 'learnAndReview';

    const now = Date.now();

    // Fetch the current + peeked-next due cards so the client can pre-merge
    // audio for the upcoming card while the user is still on the current one.
    let dueCards: Doc<'cards'>[];
    if (schedulingMode === 'learn_new') {
      // Learn mode: only cards that haven't graduated (still in initial learning cycle)
      dueCards = await ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_graduated_due', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('isGraduated', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(2);
    } else if (schedulingMode === 'radio') {
      // Radio mode: round-robin by radioRoundCounter, ignoring dueDate.
      // Lowest counter plays next; new cards (counter undefined → 0) jump to
      // the front. Convex tiebreaks equal index keys by _creationTime, which
      // is fine here — the play mutation's catch-up logic ensures fresh cards
      // don't monopolize the queue.
      dueCards = await ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_radioCounter_radioOrder', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false),
        )
        .order('asc')
        .take(2);
    } else {
      // Learn+Review mode: all due cards (current behavior)
      dueCards = await ctx.db
        .query('cards')
        .withIndex('by_deckId_and_isHidden_and_isMastered_and_dueDate', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(2);
    }
    if (dueCards.length === 0) return null;

    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];

    const buildCardResult = async (card: Doc<'cards'>) => {
      const text = await ctx.db.get(card.textId);
      if (!text) return null;

      const sourceLanguage = text.language;

      const translations = await Promise.all(
        allLanguages.map(async (lang) => {
          if (lang === sourceLanguage) {
            return {
              language: lang,
              text: text.text,
              isBaseLanguage: course.baseLanguages.includes(lang),
              isTargetLanguage: course.targetLanguages.includes(lang),
              romanization: text.romanizedText ?? undefined,
            };
          }
          const translation = await ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', card.textId).eq('targetLanguage', lang),
            )
            .first();
          return {
            language: lang,
            text: translation?.translatedText || '',
            isBaseLanguage: course.baseLanguages.includes(lang),
            isTargetLanguage: course.targetLanguages.includes(lang),
            romanization: translation?.romanizedText ?? undefined,
          };
        }),
      );

      const audioRecordings = await getAudioForText(ctx, card.textId, allLanguages);

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
        hasMissingContent: hasMissingTranslation || hasMissingAudio || hasMissingRomanization,
        audioSpeedOverrides: card.audioSpeedOverrides,
      };
    };

    const [current, next] = await Promise.all([
      buildCardResult(dueCards[0]),
      dueCards[1] ? buildCardResult(dueCards[1]) : Promise.resolve(null),
    ]);

    if (!current) return null;

    return { ...current, nextCard: next };
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
    rating: v.union(
      v.literal('stillLearning'),
      v.literal('understood'),
      v.literal('again'),
      v.literal('hard'),
      v.literal('good'),
      v.literal('easy'),
    ),
    timeSpentMs: v.optional(v.number()),
    timezone: v.string(),
    forceReviewPhase: v.optional(v.boolean()),
    reviewMode: v.optional(v.union(v.literal('audio'), v.literal('full'))),
    accuracy: v.optional(v.number()),
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

    if (args.accuracy != null && (args.accuracy < 0 || args.accuracy > 1 || !Number.isFinite(args.accuracy))) {
      throw new ConvexError('Invalid accuracy value, must be between 0 and 1');
    }

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

    // Server-side milestone verdict: client just respects this. Opt-out
    // setting defaults to enabled when undefined (matches the UI check
    // `progressDisplayEnabled !== false`).
    const progressDisplayEnabled = reviewSettings?.progressDisplayEnabled !== false;
    const triggerCelebration =
      progressDisplayEnabled &&
      dailyReviewsToday > 0 &&
      dailyReviewsToday % PROGRESS_DISPLAY_INTERVAL === 0;

    return {
      schedulingPhase: result.schedulingPhase,
      preReviewCount: result.preReviewCount,
      dueDate: dueDateWithJitter,
      phaseTransitioned: result.phaseTransitioned,
      fsrsState: result.fsrsState,
      dailyReviewsToday,
      dailyTimeMsToday,
      dailyNewWordsToday,
      triggerCelebration,
    };
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
 * Permanently delete a card. Unlike `hideCard`, this removes the card row
 * entirely (and its aggregate entries). Shared text/translations/audio rows
 * stay because other cards may reference them.
 */
export const deleteCardPermanently = mutation({
  args: {
    cardId: v.id('cards'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeCardAccess(ctx, args.cardId);
    await deleteCard(ctx, args.cardId);
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
 * its counter jumps to `max(picked + 1, floorOfOthers)` so it lands beside
 * the rest of the deck and rejoins the round-robin rotation.
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
    const newCounter = Math.max(pickedCounter + 1, floorCounter);

    await patchCard(
      ctx,
      args.cardId,
      {
        radioRoundCounter: newCounter,
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
          await ctx.db.patch(existing._id, {
            translatedText: submittedMap.get(lang)!,
            romanizedText: undefined,
          });
        } else {
          await ctx.db.insert('translations', {
            textId: card.textId,
            targetLanguage: lang,
            translatedText: submittedMap.get(lang)!,
          });
        }
      }

      // Delete audio recordings for changed languages
      for (const lang of changedLanguages) {
        const audioRows = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('language', lang),
          )
          .take(10);
        for (const row of audioRows) {
          await ctx.db.delete(row._id);
        }
      }
    } else {
      // Path B: create new textId, copy unchanged content
      const submittedSource = submittedMap.get(sourceLanguage);
      const sourceChanged = changedLanguages.has(sourceLanguage);
      const newTextId = await ctx.db.insert('texts', {
        text: sourceChanged && submittedSource ? submittedSource : text.text,
        language: text.language,
        romanizedText: sourceChanged ? undefined : text.romanizedText,
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

      // Create translations rows for all non-source languages
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
          ...(changed ? {} : existing?.romanizedText ? { romanizedText: existing.romanizedText } : {}),
        });
      }

      // Copy audio recordings for unchanged languages
      for (const lang of allLanguages) {
        if (changedLanguages.has(lang)) continue;
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
      dueDate: card.dueDate - 1,
      isMastered: card.isMastered,
      isHidden: card.isHidden,
      isFavorite: card.isFavorite,
      isGraduated: card.isGraduated ?? false,
      schedulingPhase: card.schedulingPhase,
      preReviewCount: card.preReviewCount,
      radioRoundCounter: card.radioRoundCounter ?? 0,
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
