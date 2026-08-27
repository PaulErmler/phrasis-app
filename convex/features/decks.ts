import { v } from 'convex/values';
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  internalAction,
} from '../_generated/server';
import {
  translationValidator,
  audioRecordingValidator,
  ttsPriorityValidator,
  llmPriorityValidator,
} from '../types';
import { vAnnotationKind } from '../lib/textAnnotations';
import {
  getDeckCardsHandler,
  getCollectionProgressQueryHandler,
  getActiveDifficultyLevelHandler,
  getUpcomingSentencesForLevelHandler,
} from './deckBrowse';
import {
  setActiveCollectionHandler,
  setActiveCollectionByLevelHandler,
  toggleCustomCollectionHandler,
  addCardsFromCollectionHandler,
  addSingleTextFromCollectionHandler,
} from './collectionCardAdding';
import {
  ensureCardContentHandler,
  ensureUpcomingCardsContentHandler,
  ensureUpcomingCardsContentAllModesHandler,
  prepareCardContentHandler,
  warmNextCollectionBatchHandler,
} from './deckContent';
import {
  getTranslationForTextLanguageHandler,
  processTranslationForCardArgs,
  processTranslationForCardHandler,
  storeTranslationAndScheduleTtsArgs,
  storeTranslationAndScheduleTTSHandler,
} from './translationPipeline';
import {
  processRomanizationForSourceTextHandler,
  processRomanizationForTranslationHandler,
  storeSourceAnnotationHandler,
  storeTranslationAnnotationHandler,
} from './annotationPipeline';
import { rebuildSearchableTextForTextHandler } from './searchRebuild';
import {
  storeAudioRecordingArgs,
  storeAudioRecordingHandler,
} from './audioStorage';

/**
 * Registration index for the deck/content-pipeline API. The function
 * REFERENCES (api.features.decks.* / internal.features.decks.*) are pinned by
 * this file's path — deployed clients and in-flight scheduled/workpool jobs
 * hold them — so every function stays registered here while its
 * implementation lives in a focused module:
 *
 *   - convex/lib/contentScheduling.ts  content-scheduling helpers (the
 *     per-text sweep + translation/TTS claim-and-enqueue slices)
 *   - convex/features/deckBrowse.ts    browse/progress/difficulty queries
 *   - convex/features/collectionCardAdding.ts  collection selection +
 *     text→card adding
 *   - convex/features/deckContent.ts   upcoming-card ensure/warm sweeps
 *   - convex/features/translationPipeline.ts  translation write pipeline
 *   - convex/features/annotationPipeline.ts   romanization/annotation stores
 *   - convex/features/searchRebuild.ts  searchableText rebuild fan-out
 *   - convex/features/audioStorage.ts   synthesized-audio storage
 */

// Helper re-exports: these were historically defined here and are imported
// value-wise by other modules (courses.ts, onboarding.ts, admin warmups,
// tests). Their implementations moved; the import surface stays stable.
export {
  ProbeNeedsWork,
  scheduleTranslationForLanguage,
  scheduleAudioForLanguage,
  scheduleMissingContent,
} from '../lib/contentScheduling';
export {
  createCardsFromTexts,
  updateCollectionProgress,
  ADD_SCAN_CAP,
} from './collectionCardAdding';

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get cards in the user's deck with translations and audio (paginated).
 *
 * Each card includes a `hasMissingContent` flag. If true, the frontend should
 * call `ensureCardContent` to trigger regeneration.
 */
export const getDeckCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
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
      hasMissingContent: v.boolean(),
      audioSpeedOverrides: v.optional(v.record(v.string(), v.number())),
    }),
  ),
  handler: getDeckCardsHandler,
});

/**
 * Get collection progress for all collections in the active course.
 */
