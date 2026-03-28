import { QueryCtx, MutationCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';
import { getCourseSettings } from './courseSettings';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';

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
 *
 * - `onlyCurriculum` — only seed/dataset texts (userCreated === false).
 *   Prevents user forks from leaking into shared difficulty collections.
 * - `forUserId` — only texts owned by this user.
 *   Scopes custom/chat collections to the requesting user.
 *
 * The two flags are mutually exclusive; `onlyCurriculum` takes precedence.
 */
export async function getNextTextsFromRank(
  ctx: QueryCtx,
  collectionId: Id<'collections'>,
  afterRank: number,
  limit: number,
  options?: { onlyCurriculum?: boolean; forUserId?: string },
): Promise<Doc<'texts'>[]> {
  if (options?.onlyCurriculum) {
    return ctx.db
      .query('texts')
      .withIndex('by_collection_and_userCreated_and_rank', (q) =>
        q.eq('collectionId', collectionId).eq('userCreated', false).gt('collectionRank', afterRank),
      )
      .order('asc')
      .take(limit);
  }
  if (options?.forUserId) {
    return ctx.db
      .query('texts')
      .withIndex('by_collection_and_userId_and_rank', (q) =>
        q.eq('collectionId', collectionId).eq('userId', options.forUserId).gt('collectionRank', afterRank),
      )
      .order('asc')
      .take(limit);
  }
  return ctx.db
    .query('texts')
    .withIndex('by_collection_and_rank', (q) =>
      q.eq('collectionId', collectionId).gt('collectionRank', afterRank),
    )
    .order('asc')
    .take(limit);
}

/** Next rank for appending a text at the end of a collection (max existing rank + 1). */
export async function nextCollectionRank(
  ctx: QueryCtx | MutationCtx,
  collectionId: Id<'collections'>,
): Promise<number> {
  const last = await ctx.db
    .query('texts')
    .withIndex('by_collection_and_rank', (q) => q.eq('collectionId', collectionId))
    .order('desc')
    .first();
  return (last?.collectionRank ?? 0) + 1;
}

/**
 * Get or create the per-course chat collection used for AI-approved texts.
 * Returns the collection doc and whether courseSettings was updated.
 */
export async function getOrCreateChatCollection(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
): Promise<Doc<'collections'>> {
  const settings = await getCourseSettings(ctx, courseId);

  if (settings?.chatCollectionId) {
    const existing = await ctx.db.get(settings.chatCollectionId);
    if (existing) return existing;
  }

  const collectionId = await ctx.db.insert('collections', {
    name: 'Chat',
    textCount: 0,
  });

  if (settings) {
    const existingCustomIds = settings.activeCustomCollectionIds ?? [];
    await ctx.db.patch(settings._id, {
      chatCollectionId: collectionId,
      activeCustomCollectionIds: [...existingCustomIds, collectionId],
    });
  } else {
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      chatCollectionId: collectionId,
      activeCustomCollectionIds: [collectionId],
    });
  }

  const collection = await ctx.db.get(collectionId);
  if (!collection) throw new Error('Failed to create chat collection');
  return collection;
}

/**
 * Get or create the per-course custom collection used for manually entered texts.
 */
export async function getOrCreateCustomCollection(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
): Promise<Doc<'collections'>> {
  const settings = await getCourseSettings(ctx, courseId);

  if (settings?.customCollectionId) {
    const existing = await ctx.db.get(settings.customCollectionId);
    if (existing) return existing;
  }

  const collectionId = await ctx.db.insert('collections', {
    name: 'Custom',
    textCount: 0,
  });

  if (settings) {
    const existingCustomIds = settings.activeCustomCollectionIds ?? [];
    await ctx.db.patch(settings._id, {
      customCollectionId: collectionId,
      activeCustomCollectionIds: [...existingCustomIds, collectionId],
    });
  } else {
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      customCollectionId: collectionId,
      activeCustomCollectionIds: [collectionId],
    });
  }

  const collection = await ctx.db.get(collectionId);
  if (!collection) throw new Error('Failed to create custom collection');
  return collection;
}
