import { v } from 'convex/values';
import { QueryCtx, MutationCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';
import { getCollectionProgress } from './collections';

/** Client-settable marks. 'readd' is internal-only. See schema comment. */
export const collectionTextMarkValidator = v.union(
  v.literal('prioritized'),
  v.literal('ignored'),
);

export type CollectionTextMark = 'prioritized' | 'ignored';
/** What a stored mark row can hold (includes the internal 'readd'). */
export type StoredCollectionTextMark = Doc<'collectionTextMarks'>['mark'];

/**
 * Default read bound for mark listings. Callers that need exact coverage of a
 * known range (the add scan's per-batch ignore set) pass a rank window
 * instead of relying on a large limit.
 */
export const MARK_READ_LIMIT = 1000;

/** Point lookup of a user's mark for a text (null when unmarked). */
export async function getMark(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  textId: Id<'texts'>,
): Promise<Doc<'collectionTextMarks'> | null> {
  return ctx.db
    .query('collectionTextMarks')
    .withIndex('by_userId_and_courseId_and_textId', (q) =>
      q.eq('userId', userId).eq('courseId', courseId).eq('textId', textId),
    )
    .unique();
}

/**
 * Rank-ordered marks of one type for a collection. `minRank`/`maxRank` bound
 * the range (browse-view injection reads at/below the anchor; the add scan
 * reads exactly its batch's rank window). Always bounded: `limit` defaults to
 * {@link MARK_READ_LIMIT} so no caller can accidentally collect an unbounded
 * result (mark counts are user-writable and uncapped).
 */
export async function listMarksForCollection(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  mark: StoredCollectionTextMark,
  options?: { minRank?: number; maxRank?: number; limit?: number },
): Promise<Doc<'collectionTextMarks'>[]> {
  return ctx.db
    .query('collectionTextMarks')
    .withIndex(
      'by_user_course_collection_mark_rank',
      (q) => {
        const base = q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .eq('collectionId', collectionId)
          .eq('mark', mark);
        const lower =
          options?.minRank !== undefined
            ? base.gte('collectionRank', options.minRank)
            : base;
        return options?.maxRank !== undefined
          ? lower.lte('collectionRank', options.maxRank)
          : lower;
      },
    )
    .order('asc')
    .take(options?.limit ?? MARK_READ_LIMIT);
}

/**
 * Apply prioritized/ignored counter deltas to the user's collectionProgress
 * row, creating it when absent. Runs in the SAME transaction as the mark-row
 * write, which is what keeps the denormalized counters drift-free.
 * ('readd' marks are deliberately not counted, they represent "back in the
 * queue", so they must not shift completion/remaining math.)
 */
export async function applyMarkCounterDelta(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  delta: { prioritized?: number; ignored?: number },
): Promise<void> {
  const prioritizedDelta = delta.prioritized ?? 0;
  const ignoredDelta = delta.ignored ?? 0;
  if (prioritizedDelta === 0 && ignoredDelta === 0) return;

  const progress = await getCollectionProgress(ctx, userId, courseId, collectionId);
  if (progress) {
    await ctx.db.patch(progress._id, {
      prioritizedCount: Math.max(0, (progress.prioritizedCount ?? 0) + prioritizedDelta),
      ignoredCount: Math.max(0, (progress.ignoredCount ?? 0) + ignoredDelta),
    });
  } else {
    await ctx.db.insert('collectionProgress', {
      userId,
      courseId,
      collectionId,
      cardsAdded: 0,
      prioritizedCount: Math.max(0, prioritizedDelta),
      ignoredCount: Math.max(0, ignoredDelta),
    });
  }
}

/** The counter delta a mark row contributes ('readd' is counter-neutral). */
export function counterDeltaForMark(
  mark: StoredCollectionTextMark,
  amount: 1 | -1,
): { prioritized?: number; ignored?: number } {
  return mark === 'readd' ? {} : { [mark]: amount };
}

/**
 * Delete the user's mark for a text (if any) and decrement its counter.
 * Called by EVERY path that turns a text into a card (single add, mark
 * drains, sequential scan) so the "marks exist only for card-less texts"
 * invariant holds. Returns the cleared mark type, or null when unmarked.
 */
export async function clearMarkForAddedText(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  textId: Id<'texts'>,
): Promise<StoredCollectionTextMark | null> {
  const existing = await getMark(ctx, userId, courseId, textId);
  if (!existing) return null;
  await ctx.db.delete(existing._id);
  await applyMarkCounterDelta(
    ctx,
    userId,
    courseId,
    existing.collectionId,
    counterDeltaForMark(existing.mark, -1),
  );
  return existing.mark;
}