export const getCollectionProgress = query({
  args: {},
  returns: v.array(
    v.object({
      collectionId: v.id('collections'),
      collectionName: v.string(),
      cardsAdded: v.number(),
      ignoredCount: v.number(),
      prioritizedCount: v.number(),
      totalTexts: v.number(),
      order: v.optional(v.number()),
    }),
  ),
  handler: getCollectionProgressQueryHandler,
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Set the active collection for the user's current course.
 */
export const setActiveCollection = mutation({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.null(),
  handler: setActiveCollectionHandler,
});

/**
 * OGTE level (1..20) of the course's active collection, or null when the
 * active collection isn't a coded dataset level (custom/chat/legacy CEFR).
 * Read by the one-time difficulty check in the learn view to seed its
 * slider at the level the user is actually on.
 */
export const getActiveDifficultyLevel = query({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: getActiveDifficultyLevelHandler,
});

/**
 * The next sentences that would actually be added for THIS user from the
 * dataset level `ogteLevel`. The difficulty-check dialog's preview, so the
 * user judges the level on the exact material coming up next, not generic
 * samples. Starts past the user's frontier (`lastRankProcessed`) like the
 * add-cards flow; the source side renders in the base language once its
 * translation exists, the target side is optional (still generating →
 * the row falls back to the source text).
 */
export const getUpcomingSentencesForLevel = query({
  args: {
    ogteLevel: v.number(),
    count: v.optional(v.number()),
  },
  returns: v.object({
    /** The level exists in the active dataset. */
    exists: v.boolean(),
    /**
     * The course can move to this level. It exists and the user hasn't
     * already completed it (`setActiveCollectionByLevel` would throw).
     * Lets the pager disable a step instead of dead-ending on an error
     * toast. Always true for the level that is already active.
     */
    switchable: v.boolean(),
    sentences: v.array(
      v.object({
        position: v.number(),
        sourceText: v.string(),
        targetText: v.optional(v.string()),
        targetRomanization: v.optional(v.string()),
      }),
    ),
  }),
  handler: getUpcomingSentencesForLevelHandler,
});

/**
 * Switch the active collection to the dataset level for `ogteLevel`.
 * The difficulty-check dialog's "switch level" action, which only knows the
 * slider's level, not a collection id. Same safety rails as
 * `setActiveCollection`: no-ops when the level is already active, refuses a
 * collection the user has already completed.
 */
export const setActiveCollectionByLevel = mutation({
  args: {
    ogteLevel: v.number(),
  },
  returns: v.null(),
  handler: setActiveCollectionByLevelHandler,
});

/**
 * Toggle a custom collection's selection for automatic card inclusion.
 */
export const toggleCustomCollection = mutation({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.object({
    selected: v.boolean(),
  }),
  handler: toggleCustomCollectionHandler,
});

/**
 * Add cards from a collection to the user's deck.
 * Chat-collection texts are prioritized before the difficulty collection.
 */
export const addCardsFromCollection = mutation({
  args: {
    collectionId: v.id('collections'),
    batchSize: v.number(),
    /** When true, only add from this specific collection. Skip custom collection mixing. */
    exclusive: v.optional(v.boolean()),
  },
  returns: v.object({
    cardsAdded: v.number(),
    totalCardsInDeck: v.number(),
    /**
     * True when the sequential scan hit its per-call read cap before filling
     * the batch and the collection wasn't exhausted. Addable texts may exist
     * beyond the scanned window. The frontier advance is already persisted,
     * so the caller re-calls to continue (each retry makes
     * guaranteed progress).
     */
    scanIncomplete: v.boolean(),
    /**
     * True when Phase 2 was skipped because the SENTENCES quota is exhausted.
     * Distinguishes "0 cards because out of quota" from "collection drained"
     * Without it the two are byte-identical and clients would latch a
     * quota-limited collection as permanently exhausted. Optional so replies
     * from a not-yet-redeployed backend still validate.
     */
    quotaLimited: v.optional(v.boolean()),
  }),
  handler: addCardsFromCollectionHandler,
});

/**
 * Warm-ahead for the batch add: pre-generate content (translations + audio)
 * for the next addable texts beyond the collection frontier WITHOUT adding
 * cards, so the next "add cards" batch is ready before the user reaches it.
 * Scheduled by `addCardsFromCollection` after each successful premade add.
 *
 * Interactive priority on purpose: these texts are one batch away from the
 * user's screen (observed add cadence ~30s between batches), which is
 * "imminently on screen" under the ttsPriorityValidator classification.
 * Marked (prioritized/readd) texts can occasionally jump the queue ahead of
 * this prediction; the warmed texts stay next-in-line, so the work is spent
 * early rather than wasted. No SENTENCES quota is consumed: nothing is added.
 */
export const warmNextCollectionBatch = internalMutation({
  args: {
    collectionId: v.id('collections'),
    courseId: v.id('courses'),
    deckId: v.id('decks'),
    userId: v.string(),
    afterRank: v.number(),
    limit: v.number(),
  },
  returns: v.null(),
  handler: warmNextCollectionBatchHandler,
});

/**
 * Add ONE specific text from a collection to the user's deck. The collection
 * preview's per-card "Add" button. The card is created ahead of the
 * sequential frontier; the frontier is deliberately NOT advanced (the scan
 * later passes over the card via its dedup check without re-counting it).
 * Premade curriculum texts consume 1 SENTENCES quota, mirroring the batch
 * add; custom/chat texts were already paid for at creation.
 */
export const addSingleTextFromCollection = mutation({
  args: {
    textId: v.id('texts'),
  },
  returns: v.object({
    added: v.boolean(),
    alreadyAdded: v.boolean(),
  }),
  handler: addSingleTextFromCollectionHandler,
});

/**
 * Ensure content (translations + audio) exists for a specific card.
 * Called automatically when a card is displayed and has missing content.
 *
 * Deliberately NOT gated by `assertBillingCurrent` (decided 2026-07-26):
 * the ensure* endpoints are the content pipeline's self-heal path for cards
 * the user already owns, and blocking them while a payment is past due
 * would corrupt the study experience the free tier still promises. The
 * dunning block enforces at the spend boundary instead. `consumeQuota`
 * (card creation, chat, etc.), plus the app-wide overdue dialog.
 */
export const ensureCardContent = mutation({
  args: {
    textId: v.id('texts'),
  },
  returns: v.object({
    translationsScheduled: v.number(),
    audioScheduled: v.number(),
  }),
  handler: ensureCardContentHandler,
});

/**
 * Ensure content for the next N due cards in the user's active deck.
 * Called from the learning mode to pre-generate translations and audio
 * for upcoming cards so they're ready before the user reaches them.
 */
export const ensureUpcomingCardsContent = mutation({
  args: {},
  returns: v.number(),
  handler: ensureUpcomingCardsContentHandler,
});

/**
 * Ensure content for the upcoming cards across *all* scheduling modes, so any
 * mode the user picks starts instantly. Called from the home screen (with no
 * args) to pre-warm content before the user enters a learning session.
 *
 * Unlike `ensureUpcomingCardsContent`, which only warms the user's currently
 * saved mode, this merges the upcoming cards from each mode's selection branch
 * (deduped by card id) so neither mode is left with missing content.
 */
export const ensureUpcomingCardsContentAllModes = mutation({
  args: {},
  returns: v.number(),
  handler: ensureUpcomingCardsContentAllModesHandler,
});

// ============================================================================
// INTERNAL FUNCTIONS
// ============================================================================

/**
 * Internal mutation to prepare card content (translations + TTS).
 */
export const prepareCardContent = internalMutation({
  args: {
    textId: v.id('texts'),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
    priority: v.optional(ttsPriorityValidator),
    llmPriority: v.optional(llmPriorityValidator),
    requestedByUserId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: prepareCardContentHandler,
});

/**
 * Internal query: translation row for idempotency before calling Google Translate.
 */
export const getTranslationForTextLanguage = internalQuery({
  args: {
    textId: v.id('texts'),
    targetLanguage: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      translatedText: v.string(),
      romanizedText: v.optional(v.string()),
      regionVariant: v.optional(v.string()),
    }),
  ),
  handler: getTranslationForTextLanguageHandler,
});

/**
 * Internal action to process translation for a card (the legacy Google
 * Translate path; see the arg docs in translationPipeline.ts).
 */
export const processTranslationForCard = internalAction({
  args: processTranslationForCardArgs,
  returns: v.null(),
  handler: processTranslationForCardHandler,
});

/**
 * Internal mutation to store a translation and schedule TTS generation (the
 * single write choke point; see the arg docs in translationPipeline.ts).
 */
export const storeTranslationAndScheduleTTS = internalMutation({
  args: storeTranslationAndScheduleTtsArgs,
  returns: v.null(),
  handler: storeTranslationAndScheduleTTSHandler,
});

/**
 * Internal action to romanize a source text (in the texts table).
 * (The IPA sibling lives in convex/features/ipa.ts: espeak needs the Node
 * runtime; both write through the generic store mutations below.)
 */
export const processRomanizationForSourceText = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: processRomanizationForSourceTextHandler,
});

