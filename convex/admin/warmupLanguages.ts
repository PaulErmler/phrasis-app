import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { scheduleMissingContent } from '../features/decks';
import { isUserCreatedText } from '../../lib/translationProvenance';

/**
 * Proactive content warmup for the high-traffic languages (the Jul 2026 usage
 * chart: Arabic MSA, Chinese Simplified, Spanish Spain + LatAm, German,
 * French, Italian, Japanese, Russian, Korean, Greek — English is source-only
 * and gets its audio ensured automatically for every processed text, since
 * `scheduleMissingContent` always includes the text's own language).
 *
 * Deliberately NOT a full-table sweep: it warms exactly the content a new
 * user hits first — the first {@link TEXTS_PER_COLLECTION} premade sentences
 * of every collection, plus all onboarding placement-test sentences. For each
 * of those texts it calls `scheduleMissingContent` with the warmup languages
 * as targets, so translations/audio are CREATED where missing and REGENERATED
 * where a `translationVersion` / `ttsVersion` bump (or provider switch) made
 * them stale — and skipped entirely when current. Re-running after a
 * completed warmup is a cheap no-op pass. All the "only if necessary" logic
 * lives in `scheduleMissingContent`; this file only picks the text set.
 *
 * Run with:
 *   npx convex run admin/warmupLanguages:warmupChartLanguages '{}'
 *
 * Walks collections in self-scheduled pages (cron-free, one-shot), then the
 * placement-test sentences, and logs a summary at the end. Pass `languages`
 * to warm a different set.
 */

/** Chart languages as translation targets ('en' handled via source-audio). */
const DEFAULT_WARMUP_LANGUAGES = [
  'ar',
  'zh',
  'es',
  'es_latam',
  'de',
  'fr',
  'it',
  'ja',
  'ru',
  'ko',
  'el',
];

/** How many leading sentences of each collection to warm. */
const TEXTS_PER_COLLECTION = 5;

/** Collections handled per invocation. Each text fans out to ~12 languages
 * inside `scheduleMissingContent` (3 indexed reads + a storage-URL check per
 * language), so a small page keeps every invocation well inside mutation
 * limits even when everything is stale. */
const COLLECTIONS_PER_PAGE = 3;

/** Placement-test rows handled per invocation (phase 2). */
const PLACEMENT_PER_PAGE = 10;

export const warmupChartLanguages = internalMutation({
  args: {
    /** Override the default chart-language set (internal codes). */
    languages: v.optional(v.array(v.string())),
    /** 'collections' (default) → 'placement' → done. */
    phase: v.optional(v.union(v.literal('collections'), v.literal('placement'))),
    /** Pagination cursor within the current phase; passed by self-scheduling. */
    cursor: v.optional(v.union(v.string(), v.null())),
    /** Running totals threaded through the self-scheduled pages. */
    textsProcessedSoFar: v.optional(v.number()),
    translationsScheduledSoFar: v.optional(v.number()),
    audioScheduledSoFar: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const languages = args.languages ?? DEFAULT_WARMUP_LANGUAGES;
    const phase = args.phase ?? 'collections';

    let textsProcessed = 0;
    let translationsScheduled = 0;
    let audioScheduled = 0;

    const warmText = async (textId: Id<'texts'>) => {
      const text = await ctx.db.get(textId);
      // Premade content only — custom/user texts stay on the lazy path.
      if (!text || isUserCreatedText(text)) return;
      const scheduled = await scheduleMissingContent(
        ctx,
        textId,
        text,
        [],
        languages,
      );
      textsProcessed++;
      translationsScheduled += scheduled.translationsScheduled;
      audioScheduled += scheduled.audioScheduled;
    };

    let nextPhase: 'collections' | 'placement' | 'done';
    let nextCursor: string | null;

    if (phase === 'collections') {
      const page = await ctx.db
        .query('collections')
        .paginate({ cursor: args.cursor ?? null, numItems: COLLECTIONS_PER_PAGE });

      for (const collection of page.page) {
        const leading = await ctx.db
          .query('texts')
          .withIndex('by_collection_and_userCreated_and_rank', (q) =>
            q.eq('collectionId', collection._id).eq('userCreated', false),
          )
          .take(TEXTS_PER_COLLECTION);
        for (const text of leading) {
          await warmText(text._id);
        }
      }

      nextPhase = page.isDone ? 'placement' : 'collections';
      nextCursor = page.isDone ? null : page.continueCursor;
    } else {
      const page = await ctx.db
        .query('placementTestSentences')
        .paginate({ cursor: args.cursor ?? null, numItems: PLACEMENT_PER_PAGE });

      for (const sentence of page.page) {
        await warmText(sentence.textId);
      }

      nextPhase = page.isDone ? 'done' : 'placement';
      nextCursor = page.isDone ? null : page.continueCursor;
    }

    const textsProcessedSoFar = (args.textsProcessedSoFar ?? 0) + textsProcessed;
    const translationsScheduledSoFar =
      (args.translationsScheduledSoFar ?? 0) + translationsScheduled;
    const audioScheduledSoFar = (args.audioScheduledSoFar ?? 0) + audioScheduled;

    if (nextPhase === 'done') {
      console.log('[warmupChartLanguages] warmup complete', {
        languages,
        textsProcessed: textsProcessedSoFar,
        translationsScheduled: translationsScheduledSoFar,
        audioScheduled: audioScheduledSoFar,
      });
      return null;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.admin.warmupLanguages.warmupChartLanguages,
      {
        languages: args.languages,
        phase: nextPhase,
        cursor: nextCursor,
        textsProcessedSoFar,
        translationsScheduledSoFar,
        audioScheduledSoFar,
      },
    );
    return null;
  },
});
