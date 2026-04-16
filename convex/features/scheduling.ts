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
import { getAudioForText } from '../lib/audio';
import { ROMANIZATION_LANGUAGES } from '../../lib/languages';
import { consumeQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { scheduleMissingContent } from './decks';
import { MAX_CARD_TEXT_LENGTH } from '../../lib/constants/learning';

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
export const getCardForReview = query({
  args: {},
  returns: v.union(
    v.object({
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

    // Get the next due card based on scheduling mode
    let card;
    if (schedulingMode === 'learn_new') {
      // Learn mode: only cards that haven't graduated (still in initial learning cycle)
      card = await ctx.db
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
        .first();
    } else {
      // Learn+Review mode: all due cards (current behavior)
      card = await ctx.db
        .query('cards')
        .withIndex('by_deckId_and_isHidden_and_isMastered_and_dueDate', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .first();
    }
    if (!card) return null;

    // Load text
    const text = await ctx.db.get(card.textId);
    if (!text) return null;

    const sourceLanguage = text.language;
    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];

    // Load translations
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
  },
  returns: v.object({
    schedulingPhase: schedulingPhaseValidator,
    preReviewCount: v.number(),
    dueDate: v.number(),
    phaseTransitioned: v.boolean(),
    fsrsState: v.union(fsrsStateValidator, v.null()),
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

    let searchableTextPatch: { searchableText: string; searchableTextLanguages: string[] } | undefined;
    if (searchableTextIsStale) {
      const text = await ctx.db.get(card.textId);
      if (text) {
        searchableTextPatch = await buildCardSearchableText(
          ctx,
          card.textId,
          text.text,
          courseLanguages,
        );
      }
    }

    // Flip isGraduated once the card reaches FSRS Review state (one-way flag)
    const isGraduatedPatch =
      !(card.isGraduated ?? false) && result.fsrsState && result.fsrsState.state >= 2
        ? { isGraduated: true as const }
        : {};

    // Patch the card (via aggregate-aware helper)
    await patchCard(ctx, args.cardId, {
      schedulingPhase: result.schedulingPhase,
      preReviewCount: result.preReviewCount,
      dueDate: dueDateWithJitter,
      lastReviewedAt: Date.now(),
      ...searchableTextPatch,
      ...(result.fsrsState && { fsrsState: result.fsrsState }),
      ...isGraduatedPatch,
    });

    // Record all stats for this review
    await recordReviewStats(ctx, {
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
    });

    return {
      schedulingPhase: result.schedulingPhase,
      preReviewCount: result.preReviewCount,
      dueDate: dueDateWithJitter,
      phaseTransitioned: result.phaseTransitioned,
      fsrsState: result.fsrsState,
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
    await authorizeCardAccess(ctx, args.cardId);
    await patchCard(ctx, args.cardId, { isMastered: true });
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
    await authorizeCardAccess(ctx, args.cardId);
    await patchCard(ctx, args.cardId, { isHidden: true });
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
    await authorizeCardAccess(ctx, args.cardId);
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new Error('Card not found');
    await patchCard(ctx, args.cardId, {
      isFavorite: !(card.isFavorite ?? false),
    });
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