/**
 * Internal mutation to store an annotation (romanization or IPA) on a
 * source text document. See storeSourceAnnotationHandler for the
 * idempotence + sentinel semantics.
 */
export const storeSourceAnnotation = internalMutation({
  args: {
    textId: v.id('texts'),
    kind: vAnnotationKind,
    value: v.string(),
    source: v.string(),
    // The text the annotation was computed FROM. The row's wording can change
    // between the action reading it and this mutation running (a backfill
    // racing a retranslation); a mismatched annotation must not land — the
    // field stays undefined so the lazy pipeline regenerates against the
    // current wording. Optional only for in-flight jobs enqueued before the
    // field existed. Mirror of `forText` in storeApprovalEntryAnnotations.
    forText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: storeSourceAnnotationHandler,
});

/**
 * Internal action to romanize an existing translation (backfill).
 * (IPA sibling: processIpaForTranslation in convex/features/ipa.ts.)
 */
export const processRomanizationForTranslation = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: processRomanizationForTranslationHandler,
});

/**
 * Internal mutation to store an annotation (romanization or IPA) on a
 * translation document. Same idempotence + sentinel + source semantics as
 * `storeSourceAnnotation` above.
 */
export const storeTranslationAnnotation = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    kind: vAnnotationKind,
    value: v.string(),
    source: v.string(),
    // See storeSourceAnnotation: skip when the row's wording moved on.
    forText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: storeTranslationAnnotationHandler,
});

