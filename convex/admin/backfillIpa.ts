import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { IPA_LANGUAGES } from '../../lib/languages';

/**
 * One-off IPA backfill over existing rows. The lazy pipeline
 * (scheduleMissingContent + useEnsureContent) fills cards as they're viewed;
 * this walks the whole corpus so old content has IPA up front.
 *
 * Not part of migrations:runAll: `migrations.define` entries run as V8
 * mutations and espeak needs the Node runtime, so this is a self-continuing
 * action chain instead (compute in convex/features/ipa.ts, paging here).
 * Idempotent: the store mutations only write rows still `=== undefined`,
 * and rerunning skips everything already filled.
 *
 * Run once after deploy with:
 *   npx convex run admin/backfillIpa:start '{}' --prod
 */

export interface BackfillPage {
  items: Array<{ textId: Id<'texts'>; language: string; text: string }>;
  isDone: boolean;
  continueCursor: string;
}

/**
 * One page of rows still needing IPA. Walks the table in `_creationTime`
 * order and filters in JS (language must be espeak-supported, `ipaText`
 * strictly `=== undefined` per the tri-state), so a page may return fewer
 * items than `numItems` while the cursor still advances a full page.
 */
export const pageIpaCandidates = internalQuery({
  args: {
    table: v.union(v.literal('texts'), v.literal('translations')),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    items: v.array(
      v.object({
        textId: v.id('texts'),
        language: v.string(),
        text: v.string(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args): Promise<BackfillPage> => {
    if (args.table === 'texts') {
      const page = await ctx.db.query('texts').paginate(args.paginationOpts);
      return {
        items: page.page
          .filter(
            (t) => IPA_LANGUAGES.has(t.language) && t.ipaText === undefined,
          )
          .map((t) => ({ textId: t._id, language: t.language, text: t.text })),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }
    const page = await ctx.db
      .query('translations')
      .paginate(args.paginationOpts);
    return {
      items: page.page
        .filter(
          (t) =>
            IPA_LANGUAGES.has(t.targetLanguage) &&
            t.ipaText === undefined &&
            t.translatedText.length > 0,
        )
        .map((t) => ({
          textId: t.textId,
          language: t.targetLanguage,
          text: t.translatedText,
        })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** Kick off both table walks (each chain self-continues independently). */
export const start = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.features.ipa.backfillIpaBatch, {
      table: 'texts',
      cursor: null,
    });
    await ctx.scheduler.runAfter(0, internal.features.ipa.backfillIpaBatch, {
      table: 'translations',
      cursor: null,
    });
    return null;
  },
});
