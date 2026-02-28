import { QueryCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';

/**
 * Get the collection progress for a user/course/collection combo.
 */
export async function getCollectionProgress(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
): Promise<Doc<'collectionProgress'> | null> {
  return ctx.db
    .query('collectionProgress')
    .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
      q
        .eq('userId', userId)
        .eq('courseId', courseId)
        .eq('collectionId', collectionId),
    )
    .first();
}

/**
 * Get the next `limit` texts from a collection after the given rank.
 */
export async function getNextTextsFromRank(
  ctx: QueryCtx,
  collectionId: Id<'collections'>,
  afterRank: number,
  limit: number,
): Promise<Doc<'texts'>[]> {
  return ctx.db
    .query('texts')
    .withIndex('by_collection_and_rank', (q) =>
      q.eq('collectionId', collectionId).gt('collectionRank', afterRank),
    )
    .order('asc')
    .take(limit);
}