/**
 * Rebuild `searchableText` on every card referencing a text, in batches with
 * self-continuation.
 *
 * Scheduled by the three late-content write funnels
 * (`storeTranslationAndScheduleTTS`, `storeSourceAnnotation`,
 * `storeTranslationAnnotation`) so search stays correct for content that
 * lands AFTER a card was created. The review-time staleness check in
 * `reviewCard` only compares language sets. It misses retranslations and
 * late romanization fills entirely, and only fires when the card is actually
 * reviewed, so it stays as a backstop, not the primary path.
 *
 * The rebuilt string depends only on (textId, course languages), so it is
 * computed once per distinct language list and reused across the batch;
 * unchanged cards are skipped so repeated triggers stay cheap.
 */
export const rebuildSearchableTextForText = internalMutation({
  args: {
    textId: v.id('texts'),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: rebuildSearchableTextForTextHandler,
});

/**
 * Internal mutation to store freshly synthesized audio: upserts the shared
 * content-addressed `audioAssets` row and points this text's
 * `audioRecordings` row at it. See storeAudioRecordingHandler in
 * audioStorage.ts.
 */
export const storeAudioRecording = internalMutation({
  args: storeAudioRecordingArgs,
  returns: v.null(),
  handler: storeAudioRecordingHandler,
});
