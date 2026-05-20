import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import {
  getRomanizationSource,
  romanizeLocal,
  ROMANIZATION_SOURCES,
} from '../lib/localRomanization';

const BATCH_SIZE = 100;

/**
 * Backfill `romanizationSource` on `texts` and `translations` rows that have
 * a `romanizedText` value but no source tag yet (the state of every row
 * that landed before the source-tracking PR).
 *
 * Per-row rule (mirrors what the user asked for):
 *
 *   - `romanizedText` undefined → skip. `scheduleMissingContent` will route
 *     it through the current romanizer on the next ensureContent call.
 *   - `romanizationSource` already defined → skip (idempotent re-runs).
 *   - Current source is a LOCAL library → re-run `romanizeLocal` and patch
 *     both fields. Local libraries are fast (no network) and deterministic
 *     under their current version, so the stored text is brought into line
 *     with the current library.
 *   - Current source is GOOGLE v3 → tag the existing `romanizedText` with
 *     the Google source without touching the value. We preserve whatever
 *     was previously written rather than paying for fresh Google calls.
 *
 * Languages whose code isn't in any romanizer mapping (e.g. `en`, `fr`)
 * shouldn't have `romanizedText` set in the first place; if such a row
 * exists it's skipped silently rather than mis-tagged.
 *
 * Idempotent: re-running picks up any rows that landed since the previous
 * run and leaves already-tagged rows alone.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillRomanizationSource.processTextsBatch,
      {},
    );
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillRomanizationSource.processTranslationsBatch,
      {},
    );
    return { status: 'started' };
  },
});

/** True for local romanization sources (everything except Google v3). */
function isLocalSource(source: string): boolean {
  return source !== ROMANIZATION_SOURCES.googleV3;
}

export const processTextsBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('texts').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    let tagged = 0;
    let reRomanized = 0;
    let skipped = 0;

    for (const text of page.page) {
      if (text.romanizedText === undefined) {
        skipped++;
        continue;
      }
      if (text.romanizationSource !== undefined) {
        skipped++;
        continue;
      }

      const currentSource = getRomanizationSource(text.language);
      if (isLocalSource(currentSource)) {
        const fresh = romanizeLocal(text.text, text.language);
        if (fresh === null) {
          // Language has no local romanizer (or was de-registered). Leave
          // the row alone — we don't know what produced the existing value.
          skipped++;
          continue;
        }
        await ctx.db.patch(text._id, {
          romanizedText: fresh,
          romanizationSource: currentSource,
        });
        reRomanized++;
      } else {
        // Google source: tag the existing value, don't re-fetch.
        await ctx.db.patch(text._id, {
          romanizationSource: currentSource,
        });
        tagged++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillRomanizationSource.processTextsBatch,
        { cursor: page.continueCursor },
      );
    }

    return {
      table: 'texts',
      processed: page.page.length,
      reRomanized,
      tagged,
      skipped,
      isDone: page.isDone,
    };
  },
});

export const processTranslationsBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('translations').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    let tagged = 0;
    let reRomanized = 0;
    let skipped = 0;

    for (const row of page.page) {
      if (row.romanizedText === undefined) {
        skipped++;
        continue;
      }
      if (row.romanizationSource !== undefined) {
        skipped++;
        continue;
      }

      const currentSource = getRomanizationSource(row.targetLanguage);
      if (isLocalSource(currentSource)) {
        const fresh = romanizeLocal(row.translatedText, row.targetLanguage);
        if (fresh === null) {
          skipped++;
          continue;
        }
        await ctx.db.patch(row._id, {
          romanizedText: fresh,
          romanizationSource: currentSource,
        });
        reRomanized++;
      } else {
        await ctx.db.patch(row._id, {
          romanizationSource: currentSource,
        });
        tagged++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillRomanizationSource.processTranslationsBatch,
        { cursor: page.continueCursor },
      );
    }

    return {
      table: 'translations',
      processed: page.page.length,
      reRomanized,
      tagged,
      skipped,
      isDone: page.isDone,
    };
  },
});
