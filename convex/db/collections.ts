import { QueryCtx, MutationCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';
import { getCourseSettings } from './courseSettings';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';
import { ogteLevelToCollectionCode } from '../../lib/constants/onboarding';
import {
  LEGACY_LEVEL_ORDER,
  LEVEL_TO_COLLECTION,
  isCollectionComplete,
} from '../lib/collections';

/**
 * Get the globally active dataset, or null if none is active (i.e. before the
 * OGTE V1 cutover). The dataset is language-agnostic at the query level. Its
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
 * Load the premade level collections shown across the app, plus the active
 * dataset they belong to (or null pre-cutover).
 *
 * Only fetches the rows actually displayed, either the active dataset's ~20
 * collections (one indexed scan of `by_datasetId_and_order`) or the seven
 * legacy CEFR rows by name (one indexed `first()` each). Avoids the global
 * `collections` scan that would otherwise grow with every user's custom and
 * chat collections; custom collections have no `datasetId` and don't share
 * names with LEGACY_LEVEL_ORDER, so both branches naturally exclude them.
 */
export async function getPremadeLevelCollections(ctx: QueryCtx): Promise<{
  activeDataset: Doc<'datasets'> | null;
  collections: Doc<'collections'>[];
}> {
  const activeDataset = await getActiveDataset(ctx);
  let levelCollections: Doc<'collections'>[];
  if (activeDataset) {
    levelCollections = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_order', (q) =>
        q.eq('datasetId', activeDataset._id),
      )
      .collect();
  } else {
    const legacyDocs = await Promise.all(
      LEGACY_LEVEL_ORDER.map((name) =>
        ctx.db
          .query('collections')
          .withIndex('by_name', (q) => q.eq('name', name))
          .first(),
      ),
    );
    levelCollections = legacyDocs.filter(
      (c): c is Doc<'collections'> => c !== null,
    );
  }
  return { activeDataset, collections: levelCollections };
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
  const exactCode =
    ogteLevel !== undefined ? ogteLevelToCollectionCode(ogteLevel) : null;
  if (activeDataset && exactCode) {
    const exact = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_code', (q) =>
        q.eq('datasetId', activeDataset._id).eq('code', exactCode),
      )
      .first();
    if (exact) return exact;
  }
  const mapping =
    LEVEL_TO_COLLECTION[currentLevel ?? 'beginner'] ??
    LEVEL_TO_COLLECTION.beginner;
  if (activeDataset) {
    const byCode = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_code', (q) =>
        q.eq('datasetId', activeDataset._id).eq('code', mapping.code),
      )
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
        q
          .eq('datasetId', current.datasetId)
          .eq('order', (current.order ?? 0) + 1),
      )
      .first();
  }
  const idx = LEGACY_LEVEL_ORDER.indexOf(
    current.name as (typeof LEGACY_LEVEL_ORDER)[number],
  );
  if (idx === -1 || idx >= LEGACY_LEVEL_ORDER.length - 1) return null;
  return ctx.db
    .query('collections')
    .withIndex('by_name', (q) => q.eq('name', LEGACY_LEVEL_ORDER[idx + 1]))
    .first();
}

/**
 * Walk forward from `current` (inclusive) and return the first collection
 * that is not yet complete for the given user/course. Complete meaning every
 * text either added (`cardsAdded`) or deliberately ignored (`ignoredCount`),
 * measured against the carry-widened total so a cutover user's levels aren't
 * skipped before they've studied them (see `isCollectionComplete`).
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
        q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .eq('collectionId', cursor!._id),
      )
      .first();
    if (!isCollectionComplete(cursor.textCount, progress)) return cursor;
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
 * Whether any of the user's selected custom collections still has a text the
 * deck hasn't pulled in yet.
 *
 * The auto-add custom pass consumes no `SENTENCES` quota, so when this is
 * `true` the user can still get more cards without paying — which is why it
 * gates both the upgrade prompt on the empty state and the client's decision
 * to keep auto-adding once the credit balance hits zero.
 *
 * `activeCustomCollectionIds` is the canonical source-of-truth: when the
 * user creates a chat or custom collection it's appended here (see
 * `getOrCreateChatCollection` / `getOrCreateCustomCollection` below).
 */
export async function hasPendingCustomCardsToAdd(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  activeCustomCollectionIds: Id<'collections'>[] | undefined,
): Promise<boolean> {
  if (!activeCustomCollectionIds || activeCustomCollectionIds.length === 0) {
    return false;
  }
  for (const collId of activeCustomCollectionIds) {
    const coll = await ctx.db.get(collId);
    if (!coll) continue;
    const prog = await getCollectionProgress(ctx, userId, courseId, collId);
    // Ignored texts are excluded from auto-add, so they aren't pending.
    if (!isCollectionComplete(coll.textCount, prog)) return true;
  }
  return false;
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
 * - `onlyCurriculum`: only seed/dataset texts (userCreated === false).
 *   Prevents user forks from leaking into shared difficulty collections.
 * - `forUserId`: only texts owned by this user.
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
        q
          .eq('collectionId', collectionId)
          .eq('userCreated', false)
          .gt('collectionRank', afterRank),
      )
      .order('asc')
      .take(limit);
  }
  if (options?.forUserId) {
    return ctx.db
      .query('texts')
      .withIndex('by_collection_and_userId_and_rank', (q) =>
        q
          .eq('collectionId', collectionId)
          .eq('userId', options.forUserId)
          .gt('collectionRank', afterRank),
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

/**
 * Get or create the per-course origin collection (`'chat'` for AI-approved
 * texts, `'custom'` for manually entered texts). Revalidates the id stored in
 * courseSettings, inserts the collection if missing, and records it in
 * courseSettings (patching the existing row or inserting a fallback one),
 * appending it to `activeCustomCollectionIds` either way.
 */
async function getOrCreateOriginCollection(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
  kind: 'chat' | 'custom',
): Promise<Doc<'collections'>> {
  const settings = await getCourseSettings(ctx, courseId);

  const existingId =
    kind === 'chat' ? settings?.chatCollectionId : settings?.customCollectionId;
  if (existingId) {
    const existing = await ctx.db.get(existingId);
    if (existing) return existing;
  }

  const collectionId = await ctx.db.insert('collections', {
    name: kind === 'chat' ? 'Chat' : 'Custom',
    textCount: 0,
    origin: kind,
  });

  const settingsPatch =
    kind === 'chat'
      ? { chatCollectionId: collectionId }
      : { customCollectionId: collectionId };
  if (settings) {
    const existingCustomIds = settings.activeCustomCollectionIds ?? [];
    await ctx.db.patch(settings._id, {
      ...settingsPatch,
      activeCustomCollectionIds: [...existingCustomIds, collectionId],
    });
  } else {
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      ...settingsPatch,
      activeCustomCollectionIds: [collectionId],
    });
  }

  const collection = await ctx.db.get(collectionId);
  if (!collection) throw new Error(`Failed to create ${kind} collection`);
  return collection;
}

/**
 * Get or create the per-course chat collection used for AI-approved texts.
 * Returns the collection doc and whether courseSettings was updated.
 */
export async function getOrCreateChatCollection(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
): Promise<Doc<'collections'>> {
  return getOrCreateOriginCollection(ctx, courseId, 'chat');
}

/**
 * Get or create the per-course custom collection used for manually entered texts.
 */
export async function getOrCreateCustomCollection(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
): Promise<Doc<'collections'>> {
  return getOrCreateOriginCollection(ctx, courseId, 'custom');
}
