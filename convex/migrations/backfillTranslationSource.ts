import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { getActiveDataset } from '../db/collections';
import {
  getTranslationSource,
  HYBRID_LENGTH_THRESHOLD,
  USER_PROVIDED_TRANSLATION_SOURCE,
} from '../../lib/languages';

const BATCH_SIZE = 100;

/**
 * Model slug for the legacy `default_hybrid` rule. Mirrors the constant
 * defined inline in `lib/languages.ts` — kept here as a plain string so a
 * future change to the rule's default model doesn't silently retroactively
 * retag already-tagged rows. Short and long sentences both used this model;
 * only the `reasoning` arg differed.
 */
const LEGACY_GEMINI_MODEL = 'google/gemini-3.1-flash-lite-preview';

/**
 * Backfill `translationSource` on `translations` rows that pre-date the
 * field. Two phases run in parallel (each is self-fan-out, so they don't
 * block each other):
 *
 * Phase 1 — texts in the active dataset
 *   Assumption (as discussed): everything historically went through Gemini
 *   Flash Lite via the `default_hybrid` rule. The model is constant; only
 *   the `reasoning` field varies based on source-text character length
 *   (threshold = `HYBRID_LENGTH_THRESHOLD`, currently 30 chars).
 *     - source length < threshold → no-reasoning Gemini tag.
 *     - source length >= threshold → low-reasoning Gemini tag.
 *
 * Phase 2 — user-created texts (custom texts typed in the app)
 *   We can't distinguish autofilled rows from manually-typed rows for
 *   historical custom texts (the autofill model identifier wasn't recorded
 *   before this PR). Tag all of them as `USER_PROVIDED_TRANSLATION_SOURCE`.
 *   Trade-off: a future strategy swap will skip historically-autofilled
 *   custom rows. That's the safe failure mode — we don't overwrite
 *   user-curated content.
 *
 * Untouched: translations of texts from older (non-active) datasets and
 * legacy uploaded data with no `datasetId` and `userCreated: false`. Both
 * rare; both stay `undefined`.
 *
 * Idempotent: each per-row write is gated on
 * `translationSource === undefined`.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const activeDataset = await getActiveDataset(ctx);
    if (activeDataset) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillTranslationSource.processDatasetTextsBatch,
        { datasetId: activeDataset._id },
      );
    }
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillTranslationSource.processCustomTextsBatch,
      {},
    );
    return {
      status: 'started',
      datasetId: activeDataset?._id ?? null,
      datasetSlug: activeDataset?.slug ?? null,
      datasetVersion: activeDataset?.version ?? null,
    };
  },
});

/**
 * Phase 1: walk every text in the active dataset, page-by-page, and tag
 * its untagged translation rows with the source derived from the dataset
 * text's length.
 */
export const processDatasetTextsBatch = internalMutation({
  args: {
    datasetId: v.id('datasets'),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('texts')
      .withIndex('by_dataset_and_externalId', (q) =>
        q.eq('datasetId', args.datasetId),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: BATCH_SIZE,
      });

    let tagged = 0;
    let skipped = 0;

    for (const text of page.page) {
      // Pre-compute the source string from the source text's character
      // count. Each translation row inherits this — no matter the target
      // language — because the LLM rule keys off source length.
      const isShort = text.text.length < HYBRID_LENGTH_THRESHOLD;
      const translationSource = isShort
        ? getTranslationSource(LEGACY_GEMINI_MODEL)
        : getTranslationSource(LEGACY_GEMINI_MODEL, 'low');

      const rows = await ctx.db
        .query('translations')
        .withIndex('by_textId', (q) => q.eq('textId', text._id))
        .collect();

      for (const row of rows) {
        if (row.translationSource !== undefined) {
          skipped++;
          continue;
        }
        await ctx.db.patch(row._id, { translationSource });
        tagged++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillTranslationSource.processDatasetTextsBatch,
        {
          datasetId: args.datasetId,
          cursor: page.continueCursor,
        },
      );
    }

    return {
      texts: page.page.length,
      translationsTagged: tagged,
      translationsSkipped: skipped,
      isDone: page.isDone,
    };
  },
});

/**
 * Phase 2: paginate the whole `texts` table and tag translations of any
 * user-created text as `USER_PROVIDED_TRANSLATION_SOURCE`. There's no
 * single-column index on `userCreated`, so we filter in-handler — fine for
 * a one-shot migration.
 */
export const processCustomTextsBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('texts').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    let tagged = 0;
    let skipped = 0;
    let nonCustomSkipped = 0;

    for (const text of page.page) {
      if (!text.userCreated) {
        nonCustomSkipped++;
        continue;
      }
      const rows = await ctx.db
        .query('translations')
        .withIndex('by_textId', (q) => q.eq('textId', text._id))
        .collect();

      for (const row of rows) {
        if (row.translationSource !== undefined) {
          skipped++;
          continue;
        }
        await ctx.db.patch(row._id, {
          translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
        });
        tagged++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillTranslationSource.processCustomTextsBatch,
        { cursor: page.continueCursor },
      );
    }

    return {
      texts: page.page.length,
      nonCustomSkipped,
      translationsTagged: tagged,
      translationsSkipped: skipped,
      isDone: page.isDone,
    };
  },
});
