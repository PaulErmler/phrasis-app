import { QueryCtx, MutationCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';
import { getCourseSettings } from './courseSettings';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';
import { LEGACY_LEVEL_ORDER, LEVEL_TO_COLLECTION, settledCount } from '../lib/collections';

/**
 * Get the globally active dataset, or null if none is active (i.e. before the
 * OGTE V1 cutover). The dataset is language-agnostic at the query level — its
 * source texts are translated into all target languages via the `translations`
 * table, so a single active row serves every learner regardless of target
 * language.
 */
export async function getActiveDataset(
  ctx: QueryCtx,
): Promise<Doc<'datasets'> | null> {
  return ctx.db
    .query('datasets')
    .withIndex('by_isActive', (q) => q.eq('isActive', true))
    .first();
}

/**
 * Resolve the starting collection for a user's `currentLevel`, preferring the
 * active dataset's level. Falls back to the legacy collection if no active
 * dataset is found.
 *
 * When the precise OGTE level is known (self-picked on the slider or produced
 * by the placement test, both persisted as `placementTest.finalLevel`), it
 * wins: the course starts at that exact `L01`..`L20` collection instead of
 * the 6-bucket `currentLevel` mapping (which only reaches L01/05/08/11/14/17).
 * Out-of-range values and datasets without the exact code fall back to the
 * bucket path unchanged.
 */
export async function resolveStartingCollection(
  ctx: QueryCtx,
  currentLevel: string | undefined,
  ogteLevel?: number,
): Promise<Doc<'collections'> | null> {
  const activeDataset = await getActiveDataset(ctx);
  if (
    activeDataset &&
    ogteLevel !== undefined &&
    Number.isInteger(ogteLevel) &&
    ogteLevel >= 1 &&
    ogteLevel <= 20
  ) {
    const exactCode = `L${String(ogteLevel).padStart(2, '0')}`;
    const exact = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_order', (q) => q.eq('datasetId', activeDataset._id))
      .filter((q) => q.eq(q.field('code'), exactCode))
      .first();
    if (exact) return exact;
  }
  const mapping = LEVEL_TO_COLLECTION[currentLevel ?? 'beginner'] ?? LEVEL_TO_COLLECTION.beginner;
  if (activeDataset) {
    const byCode = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_order', (q) => q.eq('datasetId', activeDataset._id))
      .filter((q) => q.eq(q.field('code'), mapping.code))
      .first();
    if (byCode) return byCode;
  }
  return ctx.db
    .query('collections')
    .withIndex('by_name', (q) => q.eq('name', mapping.legacyName))
    .first();
}

/**
 * Next collection after `current` in pedagogical order. Walks within the
 * collection's own generation: new-dataset collections walk by `order + 1`
 * within the same dataset; legacy collections walk via `LEGACY_LEVEL_ORDER`.
 */
export async function getNextCollection(
  ctx: QueryCtx,
  current: Doc<'collections'>,
): Promise<Doc<'collections'> | null> {
  if (current.datasetId && current.order !== undefined) {
    return ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_order', (q) =>
        q.eq('datasetId', current.datasetId).eq('order', (current.order ?? 0) + 1),
      )
      .first();
  }
  const idx = LEGACY_LEVEL_ORDER.indexOf(current.name as (typeof LEGACY_LEVEL_ORDER)[number]);
  if (idx === -1 || idx >= LEGACY_LEVEL_ORDER.length - 1) return null;
  return ctx.db
    .query('collections')
    .withIndex('by_name', (q) => q.eq('name', LEGACY_LEVEL_ORDER[idx + 1]))
    .first();
}

/**
 * Walk forward from `current` (inclusive) and return the first collection
 * that is not yet complete for the given user/course — complete meaning every
 * text either added (`cardsAdded`) or deliberately ignored (`ignoredCount`).
 * Used by auto-advance to pick the next level after the active one finishes.
 */
export async function findNextIncompleteCollection(
  ctx: QueryCtx,
  current: Doc<'collections'>,
  userId: string,
  courseId: Id<'courses'>,
): Promise<Doc<'collections'> | null> {
  let cursor: Doc<'collections'> | null = current;
  while (cursor) {
    const progress = await ctx.db
      .query('collectionProgress')
      .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
        q.eq('userId', userId).eq('courseId', courseId).eq('collectionId', cursor!._id),
      )
      .first();
    if (settledCount(progress) < cursor.textCount) return cursor;
    cursor = await getNextCollection(ctx, cursor);
  }
  return null;
}

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
 * Get every collectionProgress row for a user/course in one indexed scan.
 * Used by the home view to render all 20 premade levels + custom collections
 * with monotonic progress counters.
 */
export async function getCollectionProgressForCourse(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
): Promise<Doc<'collectionProgress'>[]> {
  return ctx.db
    .query('collectionProgress')
    .withIndex('by_userId_and_courseId', (q) =>
      q.eq('userId', userId).eq('courseId', courseId),
    )
    .collect();
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
    origin: 'chat',
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
    origin: 'custom',
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
