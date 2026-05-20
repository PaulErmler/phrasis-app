import { v } from 'convex/values';
import { query, mutation, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser, requireActiveCourse } from '../db/courses';
import {
  getActiveDataset,
  getCollectionProgress,
  getNextTextsFromRank,
} from '../db/collections';
import { translationValidator, audioRecordingValidator } from '../types';
import { buildTextContentBatchForLanguages } from '../lib/cardContent';
import { scheduleMissingContent } from './decks';
import {
  COLLECTION_PREVIEW_SIZE,
  CONTENT_LOOKAHEAD_SIZE,
  LEGACY_LEVEL_ORDER,
  isPremadeLevelCollection,
} from '../lib/collections';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';
import { getCourseSettings } from '../db/courseSettings';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function isCollectionAccessible(
  ctx: QueryCtx,
  collectionId: Id<'collections'>,
  courseId: Id<'courses'>,
): Promise<boolean> {
  const collection = await ctx.db.get(collectionId);
  if (!collection) return false;

  if (isPremadeLevelCollection(collection)) return true;

  const courseSettings = await getCourseSettings(ctx, courseId);
  if (!courseSettings) return false;

  if (courseSettings.chatCollectionId?.toString() === collectionId.toString()) return true;
  if (courseSettings.customCollectionId?.toString() === collectionId.toString()) return true;
  if (
    (courseSettings.activeCustomCollectionIds ?? []).some(
      (id) => id.toString() === collectionId.toString(),
    )
  )
    return true;

  return false;
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get the next COLLECTION_PREVIEW_SIZE texts from a collection with
 * translations and audio for all course languages.
 */
export const getCollectionTextsWithContent = query({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.object({
    texts: v.array(
      v.object({
        _id: v.id('texts'),
        text: v.string(),
        sourceLanguage: v.string(),
        translations: v.array(translationValidator),
        audioRecordings: v.array(audioRecordingValidator),
      }),
    ),
    hasMissingContent: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { texts: [], hasMissingContent: false };

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { texts: [], hasMissingContent: false };
    const { course } = active;

    if (!(await isCollectionAccessible(ctx, args.collectionId, course._id))) {
      return { texts: [], hasMissingContent: false };
    }

    const collection = await ctx.db.get(args.collectionId);
    const isLevelCollection = collection
      ? isPremadeLevelCollection(collection)
      : false;

    const progress = await getCollectionProgress(
      ctx,
      userId,
      course._id,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      lastRankProcessed,
      COLLECTION_PREVIEW_SIZE,
      isLevelCollection ? { onlyCurriculum: true } : { forUserId: userId },
    );

    if (texts.length === 0) {
      return { texts: [], hasMissingContent: false };
    }

    const inputs = texts.map((text, i) => ({
      key: String(i),
      textId: text._id,
      sourceText: text.text,
      sourceLanguage: text.language,
      sourceRomanization: text.romanizedText ?? undefined,
    }));

    const contentMap = await buildTextContentBatchForLanguages(
      ctx,
      inputs,
      course.baseLanguages,
      course.targetLanguages,
    );

    let anyMissing = false;
    const enrichedTexts = texts.map((text, i) => {
      const content = contentMap.get(String(i))!;
      if (content.hasMissingContent) anyMissing = true;
      return {
        _id: text._id,
        text: text.text,
        sourceLanguage: text.language,
        translations: content.translations,
        audioRecordings: content.audioRecordings,
      };
    });

    return { texts: enrichedTexts, hasMissingContent: anyMissing };
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Ensure translations and audio exist for the next preview texts in a
 * collection.  The server determines which texts to process based on the
 * user's collection progress — the frontend only passes a collectionId.
 */
export const ensureContentForCollection = mutation({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.object({
    totalTranslationsScheduled: v.number(),
    totalAudioScheduled: v.number(),
  }),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);

    if (!(await isCollectionAccessible(ctx, args.collectionId, course._id))) {
      return { totalTranslationsScheduled: 0, totalAudioScheduled: 0 };
    }

    const collection = await ctx.db.get(args.collectionId);
    const isLevelCollection = collection
      ? isPremadeLevelCollection(collection)
      : false;

    const progress = await getCollectionProgress(
      ctx,
      userId,
      course._id,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      lastRankProcessed,
      CONTENT_LOOKAHEAD_SIZE,
      isLevelCollection ? { onlyCurriculum: true } : { forUserId: userId },
    );

    // Parallel over texts — each text writes only to its own (textId, language)
    // keyed rows, so no cross-text contention within this transaction.
    //
    // priority: 1 — opening a collection preview is a direct user signal that
    // they're considering this collection. Jump ahead of background warmup
    // (priority 0, e.g. cross-level prewarm from onboarding) so the preview
    // populates promptly, while still yielding to onboarding-critical work
    // (priority 2) like placement test or chosen-level seeding.
    const results = await Promise.all(
      texts.map((text) =>
        scheduleMissingContent(
          ctx,
          text._id,
          text,
          course.baseLanguages,
          course.targetLanguages,
          { priority: 1 },
        ),
      ),
    );

    const totalTranslationsScheduled = results.reduce(
      (sum, r) => sum + r.translationsScheduled,
      0,
    );
    const totalAudioScheduled = results.reduce(
      (sum, r) => sum + r.audioScheduled,
      0,
    );

    return { totalTranslationsScheduled, totalAudioScheduled };
  },
});

/**
 * Ensure translations and audio exist for the FIRST 5 sentences of every
 * premade level collection in the active dataset (or legacy CEFR set) for
 * the given language pair. Scheduled from course creation
 * (`createCourse` / `completeOnboarding`) so that drilling into any level
 * later doesn't show a loading spinner.
 *
 * Internal because the only callers are the two course-creation paths,
 * which already know the course's language arrays — no auth lookup needed.
 *
 * Independent of user progress (unlike `ensureContentForCollection` which
 * paginates from `lastRankProcessed`) — always starts at collectionRank 1.
 *
 * Fans out one scheduled `ensureFirstSentencesForCollection` mutation per
 * level collection so each child runs in its own transaction; the inline
 * version exceeded Convex's per-mutation wallclock limit (~15s) once the
 * dataset grew to ~20 levels × 5 texts × multi-language storage.getUrl checks.
 */
export const ensureFirstSentencesAcrossLevelCollections = internalMutation({
  args: {
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.object({
    scheduledCollections: v.number(),
  }),
  handler: async (ctx, args) => {
    // Load only the ~20 premade level collections via indexed lookups so this
    // doesn't scan every user's custom/chat collections (which share the table).
    // Custom collections have no `datasetId` and don't share names with
    // LEGACY_LEVEL_ORDER, so both branches naturally exclude them.
    const activeDataset = await getActiveDataset(ctx);
    let levelCollections: Doc<'collections'>[];
    if (activeDataset) {
      levelCollections = await ctx.db
        .query('collections')
        .withIndex('by_datasetId_and_order', (q) =>
          q.eq('datasetId', activeDataset._id),
        )
        .collect();
    } else {
      const legacyDocs = await Promise.all(
        LEGACY_LEVEL_ORDER.map((name) =>
          ctx.db
            .query('collections')
            .withIndex('by_name', (q) => q.eq('name', name))
            .first(),
        ),
      );
      levelCollections = legacyDocs.filter(
        (c): c is Doc<'collections'> => c !== null,
      );
    }

    await Promise.all(
      levelCollections.map((collection) =>
        ctx.scheduler.runAfter(
          0,
          internal.features.collections.ensureFirstSentencesForCollection,
          {
            collectionId: collection._id,
            baseLanguages: args.baseLanguages,
            targetLanguages: args.targetLanguages,
          },
        ),
      ),
    );

    return { scheduledCollections: levelCollections.length };
  },
});

/**
 * Per-collection child of `ensureFirstSentencesAcrossLevelCollections`.
 *
 * Idempotent — `scheduleMissingContent` skips any (textId, language) already
 * covered, so re-entries do reads only and write nothing. Processes the 5
 * texts in parallel; safe because each text writes only to its own
 * (textId, language)-keyed rows (audio patches, claim inserts, per-text
 * scheduler calls).
 */
export const ensureFirstSentencesForCollection = internalMutation({
  args: {
    collectionId: v.id('collections'),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const texts = await ctx.db
      .query('texts')
      .withIndex('by_collection_and_rank', (q) =>
        q.eq('collectionId', args.collectionId),
      )
      .order('asc')
      .take(COLLECTION_PREVIEW_SIZE);

    await Promise.all(
      texts.map((text) =>
        scheduleMissingContent(
          ctx,
          text._id,
          text,
          args.baseLanguages,
          args.targetLanguages,
        ),
      ),
    );
    return null;
  },
});

/**
 * Warm up content for every language in `SUPPORTED_LANGUAGES`, regardless of
 * which pairs are currently in use across `courses`. Per non-English target
 * language we schedule two fan-outs:
 *
 *   1. **Cross-level warmup** — `ensureFirstSentencesAcrossLevelCollections`
 *      with `en` as the source and that target as the only target language,
 *      populating the first 5 sentences of every level collection.
 *   2. **Placement-test translations + audio backstop** —
 *      `enqueueMissingPlacementTranslations` followed by a 60s-delayed
 *      `ensureAudioForTestTranslations` so the placement test renders
 *      instantly for any user picking that target.
 *
 * Internal mutation — invoke from the Convex dashboard when a new model is
 * rolled out, a new dataset is published, or any other time you want to
 * proactively populate translations + audio for every supported language.
 * Fully idempotent (the underlying mutations skip rows that already have
 * translations/audio), so re-runs are cheap reads only.
 *
 * English-family targets (`en`, `en_gb`, `en_us`, `en_au`) are skipped: the
 * placement sentences and curriculum texts are already in `en`, and there
 * is no value in LLM-translating English to British English.
 *
 * **Throttled** to stay under Google's 200 req/min TTS quota. Each target
 * language generates ~200 TTS jobs (level + placement), so launches are
 * staggered 2 minutes apart, holding the rolling-minute average around
 * 100 req/min. Bursts inside a single language may briefly exceed the
 * budget; the bounded TTS retry in `processTTSForCard` absorbs any
 * resulting 429s without dropping work.
 */
const WARMUP_SOURCE_LANGUAGE = 'en';
// Delay before the per-target placement-test audio backstop sweep runs.
// Matches the value used by `prepareLanguagePair` so translations have time
// to land before the sweep checks for orphans.
const WARMUP_AUDIO_BACKSTOP_DELAY_MS = 60_000;
// Estimated TTS jobs queued per target language across the level-collection
// warmup (~100) and placement-test audio (~100). Used to derive the
// per-language stagger that keeps the average TTS dispatch rate under
// `WARMUP_TARGET_REQUESTS_PER_MINUTE`.
const WARMUP_TTS_JOBS_PER_LANGUAGE = 200;
// Target average TTS dispatch rate during warmup. Set well below Google's
// 200 req/min ceiling so we have headroom for any user-facing TTS that
// runs concurrently with the warmup, and so the per-language burst stays
// inside a single 60s rolling window's budget. Lower if you see persistent
// 429s; raise only if you've also raised Google's quota.
const WARMUP_TARGET_REQUESTS_PER_MINUTE = 100;
// Stagger between consecutive target-language launches. Derived so that the
// rolling-minute average across the whole warmup approaches the target
// rate: (jobs-per-language / target-rate-per-minute) × 60 seconds. At the
// current values this is 2 minutes per language.
const WARMUP_LANGUAGE_STAGGER_MS = Math.ceil(
  (WARMUP_TTS_JOBS_PER_LANGUAGE / WARMUP_TARGET_REQUESTS_PER_MINUTE) * 60_000,
);

export const warmupAllCourses = internalMutation({
  args: {},
  returns: v.object({
    targetLanguagesScheduled: v.number(),
    estimatedDurationMinutes: v.number(),
  }),
  handler: async (ctx) => {
    const targetLanguages = SUPPORTED_LANGUAGES.map((l) => l.code).filter(
      (code) => !code.startsWith('en'),
    );

    let delayMs = 0;
    for (const targetLanguage of targetLanguages) {
      // Per-target level warmup: first 5 sentences of every level
      // collection get translated + audio'd into `targetLanguage`.
      // `scheduleMissingContent` automatically includes `text.language`
      // (always `en`) in its source-audio handling.
      await ctx.scheduler.runAfter(
        delayMs,
        internal.features.collections
          .ensureFirstSentencesAcrossLevelCollections,
        {
          baseLanguages: [WARMUP_SOURCE_LANGUAGE],
          targetLanguages: [targetLanguage],
        },
      );

      // Placement-test translation + audio backstop sweep.
      await ctx.scheduler.runAfter(
        delayMs,
        internal.features.onboarding.enqueueMissingPlacementTranslations,
        { sourceLanguage: WARMUP_SOURCE_LANGUAGE, targetLanguage },
      );
      await ctx.scheduler.runAfter(
        delayMs + WARMUP_AUDIO_BACKSTOP_DELAY_MS,
        internal.features.onboarding.ensureAudioForTestTranslations,
        { targetLanguage },
      );

      delayMs += WARMUP_LANGUAGE_STAGGER_MS;
    }

    return {
      targetLanguagesScheduled: targetLanguages.length,
      estimatedDurationMinutes: Math.ceil(delayMs / 60_000),
    };
  },
});
