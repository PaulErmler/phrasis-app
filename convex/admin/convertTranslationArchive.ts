import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';

/**
 * One-off, staging only. Superseded translation revisions used to live in
 * their own `translationArchive` table; they are rows of `translations` now
 * (`supersededAt` + `audioAssetId` set, see schema.ts). This moves every
 * remaining archive row across and deletes it, so the table can be dropped
 * from the schema in the next deploy (Convex refuses to drop a table that
 * still holds documents). Prod never had archive rows.
 *
 * Nothing else changes: the live rows' `lastArchivedAt` gates are already
 * correct, so a card pinned before a staging bump keeps its wording and
 * audio through the move. Self-paginating, idempotent (a re-run finds an
 * empty table). Run with:
 *   npx convex run admin/convertTranslationArchive:run '{}'
 */
const BATCH_SIZE = 200;

export const run = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    movedSoFar: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('translationArchive')
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });
    for (const row of page.page) {
      const { _id, _creationTime: _ignored, ...fields } = row;
      await ctx.db.insert('translations', fields);
      await ctx.db.delete(_id);
    }
    const moved = (args.movedSoFar ?? 0) + page.page.length;
    if (page.isDone) {
      console.log(`[convertTranslationArchive] moved ${moved} rows`);
      return null;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.admin.convertTranslationArchive.run,
      { cursor: page.continueCursor, movedSoFar: moved },
    );
    return null;
  },
});
