import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { DEFAULT_CONTENT_VERSION } from '../../lib/languages';

const BATCH_SIZE = 200;

/**
 * One-time backfill: stamp every existing `translations.translationVersion` and
 * `audioRecordings.ttsVersion` with the BASELINE version (`DEFAULT_CONTENT_VERSION`
 * = 1).
 *
 * Why baseline (1) and NOT the language's current config version: every existing
 * row was produced before the versioning system existed, i.e. under the v1
 * pipeline. The regen sweep in `scheduleMissingContent` treats a missing/undefined
 * stamp as "current" (never stale) and a stamped number strictly less than the
 * current config version as "stale". So for a language that has since bumped its
 * version (e.g. `pt_pt`/`en_gb`/`en_au` at `ttsVersion: 2`), stamping the legacy
 * rows at baseline 1 makes them `1 < 2 = stale`, which is exactly what the bump is
 * for — it regenerates the old audio. Stamping the *current* value (2) instead
 * would mark those legacy rows as already up-to-date and the bump would never
 * regenerate them, silently defeating the accent fixes. For languages with no
 * bump (current === 1), baseline 1 is staleness-equivalent to leaving the field
 * undefined, so there is no regeneration storm.
 *
 * Idempotent: rows already carrying the field are skipped. Self-continues via
 * `scheduler.runAfter(0, self, {cursor})` to stay within transaction limits.
 * Kick off from the Convex dashboard / CLI: `convex run migrations/backfillContentVersions:run`.
 *
 * Note: this stamps EVERY translation row, including user-created / user-provided
 * ones (it can't cheaply read the parent text's `userCreated` flag, which lives
 * on `texts`). That's harmless — the version sweep skips `userCreated` texts and
 * `USER_PROVIDED` translations, so their stamp is inert (never consulted for
 * regeneration), and "current" is staleness-equivalent to leaving them undefined.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillContentVersions.processTranslationsBatch,
      {},
    );
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillContentVersions.processAudioBatch,
      {},
    );
    return { status: 'started' };
  },
});

export const processTranslationsBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db.query('translations').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    let updated = 0;
    let skipped = 0;
    for (const row of result.page) {
      if (row.translationVersion !== undefined) {
        skipped++;
        continue;
      }
      await ctx.db.patch(row._id, {
        translationVersion: DEFAULT_CONTENT_VERSION,
      });
      updated++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillContentVersions.processTranslationsBatch,
        { cursor: result.continueCursor },
      );
    }

    return { table: 'translations', processed: result.page.length, updated, skipped, isDone: result.isDone };
  },
});

export const processAudioBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db.query('audioRecordings').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    let updated = 0;
    let skipped = 0;
    for (const row of result.page) {
      if (row.ttsVersion !== undefined) {
        skipped++;
        continue;
      }
      await ctx.db.patch(row._id, {
        ttsVersion: DEFAULT_CONTENT_VERSION,
      });
      updated++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillContentVersions.processAudioBatch,
        { cursor: result.continueCursor },
      );
    }

    return { table: 'audioRecordings', processed: result.page.length, updated, skipped, isDone: result.isDone };
  },
});
