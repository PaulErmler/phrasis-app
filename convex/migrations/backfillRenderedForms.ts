import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import {
  classificationLanguageForRow,
  renderingAxesFor,
} from '../lib/renderingClassifier';
import { MAX_ROWS_PER_CALL } from '../features/renderingClassification';

/**
 * One-off backfill of `translations.renderedGender` / `renderedPoliteness`
 * for rows from before the sentence-form settings (live AND superseded, so
 * pinned cards get chips too). Rows of a language that marks neither axis
 * are skipped; rows already stamped are skipped, so the job is idempotent
 * and can be re-run to pick up rows a bad model reply left blank. Rows
 * generated after the feature are stamped at generation, so this runs once
 * per deployment.
 *
 * Hand-rolled (not @convex-dev/migrations) because the per-row work is an
 * LLM call, which needs an action: each page groups its rows by language
 * and schedules one `classifyAndStampTranslations` per group of up to
 * MAX_ROWS_PER_CALL, then continues after `delayMs` so the classifier calls
 * of one page have drained before the next page schedules more.
 *
 * Run from the dashboard:
 *   migrations/backfillRenderedForms:run {}
 * Optional: { pageSize: 400, delayMs: 8000 }. Progress is logged per page.
 */
export const run = internalMutation({
  args: {
    pageSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({ status: v.literal('started') }),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillRenderedForms.processPage,
      {
        cursor: null,
        pageSize: args.pageSize ?? 400,
        delayMs: args.delayMs ?? 8_000,
        scheduledRows: 0,
        skippedRows: 0,
        pages: 0,
      },
    );
    return { status: 'started' as const };
  },
});

export const processPage = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    pageSize: v.number(),
    delayMs: v.number(),
    scheduledRows: v.number(),
    skippedRows: v.number(),
    pages: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('translations')
      .paginate({ numItems: args.pageSize, cursor: args.cursor });

    const byLanguage = new Map<string, Id<'translations'>[]>();
    let skipped = 0;
    for (const row of page.page) {
      if (
        row.renderedGender !== undefined &&
        row.renderedPoliteness !== undefined
      ) {
        skipped++;
        continue;
      }
      const language = classificationLanguageForRow(row);
      const axes = renderingAxesFor(language);
      if (!axes.gender && !axes.politeness) {
        skipped++;
        continue;
      }
      const list = byLanguage.get(language) ?? [];
      list.push(row._id);
      byLanguage.set(language, list);
    }

    let scheduled = 0;
    for (const ids of byLanguage.values()) {
      for (let i = 0; i < ids.length; i += MAX_ROWS_PER_CALL) {
        const chunk = ids.slice(i, i + MAX_ROWS_PER_CALL);
        await ctx.scheduler.runAfter(
          0,
          internal.features.renderingClassification
            .classifyAndStampTranslations,
          { translationIds: chunk, skipStamped: true },
        );
        scheduled += chunk.length;
      }
    }

    const totals = {
      scheduledRows: args.scheduledRows + scheduled,
      skippedRows: args.skippedRows + skipped,
      pages: args.pages + 1,
    };
    console.log(
      `backfillRenderedForms: page ${totals.pages}, scheduled ${scheduled}, skipped ${skipped}, totals ${totals.scheduledRows}/${totals.skippedRows}`,
    );

    if (page.isDone) {
      console.log('backfillRenderedForms: done', totals);
      return null;
    }
    await ctx.scheduler.runAfter(
      scheduled > 0 ? args.delayMs : 0,
      internal.migrations.backfillRenderedForms.processPage,
      {
        cursor: page.continueCursor,
        pageSize: args.pageSize,
        delayMs: args.delayMs,
        ...totals,
      },
    );
    return null;
  },
});
